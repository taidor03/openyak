# 03 - MCP 连接器管理

> **定制编号**: XFLOW-015
> **涉及范围**: MCP 管理页 + 动态配置热重载 + headers 支持 + 后台连接

---

## 一、功能概述

本模块实现了 MCP 连接器的可视化管理、动态配置热重载、以及后台异步连接：

1. **MCP 管理页**：设置页新增 MCP 标签页，对话框式 CRUD 管理
2. **动态配置热重载**：保存即生效，无需重启后端
3. **headers 字段支持**：remote 类型 MCP 支持自定义请求头
4. **后台连接**：MCP 连接移至后台任务，不阻塞 HTTP 服务就绪
5. **连接器标签页过滤**：插件页过滤内置/用户配置来源的连接器

---

## 二、MCP 管理页（XFLOW-015）

### 2.1 设置页集成

**`frontend/src/components/settings/settings-tabs.ts`**：新增 `mcp` 标签条目

**`frontend/src/components/settings/settings-layout.tsx`**：新增 MCP Tab 布局

### 2.2 MCP Tab 组件

**新增文件**：`frontend/src/components/settings/mcp-tab.tsx`

#### 布局结构

```
┌─────────────────────────────────────┐
│ MCP 服务器管理                        │
├─────────────────────────────────────┤
│ 自定义 MCP 服务器                     │
│  ├ Server A  [开关] [状态] [编辑][删除] │
│  └ Server B  [开关] [状态] [编辑][删除] │
│  [+ 添加服务器]                       │
└─────────────────────────────────────┘
```

#### 组件拆分

- **CustomMcpRow**：自定义 MCP 行（开关 + 状态 + 编辑 + 删除）
- **Add/Edit Dialog**：添加/编辑对话框（URL 或 stdio 命令 + headers）

#### 对话框式管理

- **添加对话框**：选择 remote/local 类型 → 输入 URL 或命令 → 可选 headers
- **编辑对话框**：修改已有配置 → 保存后热重载
- **删除确认**：二次确认删除

### 2.3 Hook

**新增文件**：`frontend/src/hooks/use-mcp-config.ts`

```typescript
export function useMcpConfig(): UseQueryResult<McpUserConfig>
export function useUpdateMcpConfig(): UseMutationResult
```

### 2.4 类型定义

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
  headers?: Record<string, string>;
}
```

---

## 三、后端 MCP 动态配置

### 3.1 配置持久化

**`backend/app/connector/registry.py`**：

用户配置持久化到 `.openyak/mcp-servers.json`：

```python
# 核心方法
async def load_user_mcps(self) -> dict
async def save_user_mcps(self, config: dict) -> None
async def register_user_mcps(self) -> None
async def apply_user_mcps(self, config: dict) -> None
```

### 3.2 热重载流程

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

### 3.3 API 端点

**`backend/app/api/mcp.py`**：

```
GET  /api/mcp/user-config    # 获取用户 MCP 配置
PUT  /api/mcp/user-config    # 保存用户 MCP 配置（触发热重载）
```

### 3.4 headers 字段支持

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

## 四、后端 MCP 连接异步化

### 4.1 问题

MCP 连接在 `main.py` lifespan 中执行，如果同步执行会阻塞 HTTP 服务就绪。

### 4.2 解决方案

**`backend/app/main.py`**：

```python
# MCP 连接移至后台任务
async def _startup_mcp():
    await connector_registry.startup()
    await connector_registry.sync_tools()

# HTTP 服务立即就绪，MCP 在后台连接
mcp_task = asyncio.create_task(_startup_mcp())
```

### 4.3 工具注册

后端启动后通过 `connector_registry.sync_tools()` 动态注册发现的 MCP tools，确保 MCP 连接完成后的工具也能被 AI 使用。

---

## 五、连接器标签页过滤

**`frontend/src/app/(main)/plugins/content.tsx`**：

过滤掉 `__builtin__` 和 `user-config` 来源的连接器，插件标签页只展示 OAuth 服务集成类连接器。

---

## 六、PATH 环境变量注入

**`backend/app/connector/registry.py`**：

`ConnectorRegistry.startup()` 对所有 local stdio 连接器注入 `_build_local_env()`：
- 保留完整 `os.environ`
- 前置 Homebrew/Volta/nvm 等常见 Node.js 路径
- 修复 Tauri 应用 PATH 剥离导致 npx 不可用问题

---

## 七、涉及文件清单

| 文件路径 | 变更类型 | 说明 |
|---------|---------|------|
| `backend/app/connector/registry.py` | 修改 | 用户配置、热重载、headers、PATH 注入 |
| `backend/app/api/mcp.py` | 修改 | user-config API 端点 |
| `backend/app/main.py` | 修改 | MCP 启动逻辑、后台任务 |
| `frontend/src/components/settings/mcp-tab.tsx` | 新增 | MCP 管理页面 |
| `frontend/src/hooks/use-mcp-config.ts` | 新增 | MCP 配置 Hook |
| `frontend/src/types/connectors.ts` | 修改 | McpServerConfig 类型 |
| `frontend/src/app/(main)/plugins/content.tsx` | 修改 | 过滤内置/用户配置连接器 |
| `frontend/src/i18n/locales/{en,zh}/settings.json` | 修改 | MCP 标签名 |
| `scripts/verify-bundle.mjs` | 修改 | smoke test 两阶段探测 |

---

## 八、重新实现检查清单

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
