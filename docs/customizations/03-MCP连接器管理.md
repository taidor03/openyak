# 03 - MCP 连接器管理

> **定制编号**: XFLOW-015
> **涉及范围**: MCP 管理页 + 动态配置热重载 + headers 支持 + 后台连接 + PATH 注入

---

## ⚠ 实现偏差记录（2025-05 修复）

### 偏差1: 自定义 MCP 的启用切换按钮冷启动不显示

**现象**: 新打开软件时，自定义 MCP 行的启用/禁用 Switch 按钮不显示，编辑保存任一个 MCP 后才出现。

**根因**: `CustomMcpRow` 组件中 Switch 依赖 `connector` 对象（来自 `/api/connectors`），但 connector 数据仅在 `ConnectorRegistry` 注册后才会返回。自定义 MCP 的配置数据来自 `useMcpConfig`（`/api/mcp/user-config`），而 connector 的 `enabled` 状态来自 `useConnectors`（`/api/connectors`）。当后端还没来得及将用户配置的 MCP 注册为 connector 时，`connectorsData?.[id]` 为 `undefined`，原代码用 `{connector && <Switch .../>}` 条件渲染，导致 Switch 不显示。

**修复**: 在 `CustomMcpRow` 中，当 `connector` 不存在时，从 MCP 配置数据推断默认的 enabled 状态（新添加的 MCP 默认启用），并始终显示 Switch：

```typescript
// 使用 connector 状态（可用时）；否则从配置推断
// （connector 可能在冷启动时 undefined，后端尚未注册）
const isEnabled = connector ? connector.enabled : true;
const status = connector
  ? connector.enabled ? connector.status : "disabled"
  : "disconnected";  // 非 "disabled"，避免显示灰色

// Switch 始终渲染，不依赖 connector 存在
<Switch
  checked={isEnabled}
  disabled={toggle.isPending}
  onCheckedChange={(checked) => toggle.mutate({ id, enable: checked })}
/>
```

**关键点**: 当 `connector` 不存在时，`status` 应为 `"disconnected"` 而非 `"disabled"`，否则 StatusDot 会显示灰色误导用户。

---

## 一、功能概述

1. **MCP 管理页**：设置页新增 MCP 标签页，对话框式 CRUD 管理
2. **动态配置热重载**：保存即生效，无需重启后端
3. **headers 字段支持**：remote 类型 MCP 支持自定义请求头
4. **后台连接**：MCP 连接移至后台任务，不阻塞 HTTP 服务就绪
5. **PATH 环境注入**：修复 Tauri 环境下 npx 不可用问题
6. **连接器标签页过滤**：插件页过滤内置/用户配置来源的连接器

---

## 二、MCP 管理页（XFLOW-015）

### 2.1 设置页集成

**`frontend/src/components/settings/settings-tabs.ts`**：新增 `mcp` 标签条目

**`frontend/src/components/settings/settings-layout.tsx`**：新增 MCP Tab 布局

### 2.2 MCP Tab 组件

**新增文件**：`frontend/src/components/settings/mcp-tab.tsx`

对话框式管理界面，组件拆分：

- **CustomMcpRow**：自定义 MCP 行（开关 + 状态 + 编辑 + 删除）
- **Add/Edit Dialog**：添加/编辑对话框（URL 或 stdio 命令 + headers）

### 2.3 Hook

**新增文件**：`frontend/src/hooks/use-mcp-config.ts`

```typescript
export function useMcpConfig(): UseQueryResult<McpUserConfig>  // meta: { persist: true }
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
async def load_user_mcps(self) -> dict:
    """Load user MCP config from .openyak/mcp-servers.json"""

async def save_user_mcps(self, config: dict) -> None:
    """Save user MCP config to .openyak/mcp-servers.json"""

async def register_user_mcps(self) -> None:
    """Register all user-configured MCP servers"""

async def apply_user_mcps(self, new_config: dict) -> None:
    """Hot-reload user MCPs: disconnect old ones, register new ones, reconnect enabled."""
```

### 3.2 热重载完整逻辑

**`apply_user_mcps` 实现**：

```python
async def apply_user_mcps(self, new_config: dict) -> None:
    # 1. Close and remove old user-config clients from MCP manager
    old_ids = [cid for cid, c in self._connectors.items() if c.source == "user-config"]
    if self._mcp_manager:
        for cid in old_ids:
            await self._mcp_manager.disconnect(cid)
            self._mcp_manager._config.pop(cid, None)
            del self._connectors[cid]

    # 2. Save new config
    await self.save_user_mcps(new_config)

    # 3. Register new user MCP servers from config
    new_ids = []
    for name, server_cfg in new_config.items():
        # Parse each server config and register
        connector = ConnectorInfo(
            id=name,
            name=server_cfg.get("name", name),
            url=url,
            type=server_type,
            source="user-config",
            no_auth_required=True,
            local_config=local_cfg,
        )
        self._connectors[name] = connector
        new_ids.append(name)

    # 4. Reconnect enabled items
    if self._mcp_manager:
        await self._mcp_manager.reconnect_enabled(self._connectors)

    # 5. Refresh tool registry
    await self.sync_tools()
```

### 3.3 API 端点

**`backend/app/api/mcp.py`**：

```
GET  /api/mcp/user-config    # 获取用户 MCP 配置
PUT  /api/mcp/user-config    # 保存用户 MCP 配置（触发热重载）
```

### 3.4 headers 字段支持

**后端**：`ConnectorRegistry` 解析与持久化 remote 类型 MCP 的 `headers` 配置

**前端**：`mcp-tab.tsx` 对话框中新增 headers 编辑区域，保存后立即生效。

---

## 四、后端 MCP 连接异步化

### 4.1 问题

MCP 连接在 `main.py` lifespan 中同步执行，阻塞 HTTP 服务就绪。

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

后端启动后通过 `connector_registry.sync_tools()` 动态注册发现的 MCP tools。

---

## 五、PATH 环境变量注入

### 5.1 问题

Tauri 应用启动时 PATH 环境变量被剥离，导致 local stdio MCP 的 `npx` 命令不可用。原实现直接传递 `environment={MODE: stdio}`，覆盖了整个子进程环境。

### 5.2 解决方案

**`backend/app/connector/registry.py`**：

```python
_NODE_EXTRA_PATHS = [
    "/opt/homebrew/bin",                             # Homebrew on Apple Silicon
    "/usr/local/bin",                                # Homebrew on Intel / system node
    os.path.expanduser("~/.volta/bin"),              # Volta
    os.path.expanduser("~/.nvm/current/bin"),        # nvm (via default-packages symlink)
    os.path.expanduser("~/.fnm/default/bin"),        # fnm
]

def _build_local_env(extra: dict[str, str] | None = None) -> dict[str, str]:
    """Build a subprocess env for local MCP servers (stdio/npx/uvx).

    Starts from the current process env so nothing is lost, then prepends any
    known Node.js binary directories not already in PATH, and finally applies
    connector-specific overrides.
    """
    env = dict(os.environ)
    current_path = env.get("PATH", "")
    extra_dirs = [d for d in _NODE_EXTRA_PATHS if os.path.isdir(d) and d not in current_path]
    if extra_dirs:
        env["PATH"] = os.pathsep.join(extra_dirs) + os.pathsep + current_path
    if extra:
        env.update(extra)
    return env
```

在 `register_user_mcps` 中对 local stdio 连接器使用：

```python
built_env = _build_local_env(local_cfg.get("environment"))
self._mcp_manager._config[name] = {
    "type": "local",
    "enabled": connector.enabled,
    "no_auth_required": True,
    "command": local_cfg["command"],
    "environment": built_env,
}
```

---

## 六、连接器模型扩展

**`backend/app/connector/model.py`**：

```python
class ConnectorInfo:
    # ... 原有字段
    no_auth_required: bool = False  # 零认证标识
    source: str = "builtin"         # "builtin" | "user-config"
```

`McpManager` 对 `no_auth_required=True` 的连接器跳过 `needs_auth` 状态提升。

---

## 七、连接器标签页过滤

**`frontend/src/app/(main)/plugins/content.tsx`**：

过滤掉 `__builtin__` 和 `user-config` 来源的连接器，插件标签页只展示 OAuth 服务集成类连接器。

---

## 八、配置常量表

| 常量 | 值 | 文件 |
|------|-----|------|
| 用户配置文件路径 | `.openyak/mcp-servers.json` | `backend/app/connector/registry.py` |
| `_NODE_EXTRA_PATHS` | 5 个 Node.js 路径 | `backend/app/connector/registry.py` |

---

## 九、涉及文件清单

| 文件路径 | 变更类型 | 说明 |
|---------|---------|------|
| `backend/app/connector/registry.py` | 修改 | 用户配置、热重载、headers、PATH 注入、_NODE_EXTRA_PATHS |
| `backend/app/connector/model.py` | 修改 | no_auth_required + source 字段 |
| `backend/app/api/mcp.py` | 修改 | user-config API 端点 |
| `backend/app/main.py` | 修改 | MCP 启动逻辑、后台任务 |
| `frontend/src/components/settings/mcp-tab.tsx` | 新增 | MCP 管理页面 |
| `frontend/src/hooks/use-mcp-config.ts` | 新增 | MCP 配置 Hook |
| `frontend/src/types/connectors.ts` | 修改 | McpServerConfig 类型 |
| `frontend/src/app/(main)/plugins/content.tsx` | 修改 | 过滤内置/用户配置连接器 |
| `frontend/src/i18n/locales/{en,zh}/settings.json` | 修改 | MCP 标签名 |

---

## 十、重新实现检查清单

- [ ] MCP 管理页 Tab（对话框式 CRUD + 启用/禁用开关 + 状态显示）
- [ ] `McpServerConfig` 类型含 `headers` 字段
- [ ] 后端 `load/save/register/apply_user_mcps` 方法
- [ ] 配置持久化到 `.openyak/mcp-servers.json`
- [ ] 热重载流程：断旧→注册新→重连→sync_tools
- [ ] `GET/PUT /api/mcp/user-config` API 端点
- [ ] MCP 连接异步化（`asyncio.create_task`，不阻塞 HTTP 就绪）
- [ ] `sync_tools()` 动态工具注册
- [ ] 插件标签页过滤 `__builtin__` 和 `user-config` 来源
- [ ] `_build_local_env()` PATH 注入（5 个 Node.js 目录 + os.environ 基底）
- [ ] `ConnectorInfo.no_auth_required` 字段
- [ ] `ConnectorInfo.source` 字段（"builtin" | "user-config"）
- [ ] **[偏差修复]** `CustomMcpRow` Switch 不依赖 connector 存在，冷启动时从配置推断 enabled 状态
- [ ] **[偏差修复]** connector undefined 时 status 为 "disconnected" 非 "disabled"
