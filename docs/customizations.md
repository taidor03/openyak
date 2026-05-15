# xflow-desktop 定制开发文档

> 基于 OpenYak v1.1.9 的二次开发完整清单。
> 原始项目：~/gitdata/openyak
> 定制项目：~/gitdata/xflow-desktop

---

## 一、新增文件

### 1.1 前端新增（12 文件）

| 文件 | 说明 |
|------|------|
| `frontend/src/types/xflow.ts` | xflow API 的 TypeScript 类型定义（Product, Blog, Category, Outfit, Video, DashboardStats 等） |
| `frontend/src/lib/xflow-api.ts` | xflow API 客户端（17 个 CRUD 函数，通过 localStorage 读取配置，Bearer token 认证） |
| `frontend/src/hooks/use-xflow-config.ts` | xflow 配置 hook（读写 localStorage，测试连接） |
| `frontend/src/hooks/use-xflow-dashboard.ts` | 看板数据 TanStack Query hook |
| `frontend/src/components/ui/client-only.tsx` | 通用客户端渲染隔离组件（解决 SSR 水合问题） |
| `frontend/src/components/settings/xflow-tab.tsx` | Settings 中新增的 xflow API 配置页面 |
| `frontend/src/app/(main)/content-workbench/layout.tsx` | 内容工作台页面布局（6 个子导航 tab） |
| `frontend/src/app/(main)/content-workbench/page.tsx` | 看板首页（商品/博客/分类/穿搭/视频数量统计 + 发布状态） |
| `frontend/src/app/(main)/content-workbench/products/page.tsx` | 商品列表页（搜索/分页/删除） |
| `frontend/src/app/(main)/content-workbench/products/new/page.tsx` | 新建商品表单页 |
| `frontend/src/app/(main)/content-workbench/products/[id]/page.tsx` | 编辑商品页（服务端组件 + generateStaticParams） |
| `frontend/src/app/(main)/content-workbench/products/[id]/edit-product-client.tsx` | 编辑商品客户端组件 |

### 1.2 内容工作台 — 博客/分类/穿搭/视频

| 文件 | 说明 |
|------|------|
| `frontend/src/app/(main)/content-workbench/blog/page.tsx` | 博客列表 |
| `frontend/src/app/(main)/content-workbench/blog/new/page.tsx` | 新建博客 |
| `frontend/src/app/(main)/content-workbench/blog/[id]/page.tsx` | 编辑博客服务端组件 |
| `frontend/src/app/(main)/content-workbench/blog/[id]/edit-blog-client.tsx` | 编辑博客客户端组件 |
| `frontend/src/app/(main)/content-workbench/categories/page.tsx` | 分类列表 |
| `frontend/src/app/(main)/content-workbench/categories/[id]/page.tsx` | 编辑分类服务端组件 |
| `frontend/src/app/(main)/content-workbench/categories/[id]/edit-category-client.tsx` | 编辑分类客户端组件 |
| `frontend/src/app/(main)/content-workbench/outfits/page.tsx` | 穿搭列表 |
| `frontend/src/app/(main)/content-workbench/videos/page.tsx` | 视频列表 |

### 1.3 国际化

| 文件 | 说明 |
|------|------|
| `frontend/src/i18n/locales/zh/contentWorkbench.json` | 内容工作台中文本地化 |
| `frontend/src/i18n/locales/en/contentWorkbench.json` | 内容工作台英文本地化 |

### 1.4 后端新增

| 文件 | 说明 |
|------|------|
| `backend/app/tool/builtin/xflow_tools.py` | 11 个 xflow API 集成工具（list/create/update/delete + analytics） |

### 1.5 文档

| 文件 | 说明 |
|------|------|
| `docs/superpowers/specs/2025-05-13-xflow-content-workbench-design.md` | 设计文档 |
| `docs/superpowers/plans/2025-05-13-xflow-content-workbench.md` | 实施计划 |

---

## 二、修改的文件

### 2.1 前端修改（9 文件）

| 文件 | 修改内容 | 原因 |
|------|----------|------|
| `frontend/src/types/index.ts` | 新增 `export type * from "./xflow"` | 将 xflow 类型加入 barrel export |
| `frontend/src/lib/constants.ts` | `localhost:8000` → `localhost:8090` | 统一后端端口为 8090 |
| `frontend/src/components/settings/settings-tabs.ts` | 新增 `{id: "xflow", icon: LayoutDashboard, labelKey: "tabXflow"}` | 添加 xflow 配置 tab |
| `frontend/src/components/settings/settings-layout.tsx` | 导入 XflowTab，添加渲染条件；添加 suppressHydrationWarning | 渲染 xflow 配置页 |
| `frontend/src/components/layout/sidebar-nav.tsx` | 从 `return null` 改为完整导航（新对话 + 内容工作台入口） | 提供内容工作台入口 |
| `frontend/src/components/layout/sidebar-footer.tsx` | 包裹 ClientOnly 解决水合问题 | SSR/CSR 语言不一致 |
| `frontend/src/components/settings/settings-sidebar.tsx` | 包裹 ClientOnly | SSR/CSR 语言不一致 |
| `frontend/src/components/settings/providers-tab.tsx` | 移除 OpenYak/ChatGPT/Ollama 服务商卡片及详细配置 | 精简服务商选项 |
| `frontend/src/components/selectors/header-model-dropdown.tsx` | 包裹 ClientOnly + 合并 noModels 渲染路径 | 解决水合问题 |
| `frontend/src/components/chat/landing.tsx` | 包裹 ClientOnly | 解决水合问题 |
| `frontend/src/components/layout/session-list.tsx` | 新增已归档会话过滤 + 已归档视图切换；错误时显示"连接失败" | 功能增强 |
| `frontend/src/i18n/config.ts` | `fallbackLng: "en"` → `fallbackLng: "zh"` | 中文优先 |
| `frontend/src/i18n/locales/zh/common.json` | 新增 `contentWorkbench` key | 侧边栏中文 |
| `frontend/src/i18n/locales/en/common.json` | 新增 `contentWorkbench` key | 侧边栏英文 |
| `frontend/src/i18n/locales/zh/settings.json` | 新增 `tabXflow` key | Settings 中文 |
| `frontend/src/i18n/locales/en/settings.json` | 新增 `tabXflow` key | Settings 英文 |

### 2.2 后端修改（4 文件）

| 文件 | 修改内容 | 原因 |
|------|----------|------|
| `backend/app/config.py` | `port: 8000` → `port: 8090`；新增 `xflow_api_url`、`xflow_api_token` 字段 | 端口统一 + xflow 配置 |
| `backend/app/main.py` | 导入并注册 `ALL_XFLOW_TOOLS` | 注册 11 个 xflow tools |
| `backend/app/auth/middleware.py` | 新增 `/api/connectors/oauth/`、`/api/mcp/oauth/` 到公开路径 | OAuth 回调不需要认证 |
| `backend/app/auth/tunnel.py` | `backend_port: 8000` → `backend_port: 8090` | 端口统一 |

### 2.3 构建与配置修改（3 文件）

| 文件 | 修改内容 | 原因 |
|------|----------|------|
| `package.json` | `dev:backend` 端口 8000 → 8090 | 端口统一 |
| `scripts/dev-all.mjs` | `NEXT_PUBLIC_API_URL` 默认端口 8000 → 8090 | 端口统一 |
| `scripts/build-desktop.sh` | venv 创建改用 `uv venv --python 3.12`；pip install 改用 `uv pip install`；pyinstaller 改用 `.venv/bin/pyinstaller` | macOS Python 3.13 pyexpat 不兼容 |
| `backend/run.py` | 默认端口 8000 → 8090 | 端口统一 |

---

## 三、汇总统计

| 类别 | 数量 |
|------|------|
| 新增前端文件 | ~20 |
| 新增后端文件 | 1 |
| 新增文档/配置 | 2 |
| 修改前端文件 | ~16 |
| 修改后端文件 | 4 |
| 修改构建/配置 | 4 |

---

## 四、升级注意事项

当上游 OpenYak 发布新版本时，需特别关注以下文件的冲突：

1. **`backend/app/main.py`** — xflow tools 注册代码需要保留
2. **`backend/app/config.py`** — xflow 配置字段需要保留；端口需保持 8090
3. **`backend/app/auth/middleware.py`** — OAuth 回调白名单需要保留
4. **`frontend/src/components/settings/providers-tab.tsx`** — 移除了大量服务商代码
5. **`frontend/src/components/layout/session-list.tsx`** — 归档功能修改
6. **`scripts/build-desktop.sh`** — venv 创建方式修改
