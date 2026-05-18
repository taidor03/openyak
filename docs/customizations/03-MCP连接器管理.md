# 03 - MCP 连接器管理

> **定制编号**: XFLOW-015
> **涉及范围**: MCP 管理页 + 动态配置热重载 + headers 支持 + 后台连接 + PATH 注入
git 历史`7ac0fab` `4ac128b`就是之前实施 03 定制的提交， 可参考提取。
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

### 偏差3: mcp-servers.json 格式不兼容导致自定义 MCP 不显示

**现象**: MCP 设置页面的自定义 MCP 列表为空，`mcp-servers.json` 中配置的服务器全部不显示。

**根因**: `mcp-servers.json` 文件使用 Claude Desktop / Cursor 兼容的包裹格式 `{"mcpServers": {...}}`，但后端 `load_user_mcps` 直接返回了整个 JSON dict。`_register_user_mcps` 遍历 items 时，第一个 key 是 `"mcpServers"`，其值是嵌套的服务器集合而非单个配置，解析失败。

此外还有两个子问题：
- `mcp-servers.json` 使用 `env` 字段名（Claude Desktop 格式），后端代码处理的是 `environment`
- `command` 字段为 `string[]` 数组格式（`["npx", "-y", "mcp-name"]`），前端类型定义为 `string`

**修复**: 后端 `load_user_mcps` 自动解包 `mcpServers` 包裹层，`save_user_mcps` 保存时始终使用包裹格式；`_register_user_mcps` 和 `apply_user_mcps` 中将 `env` 转换为 `environment`；前端类型定义 `command` 改为 `string | string[]`。

```python
# backend/app/connector/registry.py

async def load_user_mcps(self) -> dict[str, Any]:
    """Supports two formats:
      - Flat:      {"server-id": {...}, ...}
      - Wrapped:   {"mcpServers": {"server-id": {...}, ...}}
    """
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        return {}
    # Claude Desktop / Cursor format: {"mcpServers": {...}}
    if "mcpServers" in data and isinstance(data["mcpServers"], dict):
        return data["mcpServers"]
    return data

async def save_user_mcps(self, config: dict[str, Any]) -> None:
    """Always writes in the {"mcpServers": {...}} wrapped format."""
    wrapped = {"mcpServers": config}
    path.write_text(json.dumps(wrapped, indent=2, ensure_ascii=False), encoding="utf-8")

# In _register_user_mcps and apply_user_mcps:
if "env" in local_cfg and "environment" not in local_cfg:
    local_cfg["environment"] = local_cfg.pop("env")
local_cfg["environment"] = _build_local_env(local_cfg.get("environment"))
```

```typescript
// frontend/src/types/connectors.ts
export interface McpServerConfig {
  id?: string;
  name?: string;
  type: "remote" | "local";
  url?: string;
  command?: string | string[];  // string[] for Claude Desktop compat
  args?: string[];             // when command is a string
  enabled?: boolean;
  headers?: Record<string, string>;
  description?: string;
  category?: string;
  env?: Record<string, string>;        // Claude Desktop format
  environment?: Record<string, string>; // OpenYak internal format
}
```

```tsx
// frontend/src/components/settings/mcp-tab.tsx — command display
{isLocal && config.command && (
  <p className="text-xs text-[var(--text-tertiary)] mt-0.5 font-mono truncate">
    {Array.isArray(config.command)
      ? config.command.join(" ")
      : [config.command, ...(config.args || [])].join(" ")}
  </p>
)}
```

### 偏差2: MCP 管理页交互方式丢失

**现象**: 03 定制实施后 MCP 标签页被简化，丢失了 git `7ac0fab`/`4ac128b` 原有的交互方式：内置 MCP 区域消失、Dialog 弹窗编辑变为内联表单、Badge 视觉元素缺失。

**根因**: 后续定制迭代重写了 `mcp-tab.tsx`，未保留原 `4ac128b` 版本的完整 UI 结构。

**修复**: 按 `7ac0fab`/`4ac128b` 的交互方式完整还原，适配当前 API 格式（`{ config: ... }` 而非原 `{ mcpServers: ... }`）：

#### 2a. 内置 MCP 区域还原

`McpTab` 组件从 `useConnectors` 数据中筛选 `referenced_by.includes("__builtin__")` 的连接器，单独展示在「内置搜索 MCP」区域：

```tsx
export function McpTab() {
  const { data } = useConnectors();

  const builtinMcps = Object.entries(data?.connectors ?? {}).filter(
    ([, c]) => c.referenced_by?.includes("__builtin__"),
  );

  return (
    <div className="space-y-8">
      {/* 内置 MCPs */}
      <section>
        <h2>内置MCP</h2>
        {builtinMcps.length === 0 ? (
          <div><WifiOff /> 暂无内置 MCP</div>
        ) : (
          <div className="rounded-lg border divide-y">
            {builtinMcps.map(([id, connector]) => (
              <BuiltinMcpRow key={id} id={id} connector={connector} />
            ))}
          </div>
        )}
      </section>

      {/* 自定义 MCPs */}
      <CustomMcpSection connectorsData={data?.connectors} />
    </div>
  );
}
```

#### 2b. BuiltinMcpRow 组件

每行展示：StatusDot + 名称 + 类型 Badge（本地/远程）+ 状态 Badge（已连接/连接失败）+ 启用开关：

```tsx
function BuiltinMcpRow({ id, connector }: { id: string; connector: ConnectorInfo }) {
  const toggle = useConnectorToggle();
  return (
    <div className="flex items-start gap-3 py-3 border-b last:border-0">
      <StatusDot status={connector.enabled ? connector.status : "disabled"} />
      <div className="flex-1">
        {/* 名称 + Badge（Terminal/Globe + 本地/远程） */}
        {/* 已连接: CheckCircle2 + tools_count */}
        {/* 连接失败: XCircle + 红色 Badge */}
        {/* 描述 + 本地工具提示 */}
      </div>
      <Switch checked={connector.enabled} onCheckedChange={...} />
    </div>
  );
}
```

#### 2c. Dialog 弹窗编辑还原

用 `Dialog` 组件替代内联表单，支持 JSON 格式编辑：

```tsx
function McpEntryDialog({ open, onClose, initial, allServers, onSave, isSaving }) {
  // draft: JSON 文本编辑
  // parseError: 实时 JSON 校验
  // 验证规则：local 必须有 command, remote 必须有 url
  // 保存逻辑：合并到 allServers（编辑时先删除旧 key）
  return (
    <Dialog open={open} onOpenChange={...}>
      <DialogContent className="max-w-lg">
        <DialogTitle>添加/编辑 MCP 服务器</DialogTitle>
        <textarea rows={14} font-mono placeholder={ENTRY_PLACEHOLDER} />
        {parseError && <XCircle /> parseError}
        {/* 配置提示区域 */}
        <Button onClick={handleSave}>保存</Button>
      </DialogContent>
    </Dialog>
  );
}
```

#### 2d. CustomMcpRow 增强

每行展示：StatusDot + 名称(ID) + 类型 Badge + 状态 Badge + URL/command + headers + Switch + 编辑/删除按钮：

```tsx
function CustomMcpRow({ id, config, connector, onEdit, onDelete }) {
  const status = connector
    ? connector.enabled ? connector.status : "disabled"
    : "disconnected";  // 冷启动偏差修复
  return (
    <div className="flex items-start gap-3 py-3 border-b last:border-0">
      <StatusDot status={status} />
      <div className="flex-1">
        {/* 名称 + ID + Badge（本地/远程 + 已连接/连接失败）*/}
        {/* description / url / command / headers */}
      </div>
      <div className="flex items-center gap-1.5">
        {connector && <Switch .../>}
        <Button onClick={onEdit}><Pencil /></Button>
        <Button onClick={onDelete}><Trash2 /></Button>
      </div>
    </div>
  );
}
```

#### 2e. CustomMcpSection 管理区域

- 空状态展示虚线边框 + 点击添加
- 列表使用 `rounded-lg border divide-y` 布局
- 通过 `McpEntryDialog` 弹窗完成添加/编辑
- 删除直接从 servers 对象移除后保存
- API 适配：`useMcpConfig` 返回 `{ config: ... }` 格式，`useUpdateMcpConfig` 发送 `{ config: ... }` 格式

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
  id?: string;
  name?: string;
  type: "remote" | "local";
  url?: string;           // remote 类型
  command?: string | string[];  // local stdio 类型（string[] 为 Claude Desktop 兼容格式）
  args?: string[];        // local stdio 参数（当 command 为 string 时）
  enabled?: boolean;
  headers?: Record<string, string>;
  description?: string;
  category?: string;
  env?: Record<string, string>;        // Claude Desktop 格式
  environment?: Record<string, string>; // OpenYak 内部格式
}
```

---

## 三、后端 MCP 动态配置

### 3.1 配置持久化

**`backend/app/connector/registry.py`**：

用户配置持久化到 `.openyak/mcp-servers.json`：

```python
async def load_user_mcps(self) -> dict:
    """Load user MCP config from .openyak/mcp-servers.json

    Supports two formats:
      - Flat:      {"server-id": {...}, ...}
      - Wrapped:   {"mcpServers": {"server-id": {...}, ...}}
        (Claude Desktop / Cursor compatible)
    """

async def save_user_mcps(self, config: dict) -> None:
    """Save to .openyak/mcp-servers.json

    Always writes in the {"mcpServers": {...}} wrapped format
    so the file is compatible with Claude Desktop / Cursor.
    """

async def _register_user_mcps(self) -> None:
    """Register user-config MCPs on cold start.
    Normalises "env" (Claude Desktop) → "environment" (OpenYak internal).
    """

async def apply_user_mcps(self, new_config: dict) -> None:
    """Hot-reload user MCPs: disconnect old ones, register new ones, reconnect enabled.
    Normalises "env" → "environment" for local stdio servers.
    """
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

> **偏差修正**：初版实施时虽然在 `ConnectorInfo` 模型和 `McpManager._config` 中写入了 `no_auth_required` 标志，但遗漏了修改 `McpManager.startup()` 和 `reconnect()` 方法来读取此标志。当远程 MCP 服务器（如使用 headers 传递 API key 的 `web-search`）连接失败时，`McpManager` 无条件标记为 `needs_auth`（黄点），即使该服务器不需要 OAuth 认证。
>
> 修正代码（`backend/app/mcp/manager.py`）：
> ```python
> # startup() 和 reconnect() 中的 needs_auth 判断增加 no_auth_required 检查
> if (
>     client.status == "failed"
>     and client.server_type != "local"
>     and not client._oauth_token
>     and not config.get("no_auth_required", False)  # ← 新增条件
> ):
>     client.status = "needs_auth"
>     client.error = None
> ```

> **偏差修正2**：初版实施时在 `main.py` 中为了实现 MCP 后台连接（不阻塞 HTTP 就绪），错误地重新创建了 `ConnectorRegistry` 实例，导致之前通过 `register_from_plugin()` 从插件 `.mcp.json` 注册的所有 `source=builtin` 连接器（Slack/Notion/GitHub/Datadog/Figma/Canva/BigQuery/Google Workspace）全部丢失。只有 `source=user-config` 的连接器（来自 `mcp-servers.json`）在 `startup()` 中被恢复。插件页面链接器 Tab 过滤掉 `user-config` 后，一个链接器都不显示。

> **偏差修正3**：初版实施时 `ConnectorInfo` 模型没有 `headers` 字段，且 `startup()` 构建 `mcp_config` 时对 remote 类型只传 `type/url/enabled`，丢失了 `headers` 和 `no_auth_required`。导致远程 MCP 服务器（如 `web-search`，使用 `headers.Authorization` 传递 Bearer API key）在冷启动时无法认证，连接失败。
>
> 修正内容：
> - `ConnectorInfo` 新增 `headers: dict[str, str]` 字段
> - `_register_user_mcps` 和 `apply_user_mcps` 中创建 `ConnectorInfo` 时传入 `headers`
> - `startup()` 构建 `mcp_config` 时传递 `headers` 和 `no_auth_required`
> - 前端 `ConnectorInfo` 类型新增 `headers?: Record<string, string>`
>
> 修正代码（`backend/app/main.py`）：
> ```python
> # 错误：重新创建空的 ConnectorRegistry，丢失插件注册的连接器
> # connector_registry = ConnectorRegistry(project_dir=settings.project_dir)
>
> # 正确：使用已有的 registry 实例（已包含 register_from_plugin 注册的连接器）
> app.state.connector_registry = connector_registry
> set_connector_registry(connector_registry)
> ```

---

## 七、连接器标签页过滤

**`frontend/src/app/(main)/plugins/content.tsx`**：

过滤掉 `__builtin__` 和 `user-config` 来源的连接器，插件标签页只展示 OAuth 服务集成类连接器。

---

## 八、配置常量表

| 常量 | 值 | 文件 |
|------|-----|------|
| 用户配置文件路径 | `.openyak/mcp-servers.json` | `backend/app/connector/registry.py` |
| 配置文件格式 | `{"mcpServers": {...}}` (Claude Desktop 兼容) | `backend/app/connector/registry.py` |
| `_NODE_EXTRA_PATHS` | 5 个 Node.js 路径 | `backend/app/connector/registry.py` |

---

## 九、涉及文件清单

| 文件路径 | 变更类型 | 说明 |
|---------|---------|------|
| `backend/app/connector/registry.py` | 修改 | 用户配置、热重载、headers、PATH 注入、_NODE_EXTRA_PATHS、mcpServers 解包、env→environment 转换 |
| `backend/app/connector/model.py` | 修改 | no_auth_required + headers + source 字段 |
| `backend/app/mcp/manager.py` | 修改 | startup/reconnect 中 needs_auth 判断增加 no_auth_required 检查 |
| `backend/app/api/mcp.py` | 修改 | user-config API 端点 |
| `backend/app/main.py` | 修改 | MCP 启动逻辑、后台任务、**[偏差修复]** 不重新创建 ConnectorRegistry |
| `frontend/src/components/settings/mcp-tab.tsx` | 新增 | MCP 管理页面（内置 MCP 区域 + Dialog 弹窗 + Badge 视觉 + CustomMcpSection） |
| `frontend/src/hooks/use-mcp-config.ts` | 新增 | MCP 配置 Hook |
| `frontend/src/types/connectors.ts` | 修改 | McpServerConfig 类型 |
| `frontend/src/app/(main)/plugins/content.tsx` | 修改 | 过滤内置/用户配置连接器 |
| `frontend/src/i18n/locales/{en,zh}/settings.json` | 修改 | MCP 标签名 |

---

## 十、重新实现检查清单

- [ ] MCP 管理页 Tab（对话框式 CRUD + 启用/禁用开关 + 状态显示）
- [ ] **内置 MCP 区域**：筛选 `referenced_by.includes("__builtin__")` 的连接器，独立展示（BuiltinMcpRow + Badge + StatusDot + Switch）
- [ ] **Dialog 弹窗编辑**：使用 `Dialog` 组件，JSON 格式 textarea 编辑，实时校验 + 验证规则
- [ ] **Badge 视觉元素**：本地/远程标签（Terminal/Globe + Badge）、已连接/连接失败状态徽章（CheckCircle2/XCircle + 彩色 Badge）
- [ ] **CustomMcpRow 增强**：StatusDot + 名称(ID) + 类型 Badge + 状态 Badge + URL/command + headers + Switch + 编辑/删除
- [ ] **CustomMcpSection**：空状态虚线边框 + 点击添加、列表 divide-y 布局、通过 McpEntryDialog 弹窗完成添加/编辑
- [ ] **API 适配**：`useMcpConfig` 返回 `{ config: ... }` 格式，`useUpdateMcpConfig` 发送 `{ config: ... }` 格式
- [ ] `McpServerConfig` 类型含 `headers` 字段
- [ ] **[偏差修复]** `McpServerConfig.command` 类型为 `string | string[]`（兼容 Claude Desktop 数组格式）
- [ ] **[偏差修复]** `McpServerConfig` 新增 `env` 字段（Claude Desktop 格式），`id`/`name`/`enabled` 改为可选
- [ ] 后端 `load/save/register/apply_user_mcps` 方法
- [ ] **[偏差修复]** `load_user_mcps` 自动解包 `mcpServers` 包裹格式（兼容 Claude Desktop / Cursor）
- [ ] **[偏差修复]** `save_user_mcps` 保存时始终使用 `{"mcpServers": {...}}` 包裹格式
- [ ] **[偏差修复]** `_register_user_mcps` 和 `apply_user_mcps` 中 `env` → `environment` 字段名转换
- [ ] **[偏差修复]** `CustomMcpRow` command 显示兼容数组格式（`Array.isArray(command) ? command.join(" ") : ...`）
- [ ] 配置持久化到 `.openyak/mcp-servers.json`
- [ ] 热重载流程：断旧→注册新→重连→sync_tools
- [ ] `GET/PUT /api/mcp/user-config` API 端点
- [ ] MCP 连接异步化（`asyncio.create_task`，不阻塞 HTTP 就绪）
- [ ] **[偏差修复]** `main.py` 中不要重新创建 `ConnectorRegistry`，否则丢失插件注册的连接器
- [ ] `sync_tools()` 动态工具注册
- [ ] 插件标签页过滤 `user-config` 来源（不过滤 `builtin`，保留 OAuth 服务集成连接器）
- [ ] **[偏差修复]** 插件页 ConnectorsTab 仅过滤 `user-config` 来源，保留 `builtin`（Slack/Notion/GitHub 等）
- [ ] `_build_local_env()` PATH 注入（5 个 Node.js 目录 + os.environ 基底）
- [ ] `ConnectorInfo.no_auth_required` 字段
- [ ] `ConnectorInfo.headers` 字段（remote 类型 MCP 的 HTTP headers，如 Bearer Token）
- [ ] **[偏差修复]** `McpManager.startup()` 和 `reconnect()` 中 `needs_auth` 判断增加 `no_auth_required` 检查
- [ ] `ConnectorInfo.source` 字段（"builtin" | "user-config"）
- [ ] **[偏差修复]** `CustomMcpRow` Switch 不依赖 connector 存在，冷启动时从配置推断 enabled 状态
- [ ] **[偏差修复]** connector undefined 时 status 为 "disconnected" 非 "disabled"
