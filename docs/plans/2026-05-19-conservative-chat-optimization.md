# 对话交互全链路稳健优化 Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 基于《OpenYak 对话交互全链路深度分析报告》，实施稳健改进，消除高严重度可靠性风险，提升用户体验感知速度和步间性能，并为中优先级架构改进建立设计基础。

**Architecture:** 分层改进策略：(1) P0 消除可靠性风险（纯防御性加固），(2) P1 提升性能感知和步间效率（增量优化+增量加载），(3) P2 增加可观测性（纯日志），(4) P3 设计阶段——为中优先级架构改进（SSE 状态机、事件协议分组）产出技术设计文档，经评审后再进入实施。所有 P0-P2 改动保持现有 API 协议和模块接口不变，每个改动独立可回滚。

**Tech Stack:** Python 3.13+ (FastAPI, SQLAlchemy async), TypeScript/React 19 (Next.js 15, Zustand, TanStack React Query v5)

---

## 改进项筛选说明

从报告中 6.1 性能瓶颈、6.2 可靠性风险、6.3 架构优化建议 三大维度中，按以下原则筛选：

| 原则 | 说明 |
|------|------|
| **P0-P2 不重构** | P0-P2 不涉及 processor.py 拆分等架构重构 |
| **P3 先设计后实施** | SSE 状态机、事件协议分组等先产出技术设计文档，评审后再实施 |
| **增量可回滚** | P0-P2 每个改动独立，git revert 单个 commit 即可回滚 |
| **优先级：风险 > 感知 > 效率 > 可观测 > 设计** | 先消除可靠性风险，再优化感知和步间性能，最后为架构改进做设计准备 |

最终入选 9 个改进项，分 4 个优先级梯队：

| 梯队 | 改进项 | 类型 | 风险等级 | 预计改动量 |
|------|--------|------|---------|-----------|
| P0 | SSE 重连 DESYNC 事件缓冲区扩容 | 可靠性 | 高 | ~10 行 |
| P0 | use-sse 定时器泄漏防御 | 可靠性 | 中 | ~30 行 |
| P0 | chat-store step_finish 去重 LRU 溢出防御 | 可靠性 | 中 | ~5 行 |
| P1 | ProgressiveBuffer 自适应刷新 | 性能感知 | 低 | ~15 行 |
| P1 | 历史消息增量加载（压缩锚点后增量追加） | 性能 | 中 | ~80 行 |
| P1 | _prepare_step_messages 微压缩增量跳过 | 性能 | 低 | ~20 行 |
| P2 | 关键路径防御性日志增强 | 可观测 | 极低 | ~30 行 |
| P3 | 前端 SSE 状态机技术设计 | 设计 | — | 设计文档 |
| P3 | SSE 事件协议分组技术设计 | 设计 | — | 设计文档 |

---

## Task 1: SSE 重连 DESYNC 事件缓冲区扩容

**问题:** `GenerationJob._MAX_EVENT_BUFFER = 5000`，长时间生成（如代码重构，30+ 步 × 每步 200+ 事件）可能溢出缓冲区，导致 SSE 重连时无法重放丢失事件，前端收到 DESYNC 后只能从 DB 恢复（丢失中间流式状态）。

**改进:** 将缓冲区上限从 5000 提升到 20000，并在溢出时记录更详细的日志以便后续诊断。20000 ≈ 100 步 × 200 事件/步，覆盖极端场景。内存开销：每个 SSEEvent 约 200 bytes，20000 × 200B ≈ 4MB，对于桌面应用完全可接受。

**Files:**
- Modify: `backend/app/streaming/manager.py:28` — `_MAX_EVENT_BUFFER` 常量
- Modify: `backend/app/streaming/manager.py:67-68` — 缓冲区截断时增加日志

**Step 1: 修改缓冲区上限并增加诊断日志**

```python
# backend/app/streaming/manager.py

# 修改前:
_MAX_EVENT_BUFFER = 5000

# 修改后:
_MAX_EVENT_BUFFER = 20_000
```

同时修改 `publish()` 方法中的缓冲区截断逻辑，增加 warn 日志：

```python
# 修改前 (manager.py:67-68):
if len(self.events) > self._MAX_EVENT_BUFFER:
    self.events = self.events[-self._MAX_EVENT_BUFFER:]

# 修改后:
if len(self.events) > self._MAX_EVENT_BUFFER:
    dropped = len(self.events) - self._MAX_EVENT_BUFFER
    logger.warning(
        "Event buffer overflow for stream %s: dropping %d oldest events (total=%d)",
        self.stream_id, dropped, len(self.events),
    )
    self.events = self.events[-self._MAX_EVENT_BUFFER:]
```

**Step 2: 运行后端测试确认无回归**

```bash
cd backend && python -m pytest tests/ -x -q --timeout=30 -k "stream" 2>&1 | tail -20
```

**Step 3: Commit**

```bash
git add backend/app/streaming/manager.py
git commit -m "fix: increase SSE replay buffer to 20K events and add overflow logging

Long-running generations (30+ steps, 200+ events/step) could exceed the
previous 5000-event buffer, causing DESYNC on SSE reconnect. The 20K
buffer covers ~100 steps at 200 events each (~4MB memory), appropriate
for a desktop app."
```

---

## Task 2: use-sse 定时器泄漏防御

**问题:** `use-sse.ts` 中存在 6+ 个并发定时器（`stepFinishTimer` × 2, `idleCheckTimer`, `mobilePauseTimer`, `ProgressiveBuffer` × 2, SSEClient 内部 `heartbeatTimer` + `reconnectTimer` + `staleCheckInterval`）。在快速导航场景（如连续切换聊天）下，旧 effect 的 cleanup 可能未完全执行，导致定时器泄漏，表现为：
- `finishGeneration()` 在已完成的 chat 上被调用
- DB recovery 请求对错误的 session 发起
- 内存中的 `persistedLastEventId` / `currentStreamId` 污染

**改进:** 在现有 cleanup 函数中添加"取消令牌守卫"，确保定时器回调中检查 cancelled 标志后再执行业务逻辑。不重构为状态机（过于激进），仅做防御性加固。

**Files:**
- Modify: `frontend/src/hooks/use-sse.ts:94-833` — cleanup 和定时器回调

**Step 1: 加固 step-finish 安全网定时器**

当前 `stepFinishTimer` 的回调没有检查 `cancelled` 标志，导致组件卸载后仍可能触发 `finishFromDatabase()` 和 `finishGeneration()`。

在 `STEP_FINISH` 事件处理器中，将 `cancelled` 变量传入定时器回调：

```typescript
// frontend/src/hooks/use-sse.ts — STEP_FINISH handler (around line 411-468)

client.on(SSE_EVENTS.STEP_FINISH, (data, id) => {
  persistedLastEventId = id;
  store.getState().addStepFinish(
    data.reason ?? "stop",
    data.tokens ?? {},
    data.cost ?? 0,
    data.total_cost ?? null,
    id ?? null,
    data.session_id ?? null,
  );

  const terminalReasons = new Set(["stop", "length", "error", "aborted"]);
  const isTerminalStep = terminalReasons.has(data.reason ?? "");
  if (isTerminalStep) {
    cancelPendingStepFinish();
    const sid = store.getState().sessionId;
    stepFinishTimer = setTimeout(async () => {
      stepFinishTimer = null;
      // 防御: 组件已卸载则跳过
      if (cancelled) return;
      if (!store.getState().isGenerating) return;

      if (sid) {
        const finished = await finishFromDatabase(sid);
        if (finished) {
          client.close();
          return;
        }
      }

      stepFinishTimer = setTimeout(async () => {
        stepFinishTimer = null;
        // 防御: 组件已卸载则跳过
        if (cancelled) return;
        if (store.getState().isGenerating) {
          console.warn("SSE safety net: forcing finishGeneration after step_finish timeout");
          try {
            if (sid) {
              const finished = await finishFromDatabase(sid);
              if (finished) {
                client.close();
                return;
              }
            }
          } finally {
            store.getState().finishGeneration();
            connectionStore.getState().setStatus("idle");
          }
          client.close();
        }
      }, 8_000);
    }, 1_200);
  } else {
    cancelPendingStepFinish();
  }
});
```

**Step 2: 加固 idleCheckTimer 回调**

```typescript
// frontend/src/hooks/use-sse.ts — idle recovery timer (around line 734-753)

const idleCheckTimer = setInterval(async () => {
  // 防御: 组件已卸载则跳过
  if (cancelled) {
    clearInterval(idleCheckTimer);
    return;
  }
  if (!store.getState().isGenerating) {
    clearInterval(idleCheckTimer);
    return;
  }
  if (lastEventTimestamp > 0 && Date.now() - lastEventTimestamp > IDLE_RECOVERY_MS) {
    console.warn("SSE idle recovery: no events for 15s, attempting DB recovery");
    const sid = store.getState().sessionId;
    if (sid) {
      const finished = await finishFromDatabase(sid);
      if (finished) {
        clearInterval(idleCheckTimer);
        client.close();
        return;
      }
    }
    lastEventTimestamp = Date.now();
    client.checkHealth();
  }
}, IDLE_CHECK_INTERVAL_MS);
```

**Step 3: 加固 mobilePauseTimer 回调**

```typescript
// frontend/src/hooks/use-sse.ts — visibility change handler (around line 758-778)

const handleVisibilityChange = () => {
  if (!clientRef.current || !store.getState().isGenerating) return;
  // 防御: 组件已卸载则跳过
  if (cancelled) return;

  if (document.visibilityState === "visible") {
    if (mobilePauseTimer) {
      clearTimeout(mobilePauseTimer);
      mobilePauseTimer = null;
    }
    clientRef.current.resumeReconnect();
    clientRef.current.checkHealth();
  } else if (isRemoteMode()) {
    mobilePauseTimer = setTimeout(() => {
      mobilePauseTimer = null;
      // 防御: 组件已卸载或已恢复可见则跳过
      if (cancelled) return;
      clientRef.current?.pauseReconnect();
    }, 30_000);
  }
};
```

**Step 4: 加固 DONE 和 AGENT_ERROR 中的 delayed refetch**

```typescript
// frontend/src/hooks/use-sse.ts — DONE handler delayed refetch (around line 652-659)

const _sid = sessionId;
if (_sid) {
  setTimeout(() => {
    // 防御: 组件已卸载则跳过
    if (cancelled) return;
    queryClient.invalidateQueries({
      queryKey: queryKeys.messages.list(_sid),
    });
  }, 500);
}

// 同样加固 handleAgentError 中的 delayed refetch (around line 696-702)
if (sessionId) {
  setTimeout(() => {
    // 防御: 组件已卸载则跳过
    if (cancelled) return;
    queryClient.invalidateQueries({
      queryKey: queryKeys.messages.list(sessionId),
    });
  }, 500);
  queryClient.invalidateQueries({ queryKey: queryKeys.sessions.detail(sessionId) });
}
```

**Step 5: 验证前端编译无错误**

```bash
cd frontend && npx tsc --noEmit 2>&1 | tail -20
```

**Step 6: Commit**

```bash
git add frontend/src/hooks/use-sse.ts
git commit -m "fix: add cancelled guard to all timer callbacks in use-sse

Prevents timer callbacks (step-finish safety net, idle recovery,
visibility change, delayed refetch) from executing after component
unmount. This eliminates the most common source of stale state
mutations during fast chat navigation."
```

---

## Task 3: chat-store step_finish 去重 LRU 溢出防御

**问题:** `SEEN_STEP_FINISH_IDS` 使用 `Set` 实现简易 LRU，容量 256。当快速生成（多步对话）step_finish 事件数超过 256 时，最旧的 ID 被驱逐，后续重放这些 ID 时会被误认为新事件，导致 token/cost 双重计算。

**改进:** 将 LRU 容量从 256 提升到 2048，覆盖极端场景（200 步 × 每步 1 个 step_finish = 200）。同时，在 `addStepFinish` 中增加"回退守卫"：如果 `totalCost` 从后端到达（非 null 且 > 0），以之为准覆盖前端累加值（当前代码已有此逻辑，但需确认其对溢出场景的覆盖性）。

**Files:**
- Modify: `frontend/src/stores/chat-store.ts:47-48` — `SEEN_STEP_FINISH_LIMIT` 常量

**Step 1: 提升 LRU 容量**

```typescript
// frontend/src/stores/chat-store.ts

// 修改前:
const SEEN_STEP_FINISH_LIMIT = 256;

// 修改后:
const SEEN_STEP_FINISH_LIMIT = 2048;
```

**Step 2: 验证 `addStepFinish` 中 totalCost 对账逻辑已覆盖溢出场景**

阅读当前代码（line 326-404），确认：
- `totalCost !== null && totalCost > 0` 时直接使用后端值 ✅
- `cost > 0` 但无 `totalCost` 时回退到 `prevCost + cost` ✅  
- 其余保持不变 ✅

现有对账逻辑已正确覆盖溢出场景，无需额外改动。

**Step 3: Commit**

```bash
git add frontend/src/stores/chat-store.ts
git commit -m "fix: increase step_finish dedup LRU limit from 256 to 2048

In long multi-step generations (200+ steps), the old 256-entry LRU
could evite valid event IDs, causing token/cost double-counting on
SSE replay. The cost reconciliation logic (totalCost from backend
overrides frontend accumulation) already mitigates this, but the
larger LRU prevents the root cause."
```

---

## Task 4: ProgressiveBuffer 首 chunk 立即刷新

**问题:** 当前 `ProgressiveBuffer` 对所有 text-delta 和 reasoning-delta 统一使用 60ms 批量合并。这意味着首 token 从 SSE 到达到用户看到文字，存在额外的 60ms 延迟。对于 LLM TTFT 已达 1-4 秒的场景，再增加 60ms 虽然比例不大，但这是"白给"的延迟——首 chunk 不存在渲染性能问题（没有前序渲染压力），立即刷新完全安全。

**改进:** 为 ProgressiveBuffer 增加"首次刷新"模式：首个 push 立即 flush（0ms），后续 push 正常 60ms 批量。这是最保守的实现：不改变批量间隔，不改变架构，仅在首 chunk 时短路定时器。

**Files:**
- Modify: `frontend/src/hooks/use-sse.ts:38-80` — `ProgressiveBuffer` 类

**Step 1: 修改 ProgressiveBuffer 支持首次立即刷新**

```typescript
// frontend/src/hooks/use-sse.ts

class ProgressiveBuffer {
  private pending = "";
  private timerId: ReturnType<typeof setTimeout> | null = null;
  private hasFlushed = false; // 新增: 是否已刷新过

  constructor(private appendFn: (text: string) => void) {}

  push(text: string) {
    this.pending += text;
    if (!this.hasFlushed) {
      // 首次推送: 立即刷新, 消除首 token 的 60ms 等待
      this.flush();
      return;
    }
    if (!this.timerId) {
      this.timerId = setTimeout(this.flushPending, PROGRESSIVE_BUFFER_INTERVAL_MS);
    }
  }

  flush() {
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    if (this.pending) {
      this.appendFn(this.pending);
      this.pending = "";
      this.hasFlushed = true; // 标记已刷新
    }
  }

  dispose() {
    if (this.timerId) {
      clearTimeout(this.timerId);
      this.timerId = null;
    }
    this.pending = "";
    this.hasFlushed = false; // 重置, 为下一个 stream 复用
  }

  private flushPending = () => {
    if (!this.pending) {
      this.timerId = null;
      return;
    }
    const chunk = this.pending;
    this.pending = "";
    this.timerId = null;
    this.hasFlushed = true;
    this.appendFn(chunk);
  };
}
```

**Step 2: 验证前端编译无错误**

```bash
cd frontend && npx tsc --noEmit 2>&1 | tail -20
```

**Step 3: Commit**

```bash
git add frontend/src/hooks/use-sse.ts
git commit -m "perf: flush first streaming delta immediately instead of waiting 60ms

The first text/reasoning delta has no prior rendering pressure, so
batching it adds unnecessary 60ms latency to first-token display.
Subsequent deltas continue to use the 60ms batch interval to prevent
Chromium/WindowServer stutter on high-frequency chunks."
```

---

## Task 5: _prepare_step_messages 微压缩增量跳过

**问题:** `_prepare_step_messages()` 每步执行完整流程：DB 全量查询 → sanitize → L1 微压缩 → L2 工具结果预算。其中 L1/L2 遍历所有消息，但大部分消息在上一步已压缩过（stub 化的工具输出不会恢复），重复遍历纯属浪费。

**改进:** 在 `microcompact_messages()` 和 `apply_tool_result_budget()` 中添加早期退出：如果受保护区域之外没有未压缩的工具结果，直接返回原消息列表，跳过复制和遍历。这是纯增量优化——不改变压缩语义，仅跳过无效工作。

**Files:**
- Modify: `backend/app/session/microcompact.py:80-146` — `microcompact_messages()`
- Modify: `backend/app/session/microcompact.py:149-234` — `apply_tool_result_budget()`

**Step 1: 在 microcompact_messages 中添加早期退出**

```python
# backend/app/session/microcompact.py — microcompact_messages()

def microcompact_messages(
    messages: list[dict[str, Any]],
    *,
    skip_recent_turns: int = DEFAULT_SKIP_RECENT_TURNS,
    max_tool_output_tokens: int = DEFAULT_MAX_TOOL_OUTPUT_TOKENS,
) -> list[dict[str, Any]]:
    if not messages:
        return messages

    call_id_map = _build_call_id_to_tool_name(messages)
    protected_count = _count_recent_messages(messages, skip_recent_turns)
    cutoff = len(messages) - protected_count
    if cutoff <= 0:
        return messages

    # 新增: 快速扫描——如果受保护区域外没有任何可压缩的工具结果,
    # 直接返回原列表, 避免无谓的复制和遍历
    has_compressible = False
    for i in range(cutoff):
        msg = messages[i]
        if msg.get("role") != "tool":
            continue
        tool_call_id = msg.get("tool_call_id", "")
        tool_name = call_id_map.get(tool_call_id, "")
        content = msg.get("content", "")
        if (
            tool_name in MICROCOMPACTABLE_TOOLS
            and isinstance(content, str)
            and content
            and not content.startswith("[Previous ")  # 已被压缩过的 stub
            and estimate_tokens(content) > max_tool_output_tokens
        ):
            has_compressible = True
            break

    if not has_compressible:
        return messages

    # 原有的压缩逻辑不变...
    replaced = 0
    result = []
    for i, msg in enumerate(messages):
        # ... (原有逻辑)
```

**Step 2: 在 apply_tool_result_budget 中添加早期退出**

```python
# backend/app/session/microcompact.py — apply_tool_result_budget()

def apply_tool_result_budget(
    messages: list[dict[str, Any]],
    *,
    budget_tokens: int = DEFAULT_BUDGET_TOKENS,
    skip_recent_turns: int = DEFAULT_SKIP_RECENT_TURNS,
) -> list[dict[str, Any]]:
    if not messages:
        return messages

    call_id_map = _build_call_id_to_tool_name(messages)
    protected_count = _count_recent_messages(messages, skip_recent_turns)
    cutoff = len(messages) - protected_count
    if cutoff <= 0:
        return messages

    # 第一轮: 收集工具结果大小 (原有逻辑)
    tool_entries: list[dict[str, Any]] = []
    total_tokens = 0

    for i, msg in enumerate(messages):
        if i >= cutoff:
            continue
        if msg.get("role") != "tool":
            continue
        content = msg.get("content", "")
        if isinstance(content, str) and content:
            # 新增: 跳过已被 stub 化的工具结果 (它们只占几十 tokens)
            if content.startswith("[Previous ") or content.startswith("[") and "output removed" in content:
                continue
            tokens = estimate_tokens(content)
            tool_call_id = msg.get("tool_call_id", "")
            tool_entries.append({
                "msg_index": i,
                "tokens": tokens,
                "tool_call_id": tool_call_id,
            })
            total_tokens += tokens

    if total_tokens <= budget_tokens:
        return messages

    # 原有的替换逻辑不变...
```

**Step 3: 运行后端测试**

```bash
cd backend && python -m pytest tests/ -x -q --timeout=30 -k "microcompact or compact" 2>&1 | tail -20
```

**Step 4: Commit**

```bash
git add backend/app/session/microcompact.py
git commit -m "perf: add early-exit to microcompact when no compressible results exist

In multi-step conversations, most tool outputs are already stubbed from
previous microcompact runs. Skip the full scan-and-copy when the
unprotected region has no compressible results. Also skip already-
stubbed results in the budget calculator to avoid miscounting."
```

---

## Task 6: 关键路径防御性日志增强

**问题:** 当前关键路径（SSE 事件发布、step-finish 处理、finishFromDatabase）缺少结构化日志，导致用户报告"卡在 generating"时无法定位原因：是 SSE 断连？是 DONE 丢失？还是 DB 恢复失败？

**改进:** 在关键决策点增加 warn 级别日志，包含 stream_id / session_id / step 等上下文。不改变任何逻辑，纯粹增加可观测性。

**Files:**
- Modify: `backend/app/streaming/manager.py` — `publish()` 已在 Task 1 增加
- Modify: `backend/app/streaming/manager.py` — `subscribe()` 重连重放
- Modify: `frontend/src/hooks/use-sse.ts` — `finishFromDatabase()` 成功/失败

**Step 1: 后端 subscribe() 增加重连重放日志**

```python
# backend/app/streaming/manager.py — subscribe() 方法 (around line 96-144)

def subscribe(self, last_event_id: int = 0) -> asyncio.Queue[SSEEvent | None]:
    q: asyncio.Queue[SSEEvent | None] = asyncio.Queue(maxsize=5000)

    replay_events = [
        event
        for event in self.events
        if event.id is not None and event.id > last_event_id
    ]

    # 新增: 记录重连重放情况
    if last_event_id > 0:
        logger.info(
            "SSE reconnect for stream %s: last_event_id=%d, replaying %d events (buffer=%d)",
            self.stream_id, last_event_id, len(replay_events), len(self.events),
        )

    reserve = 1 if self._completed else 0
    capacity = max(0, q.maxsize - reserve)
    if len(replay_events) > capacity:
        capacity = max(0, capacity - 1)
        dropped = len(replay_events) - capacity
        # 原有的 warn 日志保留...
        # ...
    # 后续逻辑不变...
```

**Step 2: 后端 complete() 增加完成日志**

```python
# backend/app/streaming/manager.py — complete() 方法 (around line 146-154)

def complete(self) -> None:
    logger.info(
        "Generation job completed: stream=%s, session=%s, events=%d, subscribers=%d",
        self.stream_id, self.session_id, len(self.events), len(self.subscribers),
    )
    self._completed = True
    for q in self.subscribers:
        try:
            q.put_nowait(None)
        except asyncio.QueueFull:
            pass
    self.subscribers.clear()
```

**Step 3: 前端 finishFromDatabase() 增加决策日志**

```typescript
// frontend/src/hooks/use-sse.ts — finishFromDatabase() (around line 158-226)

const finishFromDatabase = async (sessionId: string) => {
  textBuffer.flush();
  reasoningBuffer.flush();
  await queryClient.invalidateQueries({
    queryKey: queryKeys.messages.list(sessionId),
  });
  await waitForNextPaint();

  try {
    const activeJobs = await api.get<Array<{ stream_id: string; session_id: string }>>(
      API.CHAT.ACTIVE,
    );
    const currentStreamId = store.getState().streamId;
    const stillActive = activeJobs.some(
      (job) =>
        job.session_id === sessionId &&
        (!currentStreamId || job.stream_id === currentStreamId),
    );
    if (stillActive) {
      console.info("[sse] finishFromDB: session %s still active, skipping finalize", sessionId);
      return false;
    }
  } catch {
    // If the active-job check fails, fall back to the DB heuristic below.
  }

  if (!canFinalizeFromCache(sessionId)) {
    try {
      const latestPage = await api.get<PaginatedMessages>(API.MESSAGES.LIST(sessionId, 50, -1));
      // ... (原有逻辑)
      if (!canFinalizeFromPayload(latestPage)) {
        console.info("[sse] finishFromDB: session %s latest page has no terminal step-finish", sessionId);
        return false;
      }
    } catch {
      console.warn("[sse] finishFromDB: failed to fetch latest page for session %s", sessionId);
      return false;
    }
  }

  console.info("[sse] finishFromDB: finalizing session %s from DB", sessionId);
  store.getState().finishGeneration();
  // ... (后续逻辑不变)
```

**Step 4: 运行后端和前端编译检查**

```bash
cd backend && python -m pytest tests/ -x -q --timeout=30 -k "stream" 2>&1 | tail -10
cd frontend && npx tsc --noEmit 2>&1 | tail -10
```

**Step 5: Commit**

```bash
git add backend/app/streaming/manager.py frontend/src/hooks/use-sse.ts
git commit -m "observability: add structured logging at SSE critical decision points

Adds warn/info logs at:
- SSE reconnect replay (backend): stream_id, last_event_id, replay count
- GenerationJob complete (backend): total events, subscriber count
- finishFromDatabase (frontend): active check result, DB recovery result

These logs help diagnose 'stuck in generating' reports by revealing
whether the issue is SSE disconnection, DONE loss, or DB recovery failure."
```

---

## 改动总览

| Task | 文件 | 改动行数 | 风险 |
|------|------|---------|------|
| 1 | `backend/app/streaming/manager.py` | ~10 | 极低: 仅调大常量+增加日志 |
| 2 | `frontend/src/hooks/use-sse.ts` | ~30 | 低: 增加 cancelled 守卫, 不改变逻辑 |
| 3 | `frontend/src/stores/chat-store.ts` | ~1 | 极低: 仅调大常量 |
| 4 | `frontend/src/hooks/use-sse.ts` | ~15 | 低: 首次刷新立即, 后续不变 |
| 5 | `backend/app/session/prompt.py` + `backend/app/session/manager.py` | ~80 | 中: 增量缓存逻辑, 需仔细测试 |
| 6 | `backend/app/session/microcompact.py` | ~20 | 极低: 增加早期退出, 不改变压缩语义 |
| 7 | `backend/app/streaming/manager.py` + `frontend/src/hooks/use-sse.ts` | ~30 | 极低: 仅增加日志 |
| 8 | `docs/plans/` | 设计文档 | 无: 纯设计, 不改代码 |
| 9 | `docs/plans/` | 设计文档 | 无: 纯设计, 不改代码 |

**P0-P2 实施改动约 186 行，涉及 4 个源码文件，7 个独立 commit，每个可单独回滚。**
**P3 产出 2 份技术设计文档，经评审后再决定是否进入实施。**

---

## Task 7: 历史消息增量加载（压缩锚点后增量追加）

**问题:** 当前 `_prepare_step_messages()` 每步执行完整流程：`get_message_history_for_llm(db, session_id)` 全量 DB 查询 → 全量格式转换 → L1 微压缩 → L2 工具结果预算。这是步间延迟的主要来源（~100-300ms/步），且大部分是重复工作——上一步已加载和压缩过的消息，这一步又重新加载和压缩一遍。

**根本原因分析:** `get_message_history_for_llm()` 已有压缩锚点机制（`compaction_anchor`）——在 L4 压缩后，锚点之前的消息被跳过。但锚点之后的消息仍每步全量加载。

**改进方案:** 在 `SessionPrompt` 中引入步间增量缓存：
- **首次加载（step 1）**: 全量 `get_message_history_for_llm()` + L1/L2 压缩 → 缓存结果
- **增量追加（step 2+）**: 仅查询自上次缓存后新增的消息 → 追加到缓存尾部 → 仅对新增部分执行 L1/L2
- **缓存失效**: 压缩（L3/L4）后清空缓存，下次全量加载

**设计要点:**
1. 缓存存储在 `SessionPrompt` 实例上（已有跨步状态如 `total_cost`, `current_todos`），不引入新的全局状态
2. 增量查询基于消息 ID 上界：记录上次加载的最后一条消息 ID，新查询仅获取 ID > 上界的消息
3. 压缩后缓存失效：`_handle_compact_result()` 中清空缓存，强制下一步全量加载
4. 新消息格式转换与微压缩独立为函数，可对增量部分单独调用

**Files:**
- Modify: `backend/app/session/prompt.py` — `_prepare_step_messages()`, `_handle_compact_result()`
- Modify: `backend/app/session/manager.py` — 新增 `get_messages_since(db, session_id, after_message_id)` 函数
- Modify: `backend/app/session/microcompact.py` — 导出 `microcompact_messages_incremental()` 函数

**Step 1: 新增增量消息查询函数**

```python
# backend/app/session/manager.py

async def get_messages_since(
    db: AsyncSession,
    session_id: str,
    after_message_id: str | None = None,
) -> list[Message]:
    """Get messages created after the given message ID.
    
    Used for incremental history loading: after the first full load,
    subsequent steps only need messages created since the last load.
    Returns all messages if after_message_id is None.
    """
    stmt = (
        select(Message)
        .where(Message.session_id == session_id)
        .options(selectinload(Message.parts))
        .order_by(Message.created_at)
    )
    if after_message_id:
        # Find the position of the reference message, then get all after it
        ref_stmt = select(Message.created_at).where(Message.id == after_message_id)
        ref_result = await db.execute(ref_stmt)
        ref_time = ref_result.scalar_one_or_none()
        if ref_time:
            stmt = stmt.where(Message.created_at > ref_time)
    result = await db.execute(stmt)
    return list(result.unique().scalars().all())
```

**Step 2: 在 SessionPrompt 中添加增量缓存状态**

```python
# backend/app/session/prompt.py — SessionPrompt.__init__()

# 新增: 步间增量缓存
self._cached_llm_messages: list[dict[str, Any]] | None = None
self._cached_last_message_id: str | None = None
```

**Step 3: 修改 _prepare_step_messages() 支持增量加载**

```python
# backend/app/session/prompt.py — _prepare_step_messages()

async def _prepare_step_messages(self) -> tuple[list[Any], Any]:
    from app.session.utils import (
        get_effective_context_window as _get_effective_context_window,
        sanitize_llm_messages_for_request as _sanitize_llm_messages_for_request,
    )
    from app.session.manager import get_message_history_for_llm, get_messages_since
    from app.session.microcompact import microcompact_messages, apply_tool_result_budget
    from app.session.middleware import MiddlewareContext

    # --- 增量加载逻辑 ---
    if self._cached_llm_messages is not None and self._cached_last_message_id is not None:
        # 增量路径: 仅加载新消息
        async with self.session_factory() as db:
            async with db.begin():
                new_messages = await get_messages_since(
                    db, self.job.session_id, self._cached_last_message_id,
                )
        
        if not new_messages:
            # 没有新消息 — 直接使用缓存 (仍然需要运行中间件)
            llm_messages = list(self._cached_llm_messages)
        else:
            # 转换新消息为 LLM 格式
            # (复用 get_message_history_for_llm 的内部逻辑)
            new_llm_messages = await self._convert_messages_to_llm_format(new_messages)
            # 仅对新消息执行 L1/L2 压缩
            new_llm_messages = microcompact_messages(new_llm_messages)
            new_llm_messages = apply_tool_result_budget(new_llm_messages)
            # 追加到缓存
            llm_messages = list(self._cached_llm_messages) + new_llm_messages
            # 更新缓存
            self._cached_llm_messages = list(llm_messages)
            self._cached_last_message_id = new_messages[-1].id
    else:
        # 全量路径: 首次加载或压缩后缓存失效
        async with self.session_factory() as db:
            async with db.begin():
                llm_messages = await get_message_history_for_llm(db, self.job.session_id)
        
        # 记录缓存
        async with self.session_factory() as db:
            async with db.begin():
                all_msgs = await get_messages(db, self.job.session_id)
                if all_msgs:
                    self._cached_last_message_id = all_msgs[-1].id
        self._cached_llm_messages = list(llm_messages)
    
    llm_messages = _sanitize_llm_messages_for_request(
        llm_messages,
        session_id=self.job.session_id,
        model_max_context=(
            _get_effective_context_window(self.model_info)
            if self.model_info else None
        ),
    )

    mw_ctx = MiddlewareContext(
        session_id=self.job.session_id,
        step=self.step,
        job=self.job,
        model_id=self.model_id,
        agent_name=self.agent.name if self.agent else None,
    )
    llm_messages = await self.middleware_chain.run_before_llm_call(
        llm_messages, mw_ctx,
    )
    return llm_messages, mw_ctx
```

**Step 4: 压缩后清空缓存**

```python
# backend/app/session/prompt.py — _handle_compact_result()
# 在方法开头添加:

self._cached_llm_messages = None
self._cached_last_message_id = None
```

**Step 5: 运行后端测试**

```bash
cd backend && python -m pytest tests/ -x -q --timeout=30 2>&1 | tail -20
```

**Step 6: Commit**

```bash
git add backend/app/session/prompt.py backend/app/session/manager.py
git commit -m "perf: incremental message history loading across steps

Previously, every step did a full DB query + format conversion +
microcompact of the entire message history. This change caches the
LLM-formatted messages after the first load and only appends new
messages in subsequent steps. The cache is invalidated on compaction.

Expected: 30-50% reduction in inter-step latency for multi-step
conversations."
```

---

## Task 8: 前端 SSE 状态机技术设计

**问题:** `use-sse.ts` 的 837 行中包含 6+ 并发定时器（stepFinishTimer × 2, idleCheckTimer, mobilePauseTimer, ProgressiveBuffer × 2, SSEClient 内部 × 3），状态转换逻辑分散在各个事件处理器中，缺乏统一的有限状态机模型。Task 2 的 `cancelled` 守卫是临时修补，根本解决方案是引入显式状态机。

**改进:** 本 Task 不实施代码改动，仅产出技术设计文档。设计需解决：
1. 状态定义：空闲 → 连接中 → 活跃(接收事件) → 步进中(收到 step-start) → 重连中 → 断开
2. 定时器管理：每个状态持有自己的定时器集合，状态切换时自动清理前状态定时器
3. 事件到状态转换的映射表
4. 与现有 SSEClient 的集成方式（包装 vs 替换）
5. 渐进迁移策略：如何分阶段从当前代码迁移到状态机，不中断功能

**Files:**
- Create: `docs/plans/2026-05-19-sse-state-machine-design.md`

**Step 1: 产出技术设计文档**

设计文档需包含：
- 状态转换图（ASCII 或 Mermaid）
- 每个状态的进入/退出动作
- 定时器生命周期管理方案
- 与 SSEClient 的集成接口
- 迁移步骤和回滚策略
- 对 `use-sse.ts` 837 行的拆分建议

**Step 2: Commit**

```bash
git add docs/plans/2026-05-19-sse-state-machine-design.md
git commit -m "docs: add SSE state machine technical design

Design document for migrating use-sse.ts from scattered timer
management to an explicit finite state machine. Covers state definitions,
transition table, timer lifecycle, SSEClient integration, and
incremental migration strategy."
```

---

## Task 9: SSE 事件协议分组技术设计

**问题:** 当前 22 种 SSE 事件类型扁平注册，每个事件独立处理器，缺乏逻辑分组。这导致：
1. 事件处理器注册代码冗长（22 个 `client.on()` 调用）
2. 事件间的依赖关系隐含在代码顺序中（如 step-finish 安全网依赖 step-start 的取消逻辑）
3. 新增事件时缺乏分类指导

**改进:** 本 Task 不实施代码改动，仅产出技术设计文档。设计需解决：
1. 分组方案：生成/工具/压缩/交互/控制 5 组，每组一个处理器对象
2. 分组内事件的生命周期管理（如工具组的 running → completed/error）
3. 与现有事件常量的兼容性——不改后端事件名，仅在前端做分组抽象
4. 分组后的事件分发机制：`client.on()` 仍按事件名分发，但处理器按组聚合
5. 是否需要引入中间件模式（如 before/after 钩子）

**Files:**
- Create: `docs/plans/2026-05-19-sse-event-grouping-design.md`

**Step 1: 产出技术设计文档**

设计文档需包含：
- 5 个事件组的定义和包含的事件
- 每组的处理器接口设计
- 事件分发机制（不影响 SSEClient 核心逻辑）
- 与状态机设计（Task 8）的协同关系
- 迁移步骤

**Step 2: Commit**

```bash
git add docs/plans/2026-05-19-sse-event-grouping-design.md
git commit -m "docs: add SSE event protocol grouping technical design

Design document for organizing 22 SSE event types into 5 lifecycle
groups (generation/tool/compaction/interactive/control). Covers
group handler interfaces, dispatch mechanism, and migration strategy."
```

---

## 专题分析：双层状态架构（Zustand + React Query）的设计考量

### 为什么 OpenYak 采用双层状态架构？

经过深入源码分析，这个设计并非随意选择，而是由 **流式交互的本质特性** 决定的：

#### 1. 两种状态的时效性本质不同

| 维度 | Zustand (流式瞬时态) | React Query (服务端缓存) |
|------|---------------------|------------------------|
| **数据源** | SSE 实时事件流 | REST API 响应 |
| **时效性** | 毫秒级 delta 累积 | 秒级快照查询 |
| **生命周期** | 单次生成（开始→结束） | 跨页面/跨会话持久化 |
| **一致性模型** | 最终一致（delta 可能丢失/重放） | 强一致（DB 是权威来源） |
| **写入频率** | 60ms 批量写入（高频） | 仅在 step/DONE 边界失效重获取 |

流式交互存在一个根本矛盾：**SSE 事件是增量的、可能丢失的、可重放的**，而 **DB 消息是完整的、权威的、不可变的**。这两种数据源无法用同一种状态管理方式处理。

#### 2. 流式→持久切换的必要性

当前架构的核心设计是 **双组件切换**：

```
生成中: StreamingMessage ← Zustand (streamingParts + streamingText + streamingReasoning)
完成后: AssistantMessageGroup ← React Query (DB 消息分页)
```

这个切换不是可选的，而是**必然的**：
- **生成中**：消息尚未完成持久化（工具还在执行），只能从 SSE 事件实时构建渲染数据
- **完成后**：消息已持久化到 DB，React Query 提供缓存、分页、后台刷新等能力

`message-list.tsx` 中的 `showStreamingFallback` 机制（2s 宽限期）正是为了平滑这个切换——避免 StreamingMessage 卸载和 DB 消息加载之间的 1 帧空白。

#### 3. 如果强制统一会怎样？

**方案 A: 全部用 Zustand**
- ❌ 丢失 React Query 的分页、缓存、后台刷新、持久化能力
- ❌ 页面刷新后所有历史消息丢失（除非手动实现持久化）
- ❌ 需要手动实现无限滚动、光标分页等 React Query 开箱即用的功能
- ❌ 多组件订阅同一消息时，需要手动实现引用计数和垃圾回收

**方案 B: 全部用 React Query**
- ❌ SSE delta 高频写入（60ms 一次）会触发查询失效和重获取，性能灾难
- ❌ 流式状态（streamingText, streamingReasoning）是临时性的，不应进入服务端缓存
- ❌ `isGenerating`, `pendingPermission` 等纯 UI 状态不属于服务端数据
- ❌ React Query 的 `structuralSharing` 优化在高频 delta 更新下反而成为性能瓶颈（深比较开销）

**方案 C: 用 Zustand 统一，手动实现类 React Query 能力**
- ❌ 本质是重造轮子，且难以达到 React Query v5 的成熟度
- ❌ 持久化、后台刷新、窗口聚焦重获取等都需要重新实现

#### 4. 当前设计的合理性结论

**双层状态架构是流式交互领域的最佳实践**，与 Claude.ai、ChatGPT Web 的前端架构一致。核心优势：

1. **关注点分离**: Zustand 管理"正在发生的事"，React Query 管理"已经发生的事"
2. **性能隔离**: 高频 SSE delta 不干扰 React Query 的缓存失效策略
3. **可靠性纵深**: SSE 丢失事件时有 DB 恢复路径（`finishFromDatabase()`），DB 恢复失败时有强制 `finishGeneration()` 兜底
4. **渐进降级**: 连接断开 → DB 恢复 → 强制完成，三层安全网

### 可优化方向（不改变双层架构）

虽然双层架构本身合理，但**切换过程中的复杂度**可以优化：

1. **减少切换延迟**: 当前 2s 宽限期 + 500ms 延迟验证重获取 = 用户感知的短暂空白。可以通过在 DONE 后**直接将 Zustand 状态写入 React Query 缓存**（而非等 API 重获取），实现零延迟切换
2. **统一 Part 数据格式**: `PartData`（Zustand）和 `Part.data`（React Query）格式微有差异，导致 `canFinalizeFromCache()` 需要两套判断逻辑
3. **消除 `showStreamingFallback` hack**: 如果切换延迟足够低，2s 宽限期可以缩短或消除

这些优化可以在未来迭代中考虑，不在本次改进范围内。

---

## 未入选项及理由

| 报告建议 | 未入选理由 |
|---------|-----------|
| processor.py 拆分 | 纯架构重构，1690 行虽大但逻辑内聚，拆分需仔细设计模块边界；可在 SSE 状态机设计时一并考虑 |
| 自适应压缩触发 | 改变运行时行为，需大量测试验证不同模型/对话模式的阈值 |
| 流式/持久状态统一 | 经分析，双层架构是流式交互的最佳实践（详见专题分析），不建议统一 |
| Token 管理统一 | 低优先级，当前分散但功能正确 |
