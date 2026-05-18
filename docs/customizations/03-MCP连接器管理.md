# 03 - MCP 连接器管理

> **定制编号**: XFLOW-015 + 后续演进  
> **涉及提交**: `f756ad9`, `7ac0fab`, `4ac128b`, `8d7f6b1`, `e7b9a87`  
> **涉及范围**: 内置 MCP + MCP 管理页 + 动态配置热重载 + headers 支持

---

## 一、功能概述

本模块记录了 MCP（Model Context Protocol）连接器管理功能的完整演进历程：

1. **内置零配置 MCP**：预装无需 API Key 的搜索工具
2. **MCP 管理页**：设置页新增 MCP 标签页，可视化管理
3. **动态配置热重载**：保存即生效，无需重启
4. **headers 字段支持**：remote 类型 MCP 支持自定义请求头
5. **最终精简**：移除所有内置 MCP，完全用户自配置

---

## 二、内置零配置 MCP（初始实现 → 最终移除）

### 2.1 初始设计（f756ad9）

**后端**：`backend/app/connector/registry.py`

新增 `ConnectorRegistry.register_builtin_mcps()`，在 `main.py` 启动时注册四个零配置 MCP：

| MCP 名称 | 类型 | 功能 |
|----------|------|------|
| open-websearch | local stdio | Bing/百度/DDG/Brave/CSDN/掘金搜索 |
| ignidor-web-search | local stdio | DuckDuckGo + BM25 排序 + YouTube 字幕 |
| context7 | local stdio | 开源库文档查询 |
| grep-app | remote | GitHub 代码搜索（mcp.grep.app） |

**ConnectorInfo 扩展**：

```python
# backend/app/connector/model.py
class ConnectorInfo:
    no_auth_required: bool = False  # 新增：零认证标识
```

**McpManager 跳过逻辑**：对 `no_auth_required=True` 的连接器跳过 `needs_auth` 状态提升。

**前端适配**：`frontend/src/app/(main)/plugins/content.tsx`

`no_auth_required=true` 时：
- 隐藏 local-setup 徽标
- 隐藏 OAuth Connect 按钮
- 隐藏 Token/PAT 输入框
- 跳过自动触发 OAuth 逻辑

**PATH 修复**：

`ConnectorRegistry.startup()` 对所有 local stdio 连接器注入 `_build_local_env()`：
- 保留完整 `os.environ`
- 前置 Homebrew/Volta/nvm 等常见 Node.js 路径
- 修复 Tauri 应用 PATH 剥离导致 npx 不可用问题
- 修复 open-websearch 传递 `environment={MODE:stdio}` 覆盖 PATH 的 bug

### 2.2 演进过程

| 提交 | 变更 |
|------|------|
| `7ac0fab` | 移除 ignidor-web-search；open-websearch 设置 `DEFAULT_SEARCH_ENGINE=bing`、`SEARCH_MODE=request` |
| `e7b9a87` | 移除 open-websearch，简化桌面端启动 URL 缓存逻辑 |
| `8d7f6b1` | 移除全部内置 MCP（Context7、Grep.app），所有 MCP 改为用户配置 |

### 2.3 最终状态

所有内置 MCP 均已移除，`register_builtin_mcps()` 清空为空列表。MCP 完全由用户通过 MCP 管理页自配置。

**关键设计决策**：内置 MCP 从"零配置预装"演变为"完全用户自配置"，因为：
- 不同用户需求差异大
- 内置 MCP 需要维护 npx 路径兼容性
- 减少桌面端启动依赖

---

## 三、MCP 管理页（XFLOW-015）

### 3.1 设置页集成

**`frontend/src/components/settings/settings-tabs.ts`**：新增 `mcp` 标签条目

**`frontend/src/components/settings/settings-layout.tsx`**：新增 MCP Tab 布局

### 3.2 MCP Tab 组件

**新增文件**：`frontend/src/components/settings/mcp-tab.tsx`

#### 布局结构

```
┌─────────────────────────────────────┐
│ MCP 服务器管理                        │
├─────────────────────────────────────┤
│ 内置零配置 MCP                        │  ← 后续移除
│  ├ Context7  [开关] [状态] [工具数]    │
│  └ Grep.app  [开关] [状态] [工具数]    │
├─────────────────────────────────────┤
│ 自定义 MCP 服务器                     │
│  ├ Server A  [开关] [状态] [编辑][删除] │
│  └ Server B  [开关] [状态] [编辑][删除] │
│  [+ 添加服务器]                       │
└─────────────────────────────────────┘
```

#### 组件拆分

- **BuiltinMcpRow**：内置 MCP 行（启用/禁用开关 + 连接状态 + 工具数）
- **CustomMcpRow**：自定义 MCP 行（开关 + 状态 + 编辑 + 删除）
- **Add/Edit Dialog**：添加/编辑对话框（URL 或 stdio 命令 + headers）

#### 对话框模式（4ac128b 重构后）

从简单的内联表单重构为对话框式管理：

- **添加对话框**：选择 remote/local 类型 → 输入 URL 或命令 → 可选 headers
- **编辑对话框**：修改已有配置 → 保存后热重载
- **删除确认**：二次确认删除

### 3.3 Hook

**新增文件**：`frontend/src/hooks/use-mcp-config.ts`

```typescript
export function useMcpConfig(): UseQueryResult<McpUserConfig>
export function useUpdateMcpConfig(): UseMutationResult
```

### 3.4 类型定义

**`frontend/src/types/connectors.ts`**：

```typescript
export interface McpServerConfig {
  id: string;
  name: string;
  type: "remote" | "local";
  url?: string;           // remote 类型
  command?: string;       // local stdio 类型
  args?: string[];        // local stdio 参数
  enabled: boolean;
  headers?: Record<string, string>;  // 4ac128b 新增
}
```

---

## 四、后端 MCP 动态配置

### 4.1 配置持久化

**`backend/app/connector/registry.py`**：

用户配置持久化到 `.openyak/mcp-servers.json`：

```python
# 新增方法
async def load_user_mcps(self) -> dict
async def save_user_mcps(self, config: dict) -> None
async def register_user_mcps(self) -> None
async def apply_user_mcps(self, config: dict) -> None
```

### 4.2 热重载流程

```
用户保存 MCP 配置
    ↓
apply_user_mcps()
    ↓
1. 断开旧连接器（按新配置中不存在/禁用的项）
2. 注册新连接器
3. 重连已启用项
4. 刷新工具注册表（sync_tools）
    ↓
前端自动刷新状态
```

### 4.3 API 端点

**`backend/app/api/mcp.py`**：

```
GET  /api/mcp/user-config    # 获取用户 MCP 配置
PUT  /api/mcp/user-config    # 保存用户 MCP 配置（触发热重载）
```

### 4.4 headers 字段支持（4ac128b）

**后端**：`ConnectorRegistry` 解析与持久化 remote 类型 MCP 的 `headers` 配置

**前端**：`mcp-tab.tsx` 对话框中新增 headers 编辑区域

```typescript
// headers 编辑 UI
headers: [
  { key: "Authorization", value: "Bearer xxx" },
  { key: "X-Custom-Header", value: "..." },
]
```

保存后立即生效，无需重启。

---

## 五、后端 MCP 连接异步化（f71e07c）

### 5.1 问题

原实现中，MCP 连接在 `main.py` lifespan 中同步执行，阻塞 HTTP 服务就绪。

### 5.2 解决方案

**`backend/app/main.py`**：

```python
# 重构前：MCP 连接阻塞启动
await connector_registry.startup()

# 重构后：MCP 连接移至后台任务
async def _startup_mcp():
    await connector_registry.startup()
    await connector_registry.sync_tools()

async with lifespan(app):
    # ToolRegistry 先注册（不依赖 MCP）
    # MCP 连接改为后台任务
    mcp_task = asyncio.create_task(_startup_mcp())
    yield  # HTTP 服务立即就绪
    # 关闭时取消后台任务
    mcp_task.cancel()
```

### 5.3 工具注册

后端启动后通过 `connector_registry.sync_tools()` 动态注册发现的 MCP tools，确保 MCP 连接完成后的工具也能被 AI 使用。

---

## 六、连接器标签页过滤

**`frontend/src/app/(main)/plugins/content.tsx`**：

过滤掉 `__builtin__` 和 `user-config` 来源的连接器，插件标签页只展示 OAuth 服务集成类连接器。

---

## 七、涉及文件清单

| 文件路径 | 变更类型 | 说明 |
|---------|---------|------|
| `backend/app/connector/registry.py` | 修改 | 内置 MCP、用户配置、热重载、headers、PATH 注入 |
| `backend/app/connector/model.py` | 修改 | no_auth_required 字段 |
| `backend/app/data/connectors.json` | 修改 | 内置 MCP 配置（最终精简） |
| `backend/app/api/mcp.py` | 修改 | user-config API 端点 |
| `backend/app/main.py` | 修改 | MCP 启动逻辑、后台任务 |
| `backend/app/mcp/manager.py` | 修改 | 跳过零认证连接器 |
| `frontend/src/components/settings/mcp-tab.tsx` | 新增 | MCP 管理页面 |
| `frontend/src/hooks/use-mcp-config.ts` | 新增 | MCP 配置 Hook |
| `frontend/src/types/connectors.ts` | 修改 | McpServerConfig 类型 |
| `frontend/src/app/(main)/plugins/content.tsx` | 修改 | 过滤内置/用户配置连接器 |
| `frontend/src/i18n/locales/{en,zh}/settings.json` | 修改 | MCP 标签名 |
| `scripts/verify-bundle.mjs` | 修改 | smoke test 两阶段探测 |

---

## 八、重新实现检查清单

- [ ] `ConnectorInfo.no_auth_required` 字段（如需保留零认证标识）
- [ ] MCP 管理页 Tab（对话框式 CRUD + 启用/禁用开关 + 状态显示）
- [ ] `McpServerConfig` 类型含 `headers` 字段
- [ ] 后端 `load/save/register/apply_user_mcps` 方法
- [ ] 配置持久化到 `.openyak/mcp-servers.json`
- [ ] 热重载流程（断旧→注册新→重连→sync_tools）
- [ ] `GET/PUT /api/mcp/user-config` API 端点
- [ ] MCP 连接异步化（`asyncio.create_task`，不阻塞 HTTP 就绪）
- [ ] `sync_tools()` 动态工具注册
- [ ] 插件标签页过滤 `__builtin__` 和 `user-config` 来源
- [ ] `_build_local_env()` PATH 注入（Tauri 环境兼容）
- [ ] smoke test 两阶段探测（`/health` 60s + `/m` 验证）
