# OpenYak Agent 系统开发文档

## 概述

Agent 是 OpenYak 的核心执行单元。每个 agent 有独立的 system prompt、工具权限和工具列表。7 个内置 agent 覆盖了从全功能助手到上下文压缩的完整需求。

## Agent 架构

### AgentRegistry

**位置**：`backend/app/agent/agent.py`

AgentRegistry 是 agent 的中央注册表，管理所有可用 agent。

**核心功能**：
- `get(name)` — 获取 agent 信息
- `list_primary()` — 列出用户可选的 primary agent
- `list_subagents()` — 列出子 agent
- `filter_tools(agent, tool_registry)` — 按 agent 配置过滤可用工具

### AgentInfo 数据结构

```python
@dataclass
class AgentInfo:
    name: str                      # Agent 名称（唯一标识）
    description: str               # 用户可见描述
    mode: str                      # 模式：primary / subagent / hidden
    tools: list[str]               # 工具列表（空=所有工具）
    permissions: Ruleset           # 权限规则集
    system_prompt: str             # System prompt 文本
```

### AgentInfo 模式

| 模式 | 说明 | UI 可见 | 调用方式 |
|------|------|---------|----------|
| `primary` | 主 Agent | agent 选择器中可见 | 用户直接选择 |
| `subagent` | 子 Agent | 不可见 | 通过 task 工具启动 |
| `hidden` | 隐藏 Agent | 不可见 | 系统内部自动调用 |

## 内置 Agent 详解

### build（主 Agent）

全功能助手，拥有所有工具，危险工具需要用户确认。

```python
"build": AgentInfo(
    name="build",
    description="Full-featured AI assistant with all tools",
    mode="primary",
    tools=[],  # 空 = 所有工具
    permissions=Ruleset(rules=[
        PermissionRule(action="allow", permission="*"),
        PermissionRule(action="ask", permission="bash"),
        PermissionRule(action="allow", permission="code_execute"),
        PermissionRule(action="ask", permission="write"),
        PermissionRule(action="ask", permission="edit"),
        PermissionRule(action="allow", permission="plan"),
    ]),
    system_prompt=_load_prompt("build"),
)
```

### plan（主 Agent）

只读分析模式，拒绝所有修改操作。

```python
"plan": AgentInfo(
    name="plan",
    description="Read-only analysis and planning mode",
    mode="primary",
    tools=[],
    permissions=Ruleset(rules=[
        PermissionRule(action="allow", permission="*"),
        PermissionRule(action="deny", permission="write"),
        PermissionRule(action="deny", permission="edit"),
        PermissionRule(action="deny", permission="bash"),
        PermissionRule(action="deny", permission="code_execute"),
        PermissionRule(action="allow", permission="read"),
        PermissionRule(action="allow", permission="glob"),
        PermissionRule(action="allow", permission="grep"),
        PermissionRule(action="allow", permission="plan"),
        PermissionRule(action="allow", permission="submit_plan"),
        PermissionRule(action="allow", permission="skill"),
    ]),
    system_prompt=_load_prompt("plan"),
)
```

### explore（子 Agent）

快速搜索与探索，只有只读工具。

```python
"explore": AgentInfo(
    name="explore",
    description="Fast search and exploration subagent",
    mode="subagent",
    tools=["read", "glob", "grep", "search", "bash", "web_fetch", "web_search", "skill"],
    permissions=Ruleset(rules=[
        PermissionRule(action="deny", permission="*"),
        PermissionRule(action="allow", permission="read"),
        PermissionRule(action="allow", permission="glob"),
        PermissionRule(action="allow", permission="grep"),
        PermissionRule(action="allow", permission="search"),
        PermissionRule(action="allow", permission="bash"),
        PermissionRule(action="allow", permission="web_fetch"),
        PermissionRule(action="allow", permission="web_search"),
    ]),
    system_prompt=_load_prompt("explore"),
)
```

### general（子 Agent）

通用型子 Agent，拥有所有工具访问权限（危险操作需确认）。

```python
"general": AgentInfo(
    name="general",
    description="General-purpose subagent with full access",
    mode="subagent",
    tools=[],
    permissions=Ruleset(rules=[
        PermissionRule(action="allow", permission="*"),
        PermissionRule(action="deny", permission="todo"),
        PermissionRule(action="ask", permission="bash"),
        PermissionRule(action="allow", permission="code_execute"),
        PermissionRule(action="ask", permission="write"),
        PermissionRule(action="ask", permission="edit"),
    ]),
    system_prompt=_load_prompt("build"),  # 复用 build prompt
)
```

### compaction / title / summary（隐藏 Agent）

系统内部 agent，无工具权限，用于上下文压缩摘要、标题生成和统计计算。

```python
"compaction": AgentInfo(
    name="compaction",
    description="Context summarization agent (no tools)",
    mode="hidden",
    tools=[],
    permissions=Ruleset(rules=[
        PermissionRule(action="deny", permission="*"),
    ]),
    system_prompt=_load_prompt("compaction"),
)
```

## 权限系统

### 4 层权限架构

权限按以下顺序评估，后评估的规则可以覆盖先评估的：

```
1. 全局权限 (GLOBAL_RULES)
   ↓
2. Agent 权限 (agent.permissions.rules)
   ↓
3. 用户权限 (user_permissions)
   ↓
4. 会话权限 (session_permissions)
```

### 权限动作

| 动作 | 说明 | SSE 事件 |
|------|------|----------|
| `allow` | 直接允许执行 | 无 |
| `deny` | 直接拒绝执行 | agent_error |
| `ask` | 询问用户确认 | permission_request |

### 规则格式

```python
PermissionRule(
    action="allow",     # allow / deny / ask
    permission="bash"   # 工具名称或 "*" (通配符)
)
```

### 规则评估优先级

规则按列表顺序评估，**最后匹配的规则生效**：

```python
Ruleset(rules=[
    PermissionRule(action="allow", permission="*"),      # 允许所有
    PermissionRule(action="ask", permission="bash"),      # bash 需要确认
    PermissionRule(action="ask", permission="write"),     # write 需要确认
])
# 结果：bash → ask, write → ask, 其他 → allow
```

### 权限评估代码

```python
# agent/permission.py
async def evaluate(
    tool_name: str,
    agent: str,
    user_permissions: dict | None = None,
    session_permissions: dict | None = None,
) -> str:
    """评估权限，返回 'allow' | 'deny' | 'ask'"""
    result = "allow"  # 默认允许

    # 1. 全局规则
    for rule in GLOBAL_RULES:
        if _matches(rule.permission, tool_name):
            result = rule.action

    # 2. Agent 规则
    agent_info = agent_registry.get(agent)
    for rule in agent_info.permissions.rules:
        if _matches(rule.permission, tool_name):
            result = rule.action

    # 3. 用户规则
    if user_permissions:
        for rule in user_permissions.get("rules", []):
            if _matches(rule["permission"], tool_name):
                result = rule["action"]

    # 4. 会话规则
    if session_permissions:
        for rule in session_permissions.get("rules", []):
            if _matches(rule["permission"], tool_name):
                result = rule["action"]

    return result
```

## System Prompt 系统

### Prompt 模板文件

存储在 `backend/app/agent/prompts/` 目录：

```
prompts/
├── build.txt       # build agent 的 system prompt
├── plan.txt        # plan agent 的 system prompt
├── explore.txt     # explore agent 的 system prompt
├── compaction.txt  # compaction agent 的 prompt
├── title.txt       # title agent 的 prompt
└── summary.txt     # summary agent 的 prompt
```

### Prompt 加载

```python
def _load_prompt(name: str) -> str:
    """加载 prompt 模板文件"""
    path = PROMPTS_DIR / f"{name}.txt"
    if path.exists():
        return path.read_text(encoding="utf-8")
    return ""
```

### System Prompt 组装

在 `session/system_prompt.py` 中，最终发送给 LLM 的 system prompt 由以下部分组成：

```
System Prompt =
  1. Agent 的 base prompt (来自 prompts/build.txt 等)
  2. 工具定义段落 (来自 ToolRegistry 的参数 schema)
  3. 记忆注入段落 (来自 Memory 系统的相关事实)
  4. 工作区记忆段落 (来自 Workspace Memory)
  5. 上下文压缩边界 (如果存在历史压缩)
```

## 创建自定义 Agent

### 步骤 1：定义 AgentInfo

在 `backend/app/agent/agent.py` 的 `BUILTIN_AGENTS` 中添加：

```python
BUILTIN_AGENTS["code_review"] = AgentInfo(
    name="code_review",
    description="代码审查专家，专注于代码质量和安全性",
    mode="primary",
    tools=["read", "glob", "grep", "search"],  # 只读工具
    permissions=Ruleset(rules=[
        PermissionRule(action="deny", permission="*"),
        PermissionRule(action="allow", permission="read"),
        PermissionRule(action="allow", permission="glob"),
        PermissionRule(action="allow", permission="grep"),
        PermissionRule(action="allow", permission="search"),
        PermissionRule(action="allow", permission="skill"),
    ]),
    system_prompt=_load_prompt("code_review"),
)
```

### 步骤 2：创建 System Prompt

在 `backend/app/agent/prompts/` 创建 `code_review.txt`：

```
你是一个代码审查专家，专注于代码质量、安全性和最佳实践。

你的职责：
1. 审查代码的语法和逻辑错误
2. 检查潜在的安全漏洞
3. 评估代码的可读性和可维护性
4. 提供改进建议

注意：你只能读取代码，不能修改。
```

### 步骤 3：前端自动发现

Primary 模式的 agent 会自动出现在前端 agent 选择器中（通过 `GET /api/agents` 返回）。

## Agent 执行流程

### 完整循环

```
1. 用户选择 agent（如 build）
   ↓
2. SessionPrompt._setup()
   → 解析 agent, model, provider
   → 构建 system_prompt
   ↓
3. SessionPrompt.run() — Agent Loop
   │
   ├─ SessionProcessor（每步新建）
   │   ├─ stream_llm() → 流式调用
   │   ├─ 解析 tool_calls
   │   ├─ 权限检查 evaluate()
   │   ├─ doom loop 检测
   │   ├─ 执行工具
   │   └─ 返回 Continue / Stop / Compact
   │
   ├─ if Compact: await compact_context()
   └─ while Continue
   ↓
4. 后处理
   → 异步生成标题
   → 异步计算摘要
   → 异步提取记忆
```

### 子 Agent 调用

主 agent 通过 task 工具启动子 agent：

```python
# task 工具的参数
{
    "agent": "explore",
    "prompt": "搜索项目中的配置文件"
}
```

子 agent 在独立上下文中执行，完成后将结果返回给主 agent。

## Doom Loop 检测

`session/loop_detection.py` 检测 agent 是否陷入重复调用同一工具的死循环：

```python
def detect_doom_loop(
    tool_history: list[str],
    max_repeats: int = 3,
) -> bool:
    """检测最近 N 步是否重复调用同一工具"""
    if len(tool_history) < max_repeats:
        return False
    recent = tool_history[-max_repeats:]
    return len(set(recent)) == 1
```

当检测到 doom loop 时，agent 会被强制停止。

## 常见问题

### 如何让 agent 记住之前的对话？

Agent 通过消息历史记住上下文。历史包含用户消息、助手消息、工具调用和工具结果。长对话会通过三层压缩策略自动管理。

### 如何限制 agent 的响应长度？

通过 LLM 参数控制（在 provider.stream_chat 中传递 max_tokens）。

### 如何调试 agent 权限？

```python
from app.agent.permission import evaluate

result = await evaluate("bash", "build")
print(result)  # "ask"
```

## 相关文档

- [后端开发指南](./03-后端开发指南.md)
- [工具系统开发](./07-工具系统开发.md)
- [架构设计](./02-架构设计.md)
