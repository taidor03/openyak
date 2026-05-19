# SSE 事件协议分组技术设计

> **Status:** Draft — 待评审后再进入实施  
> **Date:** 2026-05-19  
> **Scope:** `frontend/src/hooks/use-sse.ts` (22 个 `client.on()` 注册) + `frontend/src/types/streaming.ts`  
> **Prerequisite:** Task 8 (SSE 状态机) 设计已评审

---

## 1. 问题陈述

当前 22 种 SSE 事件类型扁平注册在 `use-sse.ts` 中，每个事件独立 `client.on()` 调用：

1. **注册代码冗长**：22 个 `client.on()` 调用占据 ~500 行
2. **事件间依赖关系隐含**：如 `step-finish` 安全网依赖 `step-start` 的取消逻辑，但代码中没有显式表达
3. **新增事件缺乏分类指导**：开发者需要阅读全部代码才能判断新事件应在何处注册
4. **与状态机协同困难**：状态机需要知道哪些事件属于同一生命周期阶段

## 2. 分组方案

### 2.1 五组定义

| 组名 | 包含事件 | 生命周期描述 |
|------|---------|------------|
| **Generation** | `step-start`, `step-finish`, `done`, `model-loading`, `title-update` | 生成任务的整体生命周期 |
| **Streaming** | `text-delta`, `reasoning-delta` | 流式内容增量 |
| **Tool** | `tool-call`, `tool-result`, `tool-error` | 工具执行的生命周期 |
| **Compaction** | `compaction-start`, `compaction-phase`, `compaction-progress`, `compacted`, `compaction-error` | 上下文压缩的生命周期 |
| **Interactive** | `permission-request`, `permission-resolved`, `question`, `question-resolved`, `plan-review` | 用户交互（权限/问题/计划） |
| **Control** | `desync`, `retry`, `agent-error`, `error` | 连接和错误控制 |

> 注：`heartbeat` 不属于任何业务组，由 SSEClient 内部处理。

### 2.2 分组与事件映射

```typescript
const SSE_EVENT_GROUPS = {
  generation: {
    events: [
      SSE_EVENTS.STEP_START,
      SSE_EVENTS.STEP_FINISH,
      SSE_EVENTS.DONE,
      SSE_EVENTS.MODEL_LOADING,
      SSE_EVENTS.TITLE_UPDATE,
    ],
  },
  streaming: {
    events: [SSE_EVENTS.TEXT_DELTA, SSE_EVENTS.REASONING_DELTA],
  },
  tool: {
    events: [SSE_EVENTS.TOOL_START, SSE_EVENTS.TOOL_RESULT, SSE_EVENTS.TOOL_ERROR],
  },
  compaction: {
    events: [
      SSE_EVENTS.COMPACTION_START,
      SSE_EVENTS.COMPACTION_PHASE,
      SSE_EVENTS.COMPACTION_PROGRESS,
      SSE_EVENTS.COMPACTED,
      SSE_EVENTS.COMPACTION_ERROR,
    ],
  },
  interactive: {
    events: [
      SSE_EVENTS.PERMISSION_REQUEST,
      SSE_EVENTS.PERMISSION_RESOLVED,
      SSE_EVENTS.QUESTION,
      SSE_EVENTS.QUESTION_RESOLVED,
      SSE_EVENTS.PLAN_REVIEW,
    ],
  },
  control: {
    events: [SSE_EVENTS.DESYNC, SSE_EVENTS.RETRY, SSE_EVENTS.AGENT_ERROR, SSE_EVENTS.ERROR],
  },
} as const;
```

## 3. 处理器接口设计

### 3.1 分组处理器接口

```typescript
interface SSEEventGroupHandler {
  /** 组名，用于调试和日志 */
  readonly groupName: string;

  /** 该组关心的事件列表 */
  readonly events: readonly string[];

  /** 注册所有事件处理器到 SSEClient */
  register(client: SSEClient, context: SSEHandlerContext): void;

  /** 清理该组的所有状态（组件卸载时调用） */
  dispose(): void;
}

/** 共享上下文 — 所有分组处理器都可以访问的服务 */
interface SSEHandlerContext {
  readonly store: typeof useChatStore;
  readonly connectionStore: typeof useConnectionStore;
  readonly queryClient: QueryClient;
  readonly textBuffer: ProgressiveBuffer;
  readonly reasoningBuffer: ProgressiveBuffer;
  readonly cancelPendingStepFinish: () => void;
  readonly finishFromDatabase: (sessionId: string) => Promise<boolean>;
  readonly waitForNextPaint: () => Promise<void>;
  /** 当前是否已取消（组件卸载守卫） */
  readonly isCancelled: () => boolean;
}
```

### 3.2 具体处理器实现示例

```typescript
class GenerationGroupHandler implements SSEEventGroupHandler {
  readonly groupName = "generation";
  readonly events = SSE_EVENT_GROUPS.generation.events;

  private stepFinishTimer: ReturnType<typeof setTimeout> | null = null;

  register(client: SSEClient, ctx: SSEHandlerContext): void {
    client.on(SSE_EVENTS.STEP_START, (data, id) => {
      if (ctx.isCancelled()) return;
      ctx.cancelPendingStepFinish();
      ctx.store.getState().addStepStart(data.step ?? 0);
    });

    client.on(SSE_EVENTS.STEP_FINISH, (data, id) => {
      if (ctx.isCancelled()) return;
      ctx.store.getState().addStepFinish(
        data.reason ?? "stop",
        data.tokens ?? {},
        data.cost ?? 0,
        data.total_cost ?? null,
        id ?? null,
        data.session_id ?? null,
      );

      const terminalReasons = new Set(["stop", "length", "error", "aborted"]);
      if (terminalReasons.has(data.reason ?? "")) {
        this.startSafetyNet(client, ctx);
      } else {
        ctx.cancelPendingStepFinish();
      }
    });

    client.on(SSE_EVENTS.DONE, async (_data, id) => {
      if (ctx.isCancelled()) return;
      ctx.cancelPendingStepFinish();
      ctx.textBuffer.flush();
      ctx.reasoningBuffer.flush();
      // ... (原有的 DONE 处理逻辑)
    });

    // ... MODEL_LOADING, TITLE_UPDATE
  }

  private startSafetyNet(client: SSEClient, ctx: SSEHandlerContext) {
    this.clearSafetyNet();
    const sid = ctx.store.getState().sessionId;
    // ... (1.2s + 8s 双层安全网逻辑)
  }

  dispose(): void {
    this.clearSafetyNet();
  }

  private clearSafetyNet(): void {
    if (this.stepFinishTimer) {
      clearTimeout(this.stepFinishTimer);
      this.stepFinishTimer = null;
    }
  }
}
```

## 4. 事件分发机制

### 4.1 注册流程

```typescript
// use-sse.ts 中的简化注册
const handlers: SSEEventGroupHandler[] = [
  new GenerationGroupHandler(),
  new StreamingGroupHandler(),
  new ToolGroupHandler(),
  new CompactionGroupHandler(),
  new InteractiveGroupHandler(),
  new ControlGroupHandler(),
];

// 统一注册
for (const handler of handlers) {
  handler.register(client, context);
}

// 统一清理
cleanup = () => {
  for (const handler of handlers) {
    handler.dispose();
  }
  client.close();
};
```

### 4.2 不影响 SSEClient 核心逻辑

分组是**纯前端组织模式**，`SSEClient` 的 `on()` / `dispatchEvent()` 不需要任何修改：
- `SSEClient` 仍按事件名分发
- 分组处理器通过 `register()` 将多个 `client.on()` 调用聚合
- 每个处理器只关心自己组内的事件

## 5. 与状态机设计（Task 8）的协同关系

### 5.1 分组处理器 → 状态机

分组处理器在处理事件时，可以通知状态机进行转换：

```typescript
class GenerationGroupHandler implements SSEEventGroupHandler {
  private stateMachine: SSEStateMachine;

  constructor(stateMachine: SSEStateMachine) {
    this.stateMachine = stateMachine;
  }

  register(client: SSEClient, ctx: SSEHandlerContext): void {
    client.on(SSE_EVENTS.STEP_START, (data, id) => {
      this.stateMachine.transition(SSEState.Stepping);
      // ... 原有逻辑
    });

    client.on(SSE_EVENTS.STEP_FINISH, (data, id) => {
      if (isTerminal) {
        this.stateMachine.transition(SSEState.Finalizing);
      }
      // ... 原有逻辑
    });

    client.on(SSE_EVENTS.DONE, async (_data, id) => {
      this.stateMachine.transition(SSEState.Idle);
      // ... 原有逻辑
    });
  }
}
```

### 5.2 状态机 → 分组处理器

状态机切换时，可以通知特定分组执行进入/退出动作：

```typescript
class SSEStateMachine {
  private handlers: Map<string, SSEEventGroupHandler>;

  transition(newState: SSEState) {
    // 通知分组处理器状态变化
    if (newState === SSEState.Idle) {
      for (const handler of this.handlers.values()) {
        handler.dispose();
      }
    }
  }
}
```

### 5.3 实施顺序建议

1. **先分组**（本 Task）：将 22 个 `client.on()` 拆分为 6 个分组处理器，不改变逻辑
2. **后状态机**（Task 8）：在分组处理器中添加 `stateMachine.transition()` 调用
3. **最后重构定时器**（Task 8 Phase 2-3）：将定时器管理从分组处理器迁移到状态机

## 6. 是否需要中间件模式

### 6.1 Before/After 钩子分析

| 场景 | 是否需要 before 钩子 | 是否需要 after 钩子 |
|------|---------------------|---------------------|
| `text-delta` 前检查 cancelled | ✅ (已通过 ctx.isCancelled()) | ❌ |
| `step-finish` 前取消 pending timer | ✅ (已通过 ctx.cancelPendingStepFinish()) | ❌ |
| `tool-result` 后刷新 workspace files | ❌ | ✅ (副作用) |
| `done` 后延迟验证重获取 | ❌ | ✅ (副作用) |

### 6.2 建议

**不需要引入通用中间件模式**。原因：
1. before 钩子的需求（cancelled 守卫、cancelPendingStepFinish）已通过 `SSEHandlerContext` 暴露的共享方法解决
2. after 钩子的需求（延迟重获取、workspace 刷新）是特定于个别事件的副作用，不需要通用化
3. 通用中间件会增加调试复杂度，收益不高

如果未来需要跨分组的 before/after 钩子（如全局的日志/指标收集），可以在 `SSEHandlerContext` 中添加 `onEvent(event, phase)` 回调。

## 7. 迁移步骤

### Step 1: 定义分组和接口（~30 行新增）

- 创建 `frontend/src/hooks/sse-event-groups.ts`
- 定义 `SSE_EVENT_GROUPS` 常量
- 定义 `SSEEventGroupHandler` 和 `SSEHandlerContext` 接口

### Step 2: 逐组提取处理器（每组 ~1 commit）

- 从 `use-sse.ts` 中提取 Generation 组 → `GenerationGroupHandler`
- 提取 Streaming 组 → `StreamingGroupHandler`
- 提取 Tool 组 → `ToolGroupHandler`
- 提取 Compaction 组 → `CompactionGroupHandler`
- 提取 Interactive 组 → `InteractiveGroupHandler`
- 提取 Control 组 → `ControlGroupHandler`

每步提取后运行 `tsc --noEmit` 确认无回归。

### Step 3: 统一注册和清理（~20 行改动）

- 修改 `use-sse.ts` 的 `start()` 函数，使用分组处理器数组
- 修改 cleanup 函数，调用所有 handler 的 `dispose()`

### Step 4: 删除原代码（纯删除）

- 移除 `use-sse.ts` 中 22 个原始 `client.on()` 调用
- 预计减少 `use-sse.ts` ~300 行

## 8. 回滚策略

- Step 1: 新文件，直接删除
- Step 2: 每组独立 commit，可单独 revert（原 `client.on()` 调用仍保留在 use-sse.ts 中直到 Step 4）
- Step 3: revert 注册逻辑即可
- Step 4: revert 删除 commit 恢复原代码

## 9. 风险评估

| 风险 | 概率 | 影响 | 缓解措施 |
|------|------|------|---------|
| 分组边界错误（事件放错组） | 低 | 低 | 仅组织变更，逻辑不变 |
| 共享上下文遗漏导致 handler 无法访问必要状态 | 中 | 中 | `SSEHandlerContext` 先包含所有必要方法，逐步精简 |
| 与状态机集成时接口不兼容 | 中 | 中 | 先实施分组，状态机设计时参考分组接口 |
