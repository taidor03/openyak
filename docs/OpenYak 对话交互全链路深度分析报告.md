# OpenYak 对话交互全链路深度分析报告

> 生成日期: 2026-05-19  
> 范围: 从用户输入开始，经过对话发展逻辑处理、工具调用机制、与LLM模型交互流程，直至对话内容生成与最终显示的完整过程

---

## 一、系统架构总览

OpenYak 采用 **三层分离架构**：Tauri 桌面壳（Rust）→ Python 后端（FastAPI）→ React 前端（Next.js 15）。核心设计决策（ADR-0001）：Tauri 仅负责壳层关注（窗口、进程管理、原生对话框），所有 AI/Agent/Tool 逻辑驻留在 Python 后端，前端通过 HTTP + SSE 与后端通信。

```
┌─────────────────────────────────────────────────────────────────────┐
│                    Tauri Shell (Rust, ~1,700行)                      │
│  backend.rs: Python子进程生命周期  commands.rs: 11个IPC命令           │
│  tray.rs: 系统托盘  menu.rs: 原生菜单  lib.rs: 插件注册+事件循环      │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ Tauri IPC (invoke/listen)
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│              React Frontend (Next.js 15 + React 19, ~50+组件)       │
│  Zustand: 流式瞬时态  React Query: 服务端缓存  SSE: 实时推送          │
│  hooks/: use-chat, use-sse, use-messages, use-sessions              │
│  components/: chat/, messages/, parts/, artifacts/, interactive/    │
└──────────────────────────┬──────────────────────────────────────────┘
                           │ HTTP + SSE (localhost:{port})
                           ▼
┌─────────────────────────────────────────────────────────────────────┐
│              Python Backend (FastAPI + SQLAlchemy async)             │
│  session/: 核心Agent循环 (prompt→processor→compaction)               │
│  provider/: LLM提供者抽象 (7个实现)  tool/: 工具系统 (~30个工具)      │
│  streaming/: SSE基础设施  agent/: 代理注册+权限引擎                   │
│  mcp/: MCP协议集成  channels/: 外部通道适配 (10+平台)                 │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 二、全链路数据流：从用户输入到内容显示

### 2.1 完整请求生命周期

```
用户输入文本/附件
    │
    ▼
[前端] ChatForm → useChat.sendMessage()
    │  ├─ beginSending(): 乐观更新用户气泡 (Zustand)
    │  ├─ POST /chat/prompt {session_id, text, model?, attachments[], ...}
    │  └─ 失败回滚: 恢复输入框内容
    │
    ▼
[后端] chat.py: start_prompt()
    │  ├─ 图像检查: 非视觉模型拒绝附件
    │  ├─ StreamManager.create_job(stream_id, session_id)
    │  ├─ 获取信号量 (max_concurrent_generations=1, 30s超时)
    │  └─ 启动后台任务 run_generation()
    │       │
    │       ▼
    │  SessionPrompt.run()
    │    ├─ _setup(): 解析Agent/Model/Provider, 构建系统提示, 合并权限
    │    └─ _loop(): while循环 (每步一个SessionProcessor)
    │         │
    │         ▼
    │    SessionProcessor.process() [单步]
    │      ├─ 加载历史消息 → 微压缩 → 工具结果预算 → 中间件链
    │      ├─ provider.stream_chat() → 流式LLM输出
    │      │    ├─ text-delta → SSE TEXT_DELTA
    │      │    ├─ reasoning-delta → SSE REASONING_DELTA
    │      │    └─ tool-call → 收集工具调用
    │      ├─ 工具分派: StreamingToolExecutor
    │      │    ├─ 并行安全工具: 立即asyncio.create_task
    │      │    ├─ 独占工具: 排队顺序执行
    │      │    └─ 权限检查 → "ask" → SSE PERMISSION_REQUEST → 阻塞
    │      ├─ 上下文溢出检查 → 压缩 (3层策略)
    │      └─ 返回 "continue" | "stop" | "compact"
    │
    ▼
[前端] SSE消费链路
    │  SSEClient (EventSource/fetch+ReadableStream)
    │    → useSSE (事件分发, 60ms ProgressiveBuffer)
    │      → chatStore (Zustand: 流式状态更新)
    │        → React组件重渲染
    │
    ▼
[前端] 消息渲染
    MessageList → AssistantMessageGroup → MessageContent
      → Part渲染器 (13种): TextPart, ReasoningPart, ToolPart,
         CompactionPart, SubtaskPart, FilePart, StepStartPart, ...
```

### 2.2 关键时序：发送消息到看到第一个token

| 阶段 | 耗时估计 | 关键操作 |
|------|---------|---------|
| 用户点击发送 → API请求发出 | ~50ms | 乐观更新用户气泡, fetch POST |
| 后端接收 → 创建GenerationJob | ~10ms | 信号量获取, 后台任务启动 |
| _setup() 完成 | ~200-500ms | Agent/Model解析, 系统提示组装, 权限合并, DB写入 |
| 历史消息加载+压缩 | ~100-300ms | DB查询, 微压缩, 工具结果预算, 中间件 |
| LLM首token延迟 (TTFT) | ~500-3000ms | provider.stream_chat() 首个chunk |
| SSE传输到前端 | ~10ms | GenerationJob.publish() → 订阅者队列 |
| ProgressiveBuffer刷新 | ≤60ms | 60ms批量合并delta |
| React重渲染 | ~16ms | Zustand → 组件更新 |

**端到端首token延迟**: ~1-4秒 (主要瓶颈在LLM TTFT)

---

## 三、后端核心链路深度分析

### 3.1 数据模型层

**Session** (`backend/app/models/session.py`):
- ULID主键, 关联Project (workspace持久化记录)
- `summary_additions/deletions/files/diffs`: 每步后的变更统计
- `permission: list[dict]`: 会话级权限覆盖 (JSON列)
- `time_compacting/time_archived`: 压缩/归档时间戳

**Message** (`backend/app/models/message.py`):
- ULID主键, 关联Session (CASCADE删除)
- `data: JSON`: 完整MessageInfo
  - 用户消息: `{role, model:{provider_id, model_id}, agent, system?, variant?, tools?}`
  - 助手消息: `{role, parent_id, agent, model_id, provider_id, cost, tokens, error?, finish?}`

**Part** (`backend/app/models/message.py`):
- ULID主键, 反规范化 `session_id` (索引 `ix_part_session_id`)
- `data: JSON`: 按 `type` 字段区分的8种Part:
  - `text`: `{type, text, synthetic?}`
  - `reasoning`: `{type, text}`
  - `tool`: `{type, tool, call_id, state:{status, input, output?, metadata?, title?}}`
  - `step-start`: `{type, step, snapshot?}`
  - `step-finish`: `{type, reason, tokens, cost}`
  - `compaction`: `{type, auto}`
  - `subtask`: `{type, session_id, title, description}`
  - `file`: `{type, file_id, name, path, size, mime_type, source, content_hash}`

### 3.2 Agent编排循环 (`backend/app/session/prompt.py`)

```
SessionPrompt.run()
  ├─ _setup()
  │   ├─ AgentRegistry.get() → 解析代理配置
  │   ├─ ProviderRegistry.resolve_model() → 解析模型+提供者
  │   ├─ 创建/加载Session + 持久化用户消息+附件
  │   ├─ system_prompt.assemble() → 构建系统提示
  │   │   ├─ 缓存段: 代理system_prompt + 项目说明(AGENTS.md)
  │   │   └─ 动态段: 工作区内存 + 技能路由 + 环境信息
  │   └─ 4层权限合并: 全局默认 → 代理级 → 预设 → 请求 → 会话
  │
  ├─ _loop() [while True]
  │   ├─ step++ (硬上限50步)
  │   ├─ 发布 STEP_START SSE事件
  │   ├─ 加载历史 → 微压缩(L1) → 工具结果预算(L2) → 中间件链
  │   ├─ SessionProcessor.process() [单步处理]
  │   ├─ 结果判断:
  │   │   ├─ "compact" → 上下文折叠(L3) → 完整压缩(L4) → continue
  │   │   ├─ "stop" → 继续守卫检查 → break
  │   │   └─ "continue" → 下一步
  │   └─ 继续守卫: 长度续写(≤3次) → 首轮工具提示 → 未完成TODO续写
  │
  └─ _post_loop()
      ├─ 持久化累计cost/token
      ├─ 自动标题 (首次交互)
      ├─ 排队工作区内存刷新
      └─ 发布 DONE SSE事件
```

### 3.3 单步处理器 (`backend/app/session/processor.py`, ~1500行)

10个阶段:

1. **初始化**: 步进累加器 + StreamingToolExecutor
2. **持久化 step-start Part**
3. **LLM流式调用+重试**: `stream_llm()` → `provider.stream_chat()`, 最多3次重试(指数退避)
4. **错误处理**: 上下文溢出 → "compact"; 其他 → 错误完成
5. **空输出处理**: 删除空助手消息, 继续循环
6. **持久化 text+reasoning Parts**
7. **工具分派**: 提交给StreamingToolExecutor, 收集结果
8. **计算步进成本**
9. **持久化 step-finish Part**
10. **上下文溢出检查** → 返回 "continue"/"stop"/"compact"

### 3.4 工具执行引擎 (`backend/app/session/tool_executor.py`)

受Claude Code启发的设计:
- **LLM流式传输期间**: 并行安全工具(read/glob/grep/search/web_fetch等)立即启动
- **流式传输后**: 独占工具(write/edit/bash等)顺序执行
- **兄弟中止**: bash失败时取消所有并行兄弟任务
- 结果按提交索引排序返回

工具调用处理流程:
```
tool-call流块 → 循环检测(2级: 警告→阻断)
  → 工具解析(精确匹配→小写→invalid回退)
  → 权限检查(2维: 工具名×资源模式)
  → "ask"动作 → SSE PERMISSION_REQUEST → 阻塞等待用户响应
  → 持久化"running"状态 → 构建ToolContext → 提交执行器
```

### 3.5 Provider系统 (`backend/app/provider/`)

**BaseProvider ABC** (4个抽象方法):
- `id` → 提供者标识
- `list_models()` → 可用模型列表
- `stream_chat()` → 流式聊天 (AsyncIterator[StreamChunk])
- `health_check()` → 健康状态

**7个实现**:

| 提供者 | 类 | 特点 |
|--------|-----|------|
| Anthropic | AnthropicDesktopProvider | 提示缓存, 扩展思考, 原生工具 |
| Gemini | GeminiDesktopProvider | 思考, 多模态, 原生函数调用 |
| OpenAI兼容 | OpenAICompatProvider | 通用 /v1/chat/completions |
| Ollama | OllamaProvider | 扩展OpenAICompat, 本地模型发现 |
| OpenRouter | OpenRouterProvider | 聚合器, 优先于直接提供者 |
| GenericOpenAI | GenericOpenAIProvider | Azure/自定义端点 |
| 本地/MLX | LocalProvider/RapidMlxProvider | 本地推理 |

**StreamChunk规范化**: text-delta, reasoning-delta, tool-call, web-search-start/result, usage, finish, error

**模型解析**: `ProviderRegistry` 维护双层索引 — 快速索引(model_id→provider)优先直接提供者, 完整列表用于按提供者过滤。

### 3.6 SSE流式基础设施 (`backend/app/streaming/`)

**GenerationJob** 核心状态:
- `stream_id`, `session_id`, `abort_event`
- 事件缓冲区 (最多5000事件, 用于重连重放)
- 多订阅者队列 (每个SSE连接一个asyncio.Queue)
- `_response_futures: dict[str, asyncio.Future]` — 权限/问题阻塞
- `artifact_cache: dict` — 跨生成更新

**18种SSE事件类型**: text-delta, reasoning-delta, tool-call, tool-result, tool-error, step-start, step-finish, compacted, compaction-start/phase/progress/error, permission-request, question, title-update, retry, desync, done, agent-error, plan-review, model-loading, permission-resolved, question-resolved

**重连机制**: 客户端发送 `Last-Event-ID` → 服务端从缓冲区重放 → 缓冲区溢出则发送DESYNC

### 3.7 压缩策略 (4层)

| 层级 | 策略 | LLM成本 | 实现 |
|------|------|---------|------|
| L1 | 微压缩 | 零 | 替换旧工具输出为存根 (保护最近2轮) |
| L2 | 工具结果预算 | 零 | 强制总token上限100K, 超出替换最大项 |
| L3 | 上下文折叠 | 零 | 丢弃最旧1/3消息, 插入合成边界 |
| L4 | LLM摘要 | 有 | compaction代理生成结构化摘要 |

触发条件: `should_compact()` — 总使用量 ≥ 模型最大上下文的85%

### 3.8 权限引擎 (`backend/app/agent/permission.py`)

4层"最后匹配胜出"模型:
```
GLOBAL_DEFAULTS → Agent.permissions → presets_ruleset → request_rules → session_rules
```

2维匹配 (工具名 × 资源模式): `evaluate(permission="read", pattern="*.env", ruleset)`
动作: `allow` | `deny` | `ask` (交互式阻塞)

### 3.9 MCP集成 (`backend/app/mcp/`)

```
ConnectorRegistry (管理连接器状态+持久化)
  └─ McpManager (多服务器生命周期+OAuth)
      ├─ McpClient (每个服务器1个 — stdio/SSE/流式HTTP)
      └─ McpToolWrapper (适配 MCP工具 → ToolDefinition)
```

**延迟工具发现**: `tool_search` 工具让模型按需发现MCP工具, 避免一次性注入过多工具定义。

---

## 四、前端交互链路深度分析

### 4.1 双层状态架构

| 层 | 技术 | 用途 | 持久性 |
|----|------|------|--------|
| 流式瞬时态 | Zustand (chat-store, 569行, 25+actions) | SSE delta累积, 流式渲染 | 会话级, 不持久化 |
| 服务端缓存 | TanStack React Query v5 | 消息/会话列表, 10s轮询 | 自动失效+重获取 |

**关键设计**: 流式delta走Zustand (避免React Query缓存抖动); 持久化数据走React Query无限查询。

### 4.2 SSE消费链路 (`frontend/src/hooks/use-sse.ts`, 836行)

```
SSEClient (lib/sse.ts)
  ├─ 本地连接: 原生EventSource (GET)
  └─ 远程/隧道: fetch POST + ReadableStream (Cloudflare缓冲GET SSE)
       │
       ▼
useSSE (hooks/use-sse.ts)
  ├─ 15个事件处理器
  ├─ ProgressiveBuffer (60ms批量合并delta)
  │   └─ 防止Chromium/WindowServer卡顿
  ├─ 3个安全网定时器:
  │   ├─ 1.2s debounce: 终端step-finish后检查DB
  │   ├─ 8s硬超时: 强制finishGeneration
  │   └─ 15s空闲恢复: 轮询/chat/active
  ├─ 可见性感知: 远程/移动端后台30s暂停SSE (省电)
  ├─ 去重机制:
  │   ├─ rememberStepFinishId (LRU Set 256) 防止SSE重放双计
  │   └─ eventSessionId guard 丢弃切换聊天后的迟到事件
  └─ 流式回退宽限期: 2s窗口保持StreamingMessage挂载
      (防止DB获取的AssistantMessageGroup渲染前的1帧空白闪烁)
```

### 4.3 消息渲染管线

```
MessageList (501行)
  ├─ 反向无限滚动 + 滚动位置保持
  ├─ 新消息动画检测
  ├─ 未读计数
  └─ groupMessages() → 连续助手步骤折叠为单个视觉块
       │
       ▼
AssistantMessageGroup
  ├─ StreamingMessage (流式中, 从Zustand读取)
  └─ AssistantMessage (完成后, 从React Query读取)
       │
       ▼
MessageContent (341行) — Part分发器
  ├─ 8种Part类型 → 13个渲染器
  ├─ 可见工具Part过滤
  ├─ 文件卡片分组
  └─ 活动折叠 (activity folding)
```

### 4.4 输入区域 (`frontend/src/components/chat/chat-form.tsx`, 809行)

5种文件上传路径:
1. 浏览按钮 (Tauri原生对话框 / Web文件选择器)
2. 拖拽 (750ms Tauri冷却期)
3. 粘贴 (剪贴板图片)
4. @提及 (文件搜索)
5. Tauri IPC

其他特性:
- 中文IME组合处理 (`isComposing()` + keyCode 229 + compositionEndedAt时间戳守卫)
- 每会话草稿持久化 (localStorage, 7天过期)
- 代理模式切换
- 成本估算
- 悲观发送/回滚

### 4.5 API客户端层 (`frontend/src/lib/api.ts`)

- 轻量fetch封装 + Bearer认证
- 重试策略: 仅重试TypeError (网络错误), 最多3次指数退避; HTTP错误不重试
- 桌面模式: URL/Token通过Tauri IPC获取, 指数退避重试"not yet available"

---

## 五、Tauri桌面桥接层分析

### 5.1 进程管理 (`desktop-tauri/src-tauri/src/backend.rs`, 875行)

**启动流程**:
1. 选择空闲端口 (复用上次或portpicker)
2. 确定二进制路径 (dev: `python -m uvicorn`; prod: PyInstaller二进制)
3. 设置 `--data-dir` 和 `--resource-dir`
4. 启动子进程 (Stdio::piped → 日志文件)
5. 健康检查: 轮询 `/livez` 最多60次×500ms = 30s超时
6. Token加载: 读取 `session_token.json` (0600权限, 最多5s轮询)
7. 发射 `backend-ready` 事件 → 前端显示窗口
8. 启动看门狗 + 退出监控

**看门狗**: 每10s轮询 `/livez`, 3次连续失败 → 杀进程+自动重启

**自动重启**: 指数退避(1s→2s→4s), 60s内最多3次, 超限发射 `backend-crash`

### 5.2 11个IPC命令

| 命令 | 用途 |
|------|------|
| `get_backend_url` | 返回 `http://127.0.0.1:{port}` |
| `get_backend_token` | 返回Bearer token (从0600文件读取, 仅内存存储) |
| `is_backend_ready` | 后端是否通过健康检查 |
| `get_pending_navigation` | 深度链接路由 (openyak:// scheme) |
| `window_minimize/maximize/close` | 窗口管理 (关闭→隐藏到托盘) |
| `is_maximized` | 窗口状态查询 |
| `get_platform` | 平台检测 |
| `open_external` | 系统浏览器打开URL |
| `download_and_save` | 原生存储对话框+下载 |
| `update_tray_recents` | 重建托盘最近聊天子菜单 |

### 5.3 桌面 vs Web模式差异

| 关注点 | 桌面模式 | Web开发模式 |
|--------|---------|------------|
| 后端URL | IPC获取 `http://127.0.0.1:{port}` | `NEXT_PUBLIC_API_URL` |
| API请求 | 直接HTTP到后端URL | Next.js代理 (相对路径) |
| 认证 | Bearer token (IPC获取) | 无或环境变量 |
| SSE认证 | `?token=` 查询参数 | 无 |
| 后端可用性 | 必须等待健康检查+IPC就绪 | 假定就绪 |

---

## 六、潜在瓶颈与优化方向

### 6.1 性能瓶颈

| 瓶颈 | 位置 | 影响 | 优化方向 |
|------|------|------|---------|
| **单并发生成** | `StreamManager._semaphore` (默认1) | 同一Session只能串行生成 | 考虑跨Session并行 |
| **LLM TTFT** | Provider.stream_chat() | 1-4秒首token延迟 | 提示缓存(Anthropic已支持), 预测性预取 |
| **历史消息加载** | `get_message_history_for_llm()` | 每步DB查询+转换 | 增量缓存, 避免全量重查 |
| **ProgressiveBuffer 60ms** | use-sse.ts | 增加首token显示延迟 | 自适应批量: 首chunk立即刷新, 后续批量 |
| **React Query 10s轮询** | use-messages, use-sessions | 通道消息延迟最高10s | WebSocket推送或SSE通知 |
| **微压缩每步执行** | microcompact.py | CPU开销 | 增量标记, 仅压缩新增内容 |

### 6.2 可靠性风险

| 风险 | 位置 | 严重度 | 描述 |
|------|------|--------|------|
| **SSE重连DESYNC** | streaming/manager.py | 高 | 缓冲区溢出(>5000事件)导致客户端丢失事件 |
| **use-sse定时器泄漏** | hooks/use-sse.ts (836行) | 中 | 6个并发定时器/间隔, 快速导航时可能泄漏 |
| **chat-store状态膨胀** | stores/chat-store.ts | 中 | SSE重放去重Set(256) + 成本对账逻辑, 快速step-finish下状态爆炸 |
| **后端进程崩溃恢复** | backend.rs | 中 | 60s内3次重启上限, 超限后用户需手动重启 |
| **Token同步** | 3处(HTTP头/SSE查询参数/HTTP关闭) | 低 | 重启时需同步清除3处缓存 |
| **chat-form拖拽时序** | chat-form.tsx | 低 | 750ms Tauri冷却期 + 120ms回退定时器, 脆弱时序耦合 |

### 6.3 架构优化建议

1. **流式状态与持久状态统一**: 当前Zustand(流式)和React Query(持久)的双层架构增加了复杂度。可考虑统一为单一状态管理方案, 用乐观更新替代双写。

2. **SSE事件协议精简**: 18种事件类型增加了前端分发复杂度。可按生命周期阶段分组(生成阶段/工具阶段/压缩阶段/交互阶段), 减少处理器数量。

3. **processor.py拆分**: 1500行的单步处理器是最高复杂度文件。建议按阶段拆分为: LLM流式处理、工具分派、成本计算、上下文检查等独立模块。

4. **增量历史加载**: 当前每步全量加载历史消息。可在压缩锚点后增量追加, 避免重复DB查询和格式转换。

5. **自适应压缩触发**: 当前85%阈值固定。可根据模型类型、对话模式(代码vs闲聊)动态调整, 减少不必要的压缩轮次。

6. **前端SSE消费简化**: use-sse.ts的836行和6个定时器是维护负担。可引入状态机模型(连接中/活跃/空闲/重连中/断开), 替代分散的定时器管理。

---

## 七、模块间接口设计总结

### 7.1 后端API接口

| 端点 | 方法 | 请求 | 响应 | 用途 |
|------|------|------|------|------|
| `/chat/prompt` | POST | PromptRequest | `{stream_id, session_id}` | 开始生成 |
| `/chat/stream/{stream_id}` | GET/POST | `?last_event_id=N` | SSE流 | 流式输出 |
| `/chat/abort` | POST | `{session_id}` | - | 中止生成 |
| `/chat/respond` | POST | `{call_id, response}` | - | 响应权限/问题 |
| `/chat/compact` | POST | `{session_id}` | - | 手动压缩 |
| `/chat/edit` | POST | EditRequest | - | 编辑消息+重新生成 |
| `/sessions` | POST | CreateSession | SessionResponse | 创建会话 |
| `/sessions/{id}` | GET | - | SessionResponse | 获取会话 |
| `/sessions/{id}/messages` | GET | `?limit&cursor` | PaginatedMessages | 分页消息 |

### 7.2 Tauri IPC接口

| 命令 | 方向 | 数据 |
|------|------|------|
| `get_backend_url` | TS→Rust | → `http://127.0.0.1:{port}` |
| `get_backend_token` | TS→Rust | → Bearer token |
| `backend-ready` | Rust→TS | 后端就绪通知 |
| `backend-restart` | Rust→TS | 新URL (重启后) |
| `backend-crash` | Rust→TS | 崩溃通知 |
| `navigate` | Rust→TS | 深度链接路由 |
| `maximize-change` | Rust→TS | 窗口状态变化 |

### 7.3 SSE事件协议

| 事件 | 数据 | 前端处理 |
|------|------|---------|
| `text-delta` | `{text}` | 追加到流式文本 |
| `reasoning-delta` | `{text}` | 追加到推理显示 |
| `tool-call` | `{tool, call_id, input}` | 显示工具调用开始 |
| `tool-result` | `{call_id, output, title}` | 显示工具结果 |
| `step-start` | `{step}` | 新步骤指示器 |
| `step-finish` | `{reason, tokens, cost}` | 累计成本/token |
| `permission-request` | `{call_id, permission, pattern}` | 弹出权限对话框 |
| `done` | - | 结束流式, 切换到持久渲染 |
| `compacted` | - | 上下文已压缩通知 |

---

## 八、技术栈全景

| 层 | 技术 | 版本 |
|----|------|------|
| 桌面壳 | Tauri | v2 |
| 桌面语言 | Rust | - |
| 后端框架 | FastAPI | - |
| 后端ORM | SQLAlchemy | async |
| 后端Python | 3.13+ | - |
| 前端框架 | Next.js | 15 (App Router) |
| 前端UI | React | 19 |
| 前端样式 | Tailwind CSS | v4 |
| 状态管理 | Zustand + TanStack React Query | v5 |
| 流式传输 | SSE (EventSource + fetch) | - |
| MCP协议 | mcp Python SDK | - |
| 数据库 | SQLite (via SQLAlchemy) | - |

---

## 九、核心发现总结

1. **架构清晰**: 三层分离(Tauri壳→Python后端→React前端)职责明确，ADR-0001确保AI逻辑不泄漏到壳层
2. **流式架构成熟**: SSE + 事件缓冲 + 重连机制 + ProgressiveBuffer，但use-sse.ts(836行)的6个定时器是维护负担
3. **压缩策略层次化**: 4层从零成本到LLM摘要，但每步全量历史加载是性能瓶颈
4. **工具执行并发化**: StreamingToolExecutor实现流中并行，但processor.py(1500行)需拆分
5. **最大优化杠杆**: LLM TTFT(1-4s)是端到端延迟主因；历史消息增量加载和前端SSE状态机简化是最高ROI改进点
