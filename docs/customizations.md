# xflow-desktop 定制迁移手册

> 本文档记录 xflow-desktop 相对 OpenYak v1.1.10 的目标差异，用于未来基于 OpenYak 新版本重新实现或迁移这些定制。
>
> 重要：本文档是“定制差异与迁移清单”，不是当前工作树源码现状报告。迁移到新上游版本时，应逐项核对目标版本的实际文件结构、脚本名称和 API 约定。

## 1. 基准信息


| 项    | 内容                                                              |
| ---- | --------------------------------------------------------------- |
| 上游基准 | OpenYak v1.1.10                                                 |
| 定制项目 | `~/gitdata/xflow-desktop`                                       |
| 主要目标 | 增加 xflow 内容工作台、xflow API 配置、xflow 工具集，并按业务需要调整默认端口、设置页、侧边栏和构建流程 |
| 迁移原则 | 先恢复业务能力，再处理视觉细节；优先复用目标 OpenYak 版本已有模式，避免机械套用旧文件                 |


### 状态约定


| 状态         | 含义                        |
| ---------- | ------------------------- |
| `target`   | 需要在目标版本中恢复的定制能力           |
| `optional` | 视目标版本现状决定是否保留             |
| `verify`   | 旧定制可能已被上游吸收或实现方式变化，迁移前需核对 |
| `obsolete` | 已确认不再需要时才标记               |


## 2. 定制能力索引


| ID        | 能力                      | 状态         | 涉及层   | 高冲突文件                                                                                                                                     | 验收方式                                                   |
| --------- | ----------------------- | ---------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| XFLOW-001 | 内容工作台                   | `target`   | 前端    | `frontend/src/app/(main)`、`frontend/src/components/layout/sidebar-nav.tsx`                                                                | `/content-workbench` 可访问，商品/博客/分类/穿搭/视频页面可用            |
| XFLOW-002 | xflow API 配置            | `target`   | 前端    | `frontend/src/components/settings/*`、`frontend/src/hooks/*`                                                                               | Settings 中可配置 URL/token，并可测试连接                         |
| XFLOW-003 | xflow API 客户端与类型        | `target`   | 前端    | `frontend/src/types/index.ts`、`frontend/src/lib/*`                                                                                        | 页面通过统一 client 调用 xflow API                             |
| XFLOW-004 | xflow 后端工具集             | `target`   | 后端    | `backend/app/tool/builtin/*`、`backend/app/main.py`                                                                                        | `/api/tools` 可见 xflow tools，Agent 可调用                  |
| XFLOW-005 | 端口改为 8090               | `optional` | 全栈/桌面 | `package.json`、`backend/app/config.py`、`backend/run.py`、`frontend/src/lib/constants.ts`、Tauri 启动代码                                        | `npm run dev:all` 和桌面启动均指向同一端口                         |
| XFLOW-006 | 中文优先与 i18n 补充           | `target`   | 前端    | `frontend/src/i18n/config.ts`、`frontend/src/i18n/locales/*`                                                                               | 默认中文文案正常，英文 fallback 不缺 key                            |
| XFLOW-007 | 设置页与 Provider / 自定义端点增强 | `optional` | 前端/后端 | `frontend/src/components/settings/providers-tab.tsx`、`backend/app/api/config.py`、`backend/app/schemas/provider.py`                        | 自定义端点卡片展示已发现模型；指定 model_ids 时仅显示并使用指定模型              |
| XFLOW-008 | 归档会话视图增强                | `done`     | 前端/后端 | `frontend/src/stores/sidebar-store.ts`、`window-top-icons.tsx`、`session-list.tsx`、`session-item.tsx`                                       | 左上角 Archive 按钮切换归档视图，归档会话悬停显示恢复按钮                       |
| XFLOW-009 | 项目行快速新建对话               | `target`   | 前端    | `frontend/src/components/layout/session-list.tsx`（`ProjectRow`）、`frontend/src/app/(main)/c/new/new-chat-page-client.tsx`                 | 项目行悬停显示 `+` 按钮，点击后直接以该项目目录创建新对话；不影响折叠/展开交互            |
| XFLOW-010 | 项目级技能发现与使用              | `target`   | 后端/会话 | `backend/app/skill/registry.py`、`backend/app/session/*`、`backend/app/tool/builtin/skill.py`                                               | 项目对话可发现并使用项目下 `.cursor/skills` 和 `.openyak/skills` 的技能 |
| XFLOW-011 | 内置 superpowers 插件       | `target`   | 后端/插件 | `backend/app/data/plugins/*`、`backend/app/plugin/*`、`backend/app/data/skills_catalog.json`                                                | 插件列表可见 superpowers，启用后相关 skills/agents 可用              |
| XFLOW-012 | Provider 与模型本地缓存         | `done`     | 前端      | `frontend/src/lib/provider-cache.ts`、`frontend/src/hooks/use-providers.ts`、`frontend/src/hooks/use-models.ts`                               | 重启后 Settings / 模型选择器立即显示已缓存数据，无加载闪烁                    |
| XFLOW-013 | 会话列表本地缓存                | `done`     | 前端      | `frontend/src/lib/session-cache.ts`、`frontend/src/hooks/use-sessions.ts`、`frontend/src/components/layout/session-list.tsx`                  | 重启后侧边栏立即显示上次会话列表，后台静默刷新，无加载闪烁                         |


## 3. XFLOW-001 内容工作台

### 目标

新增面向 xflow 业务的内容运营工作台，用于管理商品、博客、分类、穿搭和视频，并提供统计看板。

### 预期新增文件


| 文件                                                                                   | 说明                             |
| ------------------------------------------------------------------------------------ | ------------------------------ |
| `frontend/src/app/(main)/content-workbench/layout.tsx`                               | 内容工作台页面布局，包含 6 个子导航 tab        |
| `frontend/src/app/(main)/content-workbench/page.tsx`                                 | 看板首页，展示商品/博客/分类/穿搭/视频数量统计和发布状态 |
| `frontend/src/app/(main)/content-workbench/products/page.tsx`                        | 商品列表页，支持搜索、分页、删除               |
| `frontend/src/app/(main)/content-workbench/products/new/page.tsx`                    | 新建商品表单页                        |
| `frontend/src/app/(main)/content-workbench/products/[id]/page.tsx`                   | 编辑商品服务端页面；静态导出时注意动态路由处理        |
| `frontend/src/app/(main)/content-workbench/products/[id]/edit-product-client.tsx`    | 编辑商品客户端组件                      |
| `frontend/src/app/(main)/content-workbench/blog/page.tsx`                            | 博客列表                           |
| `frontend/src/app/(main)/content-workbench/blog/new/page.tsx`                        | 新建博客                           |
| `frontend/src/app/(main)/content-workbench/blog/[id]/page.tsx`                       | 编辑博客服务端页面                      |
| `frontend/src/app/(main)/content-workbench/blog/[id]/edit-blog-client.tsx`           | 编辑博客客户端组件                      |
| `frontend/src/app/(main)/content-workbench/categories/page.tsx`                      | 分类列表                           |
| `frontend/src/app/(main)/content-workbench/categories/[id]/page.tsx`                 | 编辑分类服务端页面                      |
| `frontend/src/app/(main)/content-workbench/categories/[id]/edit-category-client.tsx` | 编辑分类客户端组件                      |
| `frontend/src/app/(main)/content-workbench/outfits/page.tsx`                         | 穿搭列表                           |
| `frontend/src/app/(main)/content-workbench/videos/page.tsx`                          | 视频列表                           |


### 预期修改文件


| 文件                                               | 目标改动                     | 迁移注意                           |
| ------------------------------------------------ | ------------------------ | ------------------------------ |
| `frontend/src/components/layout/sidebar-nav.tsx` | 增加“新对话”和“内容工作台”入口        | 目标 OpenYak 版本可能已经重构侧边栏，应按新结构接入 |
| `frontend/src/i18n/locales/zh/common.json`       | 新增 `contentWorkbench` 文案 | 与 XFLOW-006 一起处理               |
| `frontend/src/i18n/locales/en/common.json`       | 新增 `contentWorkbench` 文案 | 保持英文 fallback 完整               |


### 迁移步骤

1. 先确认目标版本的 App Router 路由组仍使用 `frontend/src/app/(main)`。
2. 新增 `content-workbench` 路由树。
3. 接入 xflow API client 和 TanStack Query hooks。
4. 在侧边栏或目标版本等价导航组件中加入入口。
5. 处理静态导出下的动态编辑页；如果目标版本改了导出策略，以目标版本为准。

### 验收

- 访问 `/content-workbench` 可进入看板。
- 商品、博客、分类、穿搭、视频列表页都能正常渲染。
- 新建和编辑入口不触发 hydration 错误。
- `npm run preflight:ui` 或目标版本等价前端检查通过。

## 4. XFLOW-002 xflow API 配置

### 目标

在 Settings 中新增 xflow 配置页，允许用户配置 xflow API 地址和 Bearer token，并提供连接测试。

### 预期新增文件


| 文件                                               | 说明                               |
| ------------------------------------------------ | -------------------------------- |
| `frontend/src/hooks/use-xflow-config.ts`         | 读写本地 xflow 配置，提供测试连接方法           |
| `frontend/src/components/settings/xflow-tab.tsx` | Settings 中的 xflow API 配置页        |
| `frontend/src/components/ui/client-only.tsx`     | 通用客户端渲染隔离组件，用于避免 SSR/CSR 本地状态不一致 |


### 预期修改文件


| 文件                                                      | 目标改动                                                              | 迁移注意                         |
| ------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------- |
| `frontend/src/components/settings/settings-tabs.ts`     | 增加 `{ id: "xflow", icon: LayoutDashboard, labelKey: "tabXflow" }` | 目标版本可能已调整 Settings tab 数据结构  |
| `frontend/src/components/settings/settings-layout.tsx`  | 导入并渲染 `XflowTab`                                                  | 避免在服务端读取 `localStorage`      |
| `frontend/src/components/settings/settings-sidebar.tsx` | 必要时包裹 `ClientOnly`                                                | 若目标版本已解决 hydration 问题，可不重复包裹 |
| `frontend/src/i18n/locales/zh/settings.json`            | 新增 `tabXflow`                                                     | 与 XFLOW-006 一起处理             |
| `frontend/src/i18n/locales/en/settings.json`            | 新增 `tabXflow`                                                     | 与 XFLOW-006 一起处理             |


### 验收

- Settings 中出现 xflow tab。
- API URL/token 可保存并在刷新后保留。
- 测试连接成功/失败都有明确反馈。
- 未配置时内容工作台显示可理解的引导或错误状态。

## 5. XFLOW-003 xflow API 客户端与类型

### 目标

为前端提供稳定的 xflow API 类型和调用层，避免页面组件直接拼接请求。

### 预期新增文件


| 文件                                          | 说明                                                                                             |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `frontend/src/types/xflow.ts`               | xflow API 的 TypeScript 类型定义，包括 `Product`、`Blog`、`Category`、`Outfit`、`Video`、`DashboardStats` 等 |
| `frontend/src/lib/xflow-api.ts`             | xflow API 客户端，包含列表、新建、更新、删除和统计等 CRUD/analytics 函数                                              |
| `frontend/src/hooks/use-xflow-dashboard.ts` | 看板数据 TanStack Query hook                                                                       |


### 预期修改文件


| 文件                            | 目标改动                              | 迁移注意                           |
| ----------------------------- | --------------------------------- | ------------------------------ |
| `frontend/src/types/index.ts` | 新增 `export type * from "./xflow"` | 若目标版本不使用 barrel export，可按新约定导出 |


### 验收

- 页面不直接读取 token 或手写重复 fetch 逻辑。
- token 统一通过配置 hook 或 client 读取。
- 常见接口错误能转成用户可读提示。

## 6. XFLOW-004 xflow 后端工具集

### 目标

注册一组 xflow API 集成工具，让 Agent 能查询和操作 xflow 内容。

### 预期新增文件


| 文件                                        | 说明                                                             |
| ----------------------------------------- | -------------------------------------------------------------- |
| `backend/app/tool/builtin/xflow_tools.py` | 约 11 个 xflow API 集成工具，包括 list/create/update/delete 和 analytics |


### 预期修改文件


| 文件                      | 目标改动                                      | 迁移注意                                                        |
| ----------------------- | ----------------------------------------- | ----------------------------------------------------------- |
| `backend/app/config.py` | 新增 `xflow_api_url`、`xflow_api_token` 配置字段 | 字段应使用 `OPENYAK_` 前缀环境变量；若仅前端本地配置可用，则后端工具仍需单独配置来源            |
| `backend/app/main.py`   | 在内置工具注册流程中注册 `ALL_XFLOW_TOOLS`            | 目标版本可能已迁移到其他注册入口，优先找 `_register_builtin_tools` 或工具 registry |


### 迁移步骤

1. 阅读目标版本 `docs/development/07-工具系统开发.md` 和工具注册入口。
2. 新增 xflow tools，保持工具 schema 清晰、参数少而明确。
3. 将 API URL/token 接入 `Settings`。
4. 在工具注册入口注册全部 xflow tools。
5. 为失败场景提供明确错误，例如未配置 token、接口 401、接口不可达。

### 验收

- `/api/tools` 能看到 xflow 工具。
- Agent 能调用至少一个只读工具完成查询。
- 未配置 xflow 凭据时工具返回明确错误，而不是 traceback。

## 7. XFLOW-005 默认端口 8090

### 目标

将本地后端默认端口从 OpenYak 默认 `8000` 调整为 `8090`，避免与其他本地服务冲突。

### 预期修改文件


| 文件                                   | 目标改动                                        | 迁移注意                           |
| ------------------------------------ | ------------------------------------------- | ------------------------------ |
| `package.json`                       | `dev:backend` 端口改为 `8090`                   | 根脚本是事实来源，需与 dev launcher 一致    |
| `scripts/dev-all.mjs`                | `NEXT_PUBLIC_API_URL` 默认端口改为 `8090`         | 同步前端代理配置                       |
| `frontend/src/lib/constants.ts`      | fallback API URL 改为 `http://localhost:8090` | 若目标版本已改为动态端口，避免硬改              |
| `frontend/next.config.ts`            | 默认代理地址改为 `http://localhost:8090`            | 只在目标版本仍使用该 fallback 时修改        |
| `backend/app/config.py`              | `port: int = 8090`                          | 与 `OPENYAK_PORT` 文档保持一致        |
| `backend/run.py`                     | CLI 默认端口改为 `8090`                           | 桌面打包入口必须同步                     |
| `backend/app/auth/tunnel.py`         | 默认 `backend_port` 改为 `8090`                 | 若调用方传入 `settings.port`，默认值影响较小 |
| `desktop-tauri/src-tauri/src/lib.rs` | Rust 侧默认端口或探测起点改为 `8090`                    | 目标版本可能已使用动态端口，优先保留动态策略         |


### 迁移注意

这是全局行为改动，最容易漏文件。若目标 OpenYak 新版本已经改成“启动时寻找空闲端口 + 前端 IPC 获取后端 URL”，则不应强行全量改成 `8090`，只需确认非桌面开发模式和文档默认值是否仍需要固定端口。

### 验收

- `npm run dev:backend` 在 `8090` 启动。
- `npm run dev:all` 前端能访问后端。
- 桌面模式能正确获得后端 URL。
- README 和 `docs/development/09-配置和环境.md` 中默认端口同步更新。

## 8. XFLOW-006 中文优先与 i18n 补充

### 目标

让 xflow 业务界面具备完整中英文文案，并将默认 fallback 调整为中文优先。

### 预期新增文件


| 文件                                                   | 说明         |
| ---------------------------------------------------- | ---------- |
| `frontend/src/i18n/locales/zh/contentWorkbench.json` | 内容工作台中文本地化 |
| `frontend/src/i18n/locales/en/contentWorkbench.json` | 内容工作台英文本地化 |


### 预期修改文件


| 文件                                           | 目标改动                                                               |
| -------------------------------------------- | ------------------------------------------------------------------ |
| `frontend/src/i18n/config.ts`                | 注册 `contentWorkbench` namespace；将 `fallbackLng` 从 `"en"` 改为 `"zh"` |
| `frontend/src/i18n/locales/zh/common.json`   | 新增侧边栏 `contentWorkbench` 文案                                        |
| `frontend/src/i18n/locales/en/common.json`   | 新增侧边栏 `contentWorkbench` 文案                                        |
| `frontend/src/i18n/locales/zh/settings.json` | 新增 `tabXflow`                                                      |
| `frontend/src/i18n/locales/en/settings.json` | 新增 `tabXflow`                                                      |


### 验收

- 默认语言为中文或符合目标业务预期。
- 切换英文时没有裸 key。
- SSR/CSR 首屏不出现因语言偏好导致的 hydration warning。

## 9. XFLOW-007 设置页与 Provider / 自定义端点增强

### 目标

精简 Settings 中与目标业务无关的 Provider 选项，降低配置复杂度。同时增强自定义端点配置：添加新端点时，支持填写可选的模型 ID 列表，多个模型用英文逗号分隔。

该能力用于兼容无法正确返回 `/models` 列表、或只希望暴露指定模型的 OpenAI-compatible 服务。

### 预期修改文件


| 文件                                                   | 目标改动                                                                                                     | 迁移注意                      |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------- |
| `frontend/src/components/settings/providers-tab.tsx` | 移除或隐藏非目标业务所需 Provider；自定义端点新增 `model_ids` 输入框                                                            | 输入提示应说明“可选，多个模型用逗号分隔”     |
| `frontend/src/i18n/locales/zh/settings.json`         | 新增模型 ID 输入框 placeholder/help 文案                                                                          | 与英文 key 对齐                |
| `frontend/src/i18n/locales/en/settings.json`         | 新增模型 ID 输入框 placeholder/help 文案                                                                          | 与中文 key 对齐                |
| `backend/app/schemas/provider.py`                    | `CustomEndpointCreate` / `CustomEndpointUpdate` / `CustomEndpointConfig` 增加 `model_ids: list[str]` 或等价字段 | 建议后端接收数组；前端负责把逗号字符串清洗为数组  |
| `backend/app/api/config.py`                          | 创建/更新自定义端点时持久化 `model_ids`，并用于模型注册/返回                                                                    | 未填写时继续走原 `/models` 自动发现流程 |
| `backend/app/main.py`                                | 启动时自动注册自定义端点时读取 `model_ids`                                                                              | 避免重启后手动模型列表丢失             |
| `backend/app/provider/*`                             | 必要时让 custom endpoint provider 使用手动模型列表覆盖或补充远端 `/models`                                                  | 优先做通用能力，不要写死 xflow 端点     |


### 模型 ID 规则

- 输入为空：保持上游行为，通过端点 `/models` 自动发现。
- 输入非空：按英文逗号分隔，去掉首尾空白，过滤空项并去重。
- 示例：`gpt-4o-mini,qwen2.5-72b-instruct,deepseek-chat`。
- 保存到 `OPENYAK_CUSTOM_ENDPOINTS` 时建议使用结构化数组，例如 `"model_ids": ["gpt-4o-mini", "deepseek-chat"]`。
- 如果目标版本已有模型别名、价格或能力 metadata，应只覆盖模型 ID 列表，不要伪造未知能力。
- **已保存端点的模型展示**：自定义端点卡片底部展示模型 tag 列表。
  - 若 `model_ids` 非空：仅展示指定模型，并附"已指定"蓝色标签；其余自动发现的模型不展示，也不注入模型下拉。
  - 若 `model_ids` 为空：展示从 `GET /api/models` 按 `provider_id` 过滤所得的已发现模型列表。
  - 实现要点：`ProviderInfo` 后端响应增加 `model_ids: list[str]`；前端 `providers-tab.tsx` 从 `useModels()` 取数据，按指定/自动逻辑渲染 tag。

### 迁移步骤

1. 在自定义端点表单中新增“模型 ID”可选输入。
2. 提交前把逗号分隔字符串转换为去重后的数组。
3. 后端 schema 增加 `model_ids` 字段，并对空数组/缺省保持兼容。
4. 创建和更新端点时把 `model_ids` 写入 `OPENYAK_CUSTOM_ENDPOINTS`。
5. Provider 注册或模型刷新时，如果 `model_ids` 非空，直接注册这些模型；否则继续调用远端 `/models`。
6. 编辑已有端点时回填 `model_ids`，避免保存其它字段时丢失。

### 验收

- Settings 中只展示目标业务需要的 Provider 配置。
- 聊天、模型选择和已有 Provider API 不因 UI 精简而崩溃。
- 添加自定义端点时，可填写 `model-a, model-b` 并保存。
- 端点保存后，模型下拉中能看到手动填写的模型 ID。
- 未填写模型 ID 时，自定义端点仍按原逻辑自动发现模型。
- 重启后手动模型 ID 仍保留并可用。
- 已保存端点卡片底部显示模型 tag；有指定模型时只显示指定模型并带"已指定"标签。

## 10. XFLOW-008 归档会话视图增强

### 目标

增强会话列表：普通列表过滤已归档会话，并提供归档视图切换；已归档会话显示恢复归档按钮；错误时显示"连接失败"等更清晰反馈。

### 实现方式

1. **归档切换按钮移至左上角工具栏**：`window-top-icons.tsx` 在搜索与新建对话按钮右侧增加 Archive 图标按钮，激活时高亮显示；状态托管至 `useSidebarStore`（`showArchived` + `setShowArchived`）。
2. **归档视图标签**：切换为归档视图时，`session-list.tsx` 顶部显示"已归档对话"标签。
3. **归档列表项恢复按钮**：`session-item.tsx` 根据 `session.time_archived` 判断：已归档会话悬停时显示 `ArchiveRestore` 按钮（取消归档），普通会话仍显示 `Archive` 按钮。
4. **状态共享**：`showArchived` 从 `SessionList` 局部 state 提升到 `useSidebarStore`，`window-top-icons` 和 `session-list` 均读取同一状态。

### 预期修改文件

| 文件                                                              | 目标改动                                      |
| --------------------------------------------------------------- | ----------------------------------------- |
| `frontend/src/stores/sidebar-store.ts`                          | 新增 `showArchived` / `setShowArchived`     |
| `frontend/src/components/layout/window-top-icons.tsx`           | 新增 Archive 切换按钮，激活态高亮                     |
| `frontend/src/components/layout/session-list.tsx`               | 读 store `showArchived`，移除内嵌切换按钮；归档视图顶部标签  |
| `frontend/src/components/layout/session-item.tsx`               | 新增 `onUnarchive` prop；按 `time_archived` 切换按钮图标 |
| `frontend/src/hooks/use-sessions.ts`                            | 如目标版本缺失归档 mutation，则补齐                    |
| `frontend/src/types/session.ts`                                 | 如缺失 `time_archived`，补齐类型                  |

### 验收

- 左上角工具栏（搜索/新建对话按钮右边）出现 Archive 图标，点击切换归档视图，激活态高亮。
- 默认列表不显示已归档会话。
- 归档视图顶部显示"已归档对话"标签。
- 已归档会话悬停时显示 ArchiveRestore 按钮，点击即取消归档（toast 提示"对话已恢复"）。
- 普通会话悬停仍显示 Archive 按钮（归档）。
- 后端不可达时显示明确错误态。

## 12. XFLOW-009 项目行快速新建对话

### 目标

在左侧"项目与对话列表"中，每个项目行的折叠箭头 + 对话数右侧增加一个悬停显示的 `+`（新建对话）按钮。用户无需先切换到全局新对话或重新选择目录，直接点击即可创建归属于该项目目录的新对话。项目工具栏（右侧）已有创建项目入口，该按钮补齐项目粒度的新建对话能力。

### 实现方式

- `ProjectRow` 内部将原先的绝对定位 count badge 替换为包含 `[SquarePen 按钮] + [count]` 的 flex 容器。
- 新建按钮默认 `opacity-0`，悬停（`group-hover/project:opacity-100`）时渐显；count 始终可见。
- 按钮点击调用已有的 `startNewChat()`（`router.push('/c/new?directory=...')`），同时 `e.stopPropagation()` 防止触发折叠切换。
- 右键菜单中已有"在此项目中新建对话"选项保持不变，两者互为补充。

### 预期修改文件


| 文件                                                       | 目标改动                                            | 迁移注意                                               |
| -------------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------- |
| `frontend/src/components/layout/session-list.tsx`        | `ProjectRow` 右侧区域：原 count span → flex 容器含新建按钮 + count | 按钮需 `stopPropagation`，避免触发折叠；使用 i18n key 作为 tooltip |
| `frontend/src/app/(main)/c/new/new-chat-page-client.tsx` | 读取 `directory` query param 并在创建 session 时传入     | 目标版本可能已把创建逻辑放入 hook/store；确认 search params 处理方式   |


### 迁移步骤

1. 确认目标版本的 `ProjectRow` 渲染逻辑与会话分组字段（`session.directory` 或等价）。
2. 将 count badge 区域改为包含新建按钮的 flex 容器，`pr-16` 留白无需变更。
3. 新建按钮使用 `SquarePen`（或 `Plus`）图标，`opacity-0 group-hover:opacity-100` 过渡，`title={t("startNewChatInProject")}`。
4. 点击调用 `router.push('/c/new?directory=<encoded-dir>')`，并阻止事件冒泡。
5. 确认 `/c/new` 页面正确读取并传入 `directory`；新会话归属该项目分组后验收。

### 验收

- 每个项目行悬停后在 count 左侧出现 `+` 按钮，鼠标移开后隐藏。
- 点击 `+` 后跳转到新建对话页，创建成功后新会话出现在对应项目分组下。
- 点击 `+` 不触发项目折叠/展开。
- 项目折叠/展开、排序、搜索、右键菜单功能不受影响。

## 13. XFLOW-010 项目级技能发现与使用

### 目标

当用户处在某个项目对话中时，OpenYak 能发现并使用该项目目录下的技能：

- `{project}/.cursor/skills/**/SKILL.md`
- `{project}/.openyak/skills/**/SKILL.md`

这项能力用于让不同项目拥有自己的工作流、约束和领域知识，而不是只依赖全局或内置技能。

### 预期修改文件


| 文件                                                      | 目标改动                                                       | 迁移注意                                                            |
| ------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------------------- |
| `backend/app/skill/registry.py`                         | 将 `.cursor/skills` 纳入项目级技能发现路径；保留 `.openyak/skills` 的最高优先级 | 当前上游可能只扫描 `.claude/skills`、`.agents/skills` 和 `.openyak/skills` |
| `backend/app/session/manager.py`                        | 创建/更新 session 时确保项目目录可靠保存                                  | 需要保证对话能知道自己属于哪个项目                                               |
| `backend/app/session/system_prompt.py`                  | 组装系统提示时加入当前项目可用技能摘要或使用提示                                   | 避免把大量 SKILL.md 全量塞进上下文                                          |
| `backend/app/session/prompt.py` 或 prompt assembler 相关文件 | 让单次对话使用当前 session directory 对应的项目技能集合                      | 目标版本若已有 prompt assembler，以新架构为准                                 |
| `backend/app/tool/builtin/skill.py`                     | Skill 工具读取当前项目技能，而不是只读启动时全局 registry                       | 注意同名技能优先级和禁用状态                                                  |
| `backend/app/api/skills.py`                             | 必要时支持按 `project_dir` 或 `session_id` 查询技能                   | 前端若需要展示项目技能列表才改 API                                             |
| `frontend/src/components/layout/session-list.tsx`       | 确保项目对话入口创建的 session 带目录                                    | 与 XFLOW-010 联动                                                  |


### 优先级建议

项目技能发现顺序建议为低到高：

1. 内置 skills
2. 全局 `~/.openyak/skills`
3. 项目 `.cursor/skills`
4. 项目 `.openyak/skills`

同名技能以后发现的覆盖先发现的；禁用状态仍应持久化在项目 `.openyak/skills.disabled.json` 或目标版本等价位置。

### 迁移步骤

1. 先确认目标版本 `SkillRegistry` 的发现顺序和禁用状态存储位置。
2. 增加 `.cursor/skills` 项目扫描路径。
3. 确认 session 创建时目录字段完整传递到后端。
4. 在会话执行时按 session directory 获取项目技能，避免只在应用启动时扫描单一 `settings.project_dir`。
5. 调整 Skill 工具或 prompt assembler，使 Agent 能看到当前项目技能并按需调用。
6. 为缺失目录、无效 `SKILL.md`、同名覆盖写清日志或 API 错误。

### 验收

- 在项目 A 的 `.cursor/skills/foo/SKILL.md` 中新增技能后，项目 A 对话可发现该技能。
- 项目 B 对话不会误用项目 A 的私有技能。
- `.openyak/skills` 中同名技能能覆盖 `.cursor/skills`。
- 禁用某个项目技能后，该项目后续对话不再使用它。

## 14. XFLOW-011 内置 superpowers 插件

### 目标

将 superpowers 作为内置插件随 OpenYak 打包，让用户无需手动安装即可启用其工作流技能，例如 brainstorming、writing-plans、systematic-debugging、test-driven-development、verification-before-completion 等。

### 预期新增文件


| 文件                                                                | 说明                |
| ----------------------------------------------------------------- | ----------------- |
| `backend/app/data/plugins/superpowers/.claude-plugin/plugin.json` | superpowers 插件元数据 |
| `backend/app/data/plugins/superpowers/skills/*/SKILL.md`          | superpowers 技能文件  |
| `backend/app/data/plugins/superpowers/skills/*/references/*`      | 技能引用文档，按原插件需要保留   |


### 预期修改文件


| 文件                                            | 目标改动                                       | 迁移注意                                                     |
| --------------------------------------------- | ------------------------------------------ | -------------------------------------------------------- |
| `backend/app/plugin/loader.py`                | 确认内置插件目录可加载 superpowers 的 plugin/skills 结构 | 如果 superpowers 来源格式不同，需要转换为 OpenYak 支持的 Claude plugin 格式 |
| `backend/app/plugin/converter.py`             | 必要时兼容 superpowers metadata 字段              | 优先保持转换器通用，不要写死插件名                                        |
| `backend/app/plugin/manager.py`               | 确认内置插件默认状态符合产品预期                           | 若插件默认禁用，前端需要清楚展示启用入口                                     |
| `backend/app/data/skills_catalog.json`        | 如技能商店/目录依赖静态 catalog，需要更新 superpowers 条目   | 若目标版本运行时扫描即可展示，可不改 catalog                               |
| `frontend/src/app/(main)/plugins/content.tsx` | 确保插件列表能展示 superpowers 的名称、描述、启用状态          | 目标版本若插件 UI 已完善，可只验收                                      |


### 迁移步骤

1. 获取 superpowers 插件源文件，确认许可和可再分发范围。
2. 转换为 `backend/app/data/plugins/superpowers` 下的内置插件结构。
3. 保留技能之间的 references 目录和相对路径，避免 SKILL.md 引用失效。
4. 启动后确认 plugin loader 能解析 plugin metadata、skills 和可选 agents/MCP。
5. 在插件 UI 中确认 superpowers 可见并可启用。
6. 选择一个技能执行端到端验证，例如 triggering `verification-before-completion` 后能读取技能内容。

### 验收

- 插件列表中可见 superpowers。
- 启用后 `/api/skills` 或等价接口能看到 superpowers skills。
- 技能引用的 references 文件可读取，不出现路径丢失。
- 打包产物中包含 superpowers 插件目录。

## 15. 原始差异清单

这一节保留旧清单的文件级信息，迁移时作为查漏用；实际落地时以第 2-14 节的能力目标和目标 OpenYak 版本源码为准。

### 15.1 预期新增前端文件


| 文件                                                   | 说明             |
| ---------------------------------------------------- | -------------- |
| `frontend/src/types/xflow.ts`                        | xflow API 类型定义 |
| `frontend/src/lib/xflow-api.ts`                      | xflow API 客户端  |
| `frontend/src/hooks/use-xflow-config.ts`             | xflow 配置 hook  |
| `frontend/src/hooks/use-xflow-dashboard.ts`          | 看板数据 hook      |
| `frontend/src/components/ui/client-only.tsx`         | 客户端渲染隔离组件      |
| `frontend/src/components/settings/xflow-tab.tsx`     | xflow 配置页      |
| `frontend/src/app/(main)/content-workbench/**`       | 内容工作台路由与页面     |
| `frontend/src/i18n/locales/zh/contentWorkbench.json` | 内容工作台中文文案      |
| `frontend/src/i18n/locales/en/contentWorkbench.json` | 内容工作台英文文案      |


### 15.2 预期新增后端文件


| 文件                                                                | 说明                   |
| ----------------------------------------------------------------- | -------------------- |
| `backend/app/tool/builtin/xflow_tools.py`                         | xflow API 集成工具       |
| `backend/app/data/plugins/superpowers/.claude-plugin/plugin.json` | 内置 superpowers 插件元数据 |
| `backend/app/data/plugins/superpowers/skills/**/SKILL.md`         | 内置 superpowers 技能    |


### 15.3 预期修改文件


| 文件                                                            | 目标改动                                      |
| ------------------------------------------------------------- | ----------------------------------------- |
| `frontend/src/types/index.ts`                                 | 导出 xflow 类型                               |
| `frontend/src/lib/constants.ts`                               | 同步默认 API URL 或端口策略                        |
| `frontend/src/components/settings/settings-tabs.ts`           | 添加 xflow 设置 tab                           |
| `frontend/src/components/settings/settings-layout.tsx`        | 渲染 xflow 设置页                              |
| `frontend/src/components/layout/sidebar-nav.tsx`              | 添加内容工作台入口                                 |
| `frontend/src/components/layout/projects-toolbar.tsx`         | 保留全局项目操作，并与项目级新建对话入口协调                    |
| `frontend/src/components/layout/sidebar-footer.tsx`           | 必要时处理 hydration 问题                        |
| `frontend/src/components/settings/settings-sidebar.tsx`       | 必要时处理 hydration 问题                        |
| `frontend/src/components/settings/providers-tab.tsx`          | 精简 Provider UI；自定义端点新增可选模型 ID 输入          |
| `frontend/src/components/selectors/header-model-dropdown.tsx` | 必要时处理 hydration/no-models 渲染路径            |
| `frontend/src/components/chat/landing.tsx`                    | 必要时处理 hydration 问题                        |
| `frontend/src/components/layout/session-list.tsx`             | 归档会话增强；项目行增加快速新建对话入口                      |
| `frontend/src/app/(main)/c/new/page.tsx`                      | 支持项目目录参数                                  |
| `frontend/src/app/(main)/c/new/new-chat-page-client.tsx`      | 根据项目目录创建新对话                               |
| `frontend/src/hooks/use-chat.ts`                              | 确认创建对话时传递项目目录                             |
| `frontend/src/hooks/use-sessions.ts`                          | 确认 session 创建/更新保留项目目录                    |
| `frontend/src/i18n/config.ts`                                 | 中文优先和 namespace 注册                        |
| `frontend/src/i18n/locales/zh/common.json`                    | 新增内容工作台文案                                 |
| `frontend/src/i18n/locales/en/common.json`                    | 新增内容工作台文案                                 |
| `frontend/src/i18n/locales/zh/settings.json`                  | 新增 xflow tab 文案                           |
| `frontend/src/i18n/locales/en/settings.json`                  | 新增 xflow tab 文案                           |
| `backend/app/config.py`                                       | 新增 xflow 配置；可选端口调整                        |
| `backend/app/main.py`                                         | 注册 xflow tools                            |
| `backend/app/schemas/provider.py`                             | 自定义端点 schema 增加手动模型 ID 字段                 |
| `backend/app/api/config.py`                                   | 创建/更新/持久化自定义端点时处理手动模型 ID                  |
| `backend/app/provider/*`                                      | 必要时让 custom endpoint provider 支持手动模型列表    |
| `backend/app/skill/registry.py`                               | 扫描项目 `.cursor/skills` 与 `.openyak/skills` |
| `backend/app/tool/builtin/skill.py`                           | 按当前项目解析可用技能                               |
| `backend/app/api/skills.py`                                   | 必要时支持按项目或会话查询技能                           |
| `backend/app/session/manager.py`                              | 确保 session 目录字段完整保存                       |
| `backend/app/session/system_prompt.py`                        | 将项目技能使用提示接入会话上下文                          |
| `backend/app/session/prompt.py`                               | 必要时让 prompt assembler 使用项目级技能集合           |
| `backend/app/plugin/loader.py`                                | 确认内置 superpowers 插件可加载                    |
| `backend/app/plugin/converter.py`                             | 必要时兼容 superpowers 插件 metadata             |
| `backend/app/plugin/manager.py`                               | 确认 superpowers 插件启用/禁用状态                  |
| `backend/app/data/skills_catalog.json`                        | 如静态目录需要，补充 superpowers 技能条目               |
| `backend/app/auth/middleware.py`                              | 如目标版本仍需 OAuth 回调公开访问，更新 allowlist         |
| `backend/app/auth/tunnel.py`                                  | 可选端口调整                                    |
| `package.json`                                                | 可选端口调整；确认脚本名称                             |
| `scripts/dev-all.mjs`                                         | 可选端口调整                                    |
| `backend/run.py`                                              | 可选端口调整                                    |
| `scripts/*.sh`                                                | 构建脚本适配目标环境；确保 superpowers 插件进入打包产物        |


## 15. XFLOW-012 Provider 与模型本地缓存

### 目标

将已获取的 Provider 列表和模型列表持久化到浏览器 `localStorage`，作为 TanStack Query 的 `initialData` 使用。应用启动时立即从缓存渲染，无需等待后端响应，避免设置页 / 模型选择器的加载闪烁。后端有新数据返回时自动刷新缓存，保持同步。

### 设计原则

- **Stale-while-revalidate**：缓存数据作为 `initialData`（不是 `placeholderData`），TanStack Query 将其视为真实数据并根据 `staleTime` 判断是否需要重新请求。
- **版本化 key**：localStorage key 包含版本后缀（`xflow:providers_v1`、`xflow:models_v1`），迁移时只需改后缀即可平滑清理旧缓存。
- **写入时机**：仅在 API 响应成功时写入，避免缓存损坏数据。
- **同步策略**：Provider 相关变更（增删端点、设置 API key）触发 `invalidateQueries`，使 TanStack Query 立即发起后台刷新并在完成后更新缓存。

### 预期新增文件


| 文件                                                    | 说明                                      |
| ----------------------------------------------------- | --------------------------------------- |
| `frontend/src/lib/provider-cache.ts`                  | 读写 Provider / 模型缓存的工具函数，封装 localStorage |
| `frontend/src/hooks/use-providers.ts`                 | 带缓存的 Providers hook，供多个组件共享             |


### 预期修改文件


| 文件                                                         | 目标改动                                                       | 迁移注意                                          |
| ---------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------- |
| `frontend/src/hooks/use-models.ts`                         | 添加 `initialData` / `initialDataUpdatedAt` 读取缓存，成功后写缓存      | 目标版本若已有 SWR / Jotai 等等价机制，以目标机制为准             |
| `frontend/src/components/settings/providers-tab.tsx`       | 将内联 providers query 替换为 `useProviders()` hook             | 确保所有 invalidate 调用保留，避免缓存失效逻辑缺失               |
| `frontend/src/hooks/use-auto-detect-provider.ts`           | 同上，替换内联 providers query                                    | 相同 queryKey 共享同一 TanStack Query 缓存条目          |


### 迁移步骤

1. 创建 `provider-cache.ts`，实现 `readProvidersCache` / `writeProvidersCache` / `readModelsCache` / `writeModelsCache`。
2. 创建 `use-providers.ts`，在 `queryFn` 成功后调用 `writeProvidersCache`，并传入 `initialData` / `initialDataUpdatedAt`。
3. 更新 `use-models.ts`，同样集成读写缓存。
4. 将使用到 `queryKeys.providers` + `API.CONFIG.PROVIDERS` 的内联 query 替换为 `useProviders()`。
5. 确认所有 `invalidateQueries({ queryKey: queryKeys.providers })` 调用保留，以保证变更后缓存即时刷新。

### 验收

- 初次打开 Settings，页面在 200 ms 内渲染出上次的 Provider 列表和模型 tag，无白屏。
- 添加/删除自定义端点后，页面刷新后仍然立即显示正确的端点列表。
- 删除 `localStorage` 中相关 key 后刷新页面，页面正常降级为加载状态，并在后端响应后写入新缓存。
- 模型选择器在 Provider 列表缓存命中时，无需等待 API 即可渲染上次的模型列表。

## 16. 升级执行建议

1. 先拉取目标 OpenYak 版本，阅读 `package.json`、`scripts/*.sh`、`backend/app/main.py`、`backend/app/config.py`、`frontend/src/app` 和 Settings/Sidebar 相关组件。
2. 按第 2 节能力索引逐项迁移，不要按旧文件路径机械覆盖。
3. 每完成一个能力，就运行对应验收；优先让一个能力闭环，再迁移下一个。
4. 对高冲突文件只做最小必要改动，避免把旧版本结构强行带入新版本。
5. 若目标版本已经提供等价能力，标记为 `obsolete` 或改为轻量适配，不再重复实现。
6. 迁移完成后更新本文件状态和验收结果。

---

## 17. XFLOW-013 会话列表本地缓存

### 目标

在软件本地（`localStorage`）缓存完整的会话列表，重启后侧边栏立即呈现上次加载的会话，后台静默与后端同步，用户无感知加载等待。

### 设计原则

| 原则 | 说明 |
| ---- | ---- |
| 即时渲染 | 缓存数据作为 TanStack Query `initialData` 注入，首屏无骨架屏闪烁 |
| 立即同步 | `staleTime = 0`：缓存数据被视为立即过期，挂载后马上触发后台 refetch |
| 完整快照 | 所有分页全部加载完毕后，将扁平化完整列表写入缓存（非仅首页） |
| 首页兜底 | `queryFn` 每次获取第 0 页时同步写一次缓存，保证即使分页未完全加载也能更新 |
| 变更联动 | 所有 mutation（新建 / 重命名 / 置顶 / 归档 / 删除）已通过 `invalidateQueries` 触发 refetch，缓存随之更新 |
| 仅缓存普通列表 | 归档视图（`showArchived = true`）不写入缓存，避免污染主列表快照 |

### 同步时序

```
软件启动
  └─ readSessionsCache() → initialData → 侧边栏立即渲染
  └─ staleTime=0 → 后台 refetch 立即开始
        ├─ page 0 到达 → writeSessionsCache(page0) + 渲染更新
        ├─ page 1..N 到达（若有） → 渲染更新
        └─ 全部页完成（hasNextPage=false）→ writeSessionsCache(全量)

用户操作（增删改归档）
  └─ mutation.onSettled → invalidateQueries
        └─ refetch page 0 → writeSessionsCache(page0) → 渲染更新
```

### 预期新增 / 修改文件

| 文件 | 改动 |
| ---- | ---- |
| `frontend/src/lib/session-cache.ts`（新增） | `readSessionsCache` / `writeSessionsCache`，localStorage 版本化存储 |
| `frontend/src/hooks/use-sessions.ts` | `useSessions` 注入 `initialData`、`initialDataUpdatedAt`、`staleTime = 0`；`queryFn` page 0 写缓存 |
| `frontend/src/components/layout/session-list.tsx` | `useEffect` 监听 `hasNextPage` + `isFetchingNextPage`，全量加载完成后写完整快照 |

### 验收

- 冷启动（后端尚未就绪）：侧边栏立即显示上次缓存的会话列表，无骨架屏。
- 后端就绪后：列表静默更新为最新数据（若有变化）。
- 新建 / 重命名 / 置顶 / 归档 / 删除任一会话后：缓存在下次 refetch 完成后自动更新。
- 归档视图切换：不影响普通列表缓存内容。
- `localStorage` 中可见键 `xflow:sessions_v1`，内含 `data`（数组）和 `updatedAt`（时间戳）。

---

## XFLOW-014 后端启动状态指示器

### 背景与目标

桌面端前端 UI 从本地缓存即时加载，而 PyInstaller 后端进程尚在启动（加载模型、插件、MCP 等需约 5–30 s）。用户无从感知后端是否就绪，可能误以为软件已完全可用。

目标：在聊天头部最右侧显示后端各启动阶段的实时状态，完全就绪后自动消失。

### 实现方案

**生命周期**

```
frontend 加载（即时，来自本地静态缓存）
  └─ BackendReadyIndicator 挂载
        ├─ phase="connecting"：每 1.5s 轮询 /startup-status
        │     └─ 同时按耗时显示时间桶阶段标签（正在启动 / 加载模型 / 加载插件 / 连接 MCP / 即将就绪）
        └─ 首次响应成功 → phase="ready"：展示 3.5s（绿色 ✓ + 提供商/插件/工具计数）
              └─ 3.5s 后 → phase="done"：组件返回 null，从 DOM 中消失
```

**视觉状态**

| 阶段 | 样式 | 文本示例 |
|------|------|----------|
| `connecting` | 橙色脉冲双环 + animate-pulse 文字 | `正在启动…` / `加载插件…` |
| `ready` | 绿色 CheckCircle2 + fade-in | `✓ 就绪 · 3 个提供商 · 16 个插件 · 35 个工具` |
| `done` | 不渲染（null） | — |

**阶段时间桶（近似，仅视觉反馈）**

| 耗时 | 阶段标签 |
|------|---------|
| 0–5 s | 正在启动 |
| 5–12 s | 加载模型 |
| 12–22 s | 加载插件 |
| 22–38 s | 连接 MCP |
| 38 s+ | 即将就绪 |

### 新增 / 修改文件

| 文件 | 改动 |
| ---- | ---- |
| `backend/app/api/health.py` | 新增 `GET /startup-status` 端点，返回 `{ ready, providers, plugins, mcp_connected, tools }` |
| `frontend/src/lib/constants.ts` | 在 `API` 对象中加 `STARTUP_STATUS: "/startup-status"` |
| `frontend/src/hooks/use-backend-ready.ts`（新增） | `useBackendReady()` hook：轮询、阶段状态机、auto-done 定时器 |
| `frontend/src/components/chat/backend-ready-indicator.tsx`（新增） | `BackendReadyIndicator` 组件，三阶段渲染 |
| `frontend/src/components/chat/chat-header.tsx` | 在 header 最右侧引入 `<BackendReadyIndicator />` |

### 验收

- 冷启动时，聊天头部最右侧出现橙色脉冲 + 阶段文字。
- 后端就绪后转绿色 ✓ + 提供商/插件/工具数量，持续约 3.5 s 后自动消失。
- 若后端已在运行时重新打开软件：`/startup-status` 立即返回，`connecting` 阶段几乎不可见，直接显示 `就绪` 后消失。
- Web / Remote 模式下组件不渲染（`IS_DESKTOP` 为 false 时 hook 直接返回 `done`）。

