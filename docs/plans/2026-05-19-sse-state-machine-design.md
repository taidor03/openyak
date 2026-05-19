# 前端 SSE 状态机技术设计

> **Status:** Draft — 待评审后再进入实施  
> **Date:** 2026-05-19  
> **Scope:** `frontend/src/hooks/use-sse.ts` (850+ 行)  
> **Prerequisite:** Task 2 (cancelled 守卫) 已实施

---

## 1. 问题陈述

`use-sse.ts` 当前存在以下维护和可靠性问题：

1. **6+ 并发定时器**：`stepFinishTimer` × 2, `idleCheckTimer`, `mobilePauseTimer`, `ProgressiveBuffer` × 2, `SSEClient` 内部 × 3（heartbeat, reconnect, staleCheck）
2. **状态转换逻辑分散**：STEP_FINISH 的 terminal 判断、DONE 的延迟验证、AGENT_ERROR 的清理逻辑各自独立，缺乏统一的"当前处于什么阶段"概念
3. **清理逻辑脆弱**：effect cleanup 依赖 `cancelled` 标志（Task 2 加固），但根本原因是缺乏结构化的状态生命周期管理
4. **调试困难**：8 种隐式状态（从"刚连接"到"步进中安全网等待"）无法通过单一变量观察

## 2. 状态定义

### 2.1 状态枚举

```typescript
enum SSEState {
  /** 未连接，等待 streamId */
  Idle = "idle",
  /** 正在建立 SSE 连接（connect() 已调用，等待 onopen） */
  Connecting = "connecting",
  /** 连接已建立，正在接收流式事件 */
  Active = "active",
  /** 收到 step-start，当前步骤进行中 */
  Stepping = "stepping",
  /** 连接中断，正在尝试重连 */
  Reconnecting = "reconnecting",
  /** 收到 terminal step_finish，安全网定时器运行中 */
  Finalizing = "finalizing",
  /** 连接永久断开（max retries exceeded / 用户主动关闭） */
  Disconnected = "disconnected",
}
```

### 2.2 状态转换图

```
                    ┌─────────────────────────────┐
                    │                             │
                    ▼                             │
  ┌──────┐   connect()   ┌────────────┐   onopen  │  ┌────────┐
  │ Idle │──────────────►│ Connecting │───────────┤►│ Active │
  └──────┘              └────────────┘           │  └────────┘
     ▲                                           │     │ │
     │                                    error  │     │ │ step-start
     │                                           │     │ │
     │                                           │     ▼ ▼
     │                                           │  ┌──────────┐
     │                                           │  │ Stepping │
     │                                           │  └──────────┘
     │                                           │     │ │
     │                              step-finish  │     │ │ (terminal)
     │                              (tool_use)   │     │ ▼
     │                                           │     │ ┌────────────┐
     │                                           │     │ │ Finalizing │
     │                                           │     │ └────────────┘
     │                                           │     │     │
     │                                           │     │  done │ timeout
     │                                           │     │     │
     │                                           │     ▼     ▼
     │                                    onerror│  finishGeneration()
     │                                           │     │
     │                                           ▼     ▼
     │                                     ┌──────────────┐
     │                                     │ Reconnecting │
     │                                     └──────────────┘
     │                                           │
     │                              max retries  │  reconnect success
     │                              exceeded     │
     │                                           ▼
     │                                     ┌──────────────┐
     └─────────────────────────────────────│ Disconnected │
           (reset on new streamId)         └──────────────┘
```

### 2.3 事件到状态转换的映射表

| 当前状态 | 事件 | 目标状态 | 动作 |
|---------|------|---------|------|
| Idle | `connect()` | Connecting | 创建 SSEClient, 启动 idle timer |
| Connecting | `onopen` | Active | 启动 heartbeat, idle check |
| Connecting | `onerror` | Reconnecting | 启动 reconnect timer |
| Active | `step-start` | Stepping | 取消 pending finalize timer |
| Active | `onerror` | Reconnecting | 保存 lastEventId |
| Active | `done` | Idle | flush buffers, finishGeneration |
| Active | `agent-error` | Idle | flush buffers, finishGeneration |
| Stepping | `step-finish (tool_use)` | Active | 取消 step timer |
| Stepping | `step-finish (terminal)` | Finalizing | 启动安全网定时器 |
| Stepping | `text-delta` | Stepping | (保持, push to buffer) |
| Stepping | `tool-call` | Stepping | (保持, add tool part) |
| Stepping | `onerror` | Reconnecting | 保存 lastEventId |
| Finalizing | `done` | Idle | 清除安全网定时器, finish |
| Finalizing | `step-start` | Stepping | 取消安全网定时器 |
| Finalizing | `timeout (1.2s)` | Finalizing | DB recovery 尝试 |
| Finalizing | `timeout (8s)` | Idle | 强制 finishGeneration |
| Finalizing | `onerror` | Reconnecting | 清除安全网定时器 |
| Reconnecting | `reconnect success` | Active | 恢复事件处理 |
| Reconnecting | `max retries` | Disconnected | toast, DB recovery |
| Disconnected | `new streamId` | Idle | 重置所有状态 |

## 3. 定时器生命周期管理

### 3.1 每状态定时器集合

```typescript
interface StateTimers {
  Idle: [];  // 无定时器
  Connecting: ["idleCheck"];  // 连接超时检测
  Active: ["idleCheck", "heartbeat"];
  Stepping: ["idleCheck", "heartbeat"];
  Finalizing: ["idleCheck", "safetyNet", "safetyNetFallback"];
  Reconnecting: ["reconnectBackoff", "idleCheck"];
  Disconnected: [];  // 无定时器
}
```

### 3.2 状态切换时的定时器管理

```typescript
class SSEStateMachine {
  private timers: Map<string, ReturnType<typeof setTimeout>> = new Map();

  transition(newState: SSEState) {
    const oldState = this.currentState;
    
    // 清除旧状态独有、新状态不需要的定时器
    const oldTimers = STATE_TIMERS[oldState] ?? [];
    const newTimers = STATE_TIMERS[newState] ?? [];
    for (const timer of oldTimers) {
      if (!newTimers.includes(timer)) {
        this.clearTimer(timer);
      }
    }
    
    this.currentState = newState;
    // 新状态可能需要启动新的定时器（由进入动作触发）
  }
}
```

### 3.3 ProgressiveBuffer 与状态机的集成

ProgressiveBuffer 保持现有设计（独立于状态机），但状态机控制其 flush 时机：
- `transition(Finalizing)` → 自动 `textBuffer.flush(); reasoningBuffer.flush()`
- `transition(Idle)` → 自动 `dispose()` 两个 buffer

## 4. 与 SSEClient 的集成方式

### 4.1 包装模式（推荐）

状态机 **包装** SSEClient，不替换它。SSEClient 负责底层连接管理（EventSource/fetch、重连、心跳），状态机负责上层业务状态（步进、终结、安全网）。

```typescript
class SSEStateMachine {
  private client: SSEClient | null = null;
  
  connect(streamId: string) {
    this.client = new SSEClient({ /* ... */ });
    this.registerHandlers();
    this.client.connect();
    this.transition(SSEState.Connecting);
  }
  
  private registerHandlers() {
    // 所有 client.on() 注册在状态机中，由状态机分发
    this.client!.on(SSE_EVENTS.STEP_FINISH, (data, id) => {
      this.handleStepFinish(data, id);
    });
    // ...
  }
}
```

### 4.2 不替换 SSEClient 的原因

1. SSEClient 已经正确处理了 EventSource 生命周期、POST SSE fetch 模式、重连退避等复杂逻辑
2. 状态机关注的是**业务状态**（步进中？终结中？），不是**连接状态**（连接中？重连中？）
3. SSEClient 的 `onStatusChange` 回调可以驱动状态机转换，但不需要合并两者

## 5. 渐进迁移策略

### Phase 1: 引入状态枚举和简单转换（~50 行改动）

- 在 `use-sse.ts` 中定义 `SSEState` 枚举
- 添加一个 `useStateMachine()` hook 返回 `{ state, transition }`
- 在关键事件处理器中调用 `transition()`（不改变任何逻辑，仅记录状态）
- 可以通过 React DevTools 观察状态变化

### Phase 2: 定时器统一管理（~100 行改动）

- 提取定时器管理到 `SSEStateMachine` 类中
- 状态切换时自动清理/启动定时器
- 移除分散的 `clearTimeout` 调用

### Phase 3: Finalizing 状态安全网重构（~80 行改动）

- 将 `stepFinishTimer` 双层嵌套重构为 Finalizing 状态的进入/退出动作
- Finalizing 状态持有自己的超时定时器，自动管理
- `done` 或 `step-start` 事件自动取消 Finalizing

### Phase 4: 文件拆分（~200 行改动）

- `use-sse.ts` 拆分为：
  - `use-sse.ts` — 主 hook，组装各模块
  - `sse-state-machine.ts` — 状态机核心
  - `sse-event-handlers.ts` — 事件处理器（按 Task 9 的分组组织）
  - `sse-recovery.ts` — `finishFromDatabase()` 和相关恢复逻辑

## 6. 回滚策略

每个 Phase 独立 commit，可单独 revert：
- Phase 1: 仅增加枚举和 `transition()` 调用，移除后代码恢复原状
- Phase 2: 定时器管理回退到分散模式
- Phase 3: Finalizing 状态回退到 `stepFinishTimer` 嵌套
- Phase 4: 文件合并回 `use-sse.ts`

## 7. 风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| 状态转换遗漏导致卡死 | 中 | 高 | Phase 1 先只记录状态，验证所有路径覆盖后再接管逻辑 |
| 定时器管理统一后性能退化 | 低 | 中 | Phase 2 保留渐进式迁移，对比前后性能 |
| Finalizing 重构引入竞态 | 中 | 高 | Phase 3 保留 `cancelled` 守卫作为兜底 |
