---
name: openyak-frontend-dev
description: >-
  Builds and maintains OpenYak Next.js 15 UI—App Router, components, Zustand,
  TanStack Query, SSE hooks, Tailwind/shadcn. Use when editing `frontend/`,
  chat/settings UX, or when the user mentions前端、Next.js、React、SSE、
  静态导出、桌面嵌入、hooks、stores.
---

# OpenYak 前端开发技能

## 何时使用

- 修改或新增 `frontend/src/` 页面、组件、hooks、状态、样式与国际化。
- 对接后端 API/SSE、桌面静态导出、或 `NEXT_PUBLIC_*` 行为问题。

## 权威文档（按需深读）

| 主题 | 路径 |
|------|------|
| 结构与约定 | `docs/development/04-前端开发指南.md` |
| API / 流式 | `docs/development/05-API接口文档.md` |
| 架构关系 | `docs/development/02-架构设计.md`（前端小节） |
| 构建与 env | `docs/development/12-构建与部署.md`（以根 `package.json` + `scripts/build-frontend.sh` 为准） |

## 入口与关键路径

- **路由**：`frontend/src/app/` — `layout.tsx`、`globals.css`；功能路由组 `(main)/`（桌面）、`(mobile)/`（移动）
- **组件分层**：`components/ui/`（shadcn 原语）→ `components/<feature>/`（业务）
- **数据与实时**：`hooks/`（如 `use-sse.ts`、`use-messages.ts`、`use-chat.ts`）；全局状态 `stores/`（Zustand）
- **HTTP 封装**：`lib/api.ts`；共享类型 `types/`
- **构建配置**：`frontend/next.config.ts`—桌面构建由 `scripts/build-frontend.sh` 设置 `DESKTOP_BUILD=true`、`NEXT_PUBLIC_DESKTOP_BUILD=true`，产出 `frontend/out/`

## 本地运行

- `cd frontend && npm run dev`（Turbopack），或根目录 `npm run dev:frontend`
- `.env.local`：至少 `NEXT_PUBLIC_API_URL=http://localhost:8000`（与后端一致）

## 实现约定

- **静态导出模式**：`output: "export"` 时无服务端重写；依赖代理的逻辑仅在非桌面 dev 路径生效（见 `next.config.ts`）。不要把仅 dev 可用的假设带进桌面产物。
- **样式**：Tailwind 4 + CSS 变量主题；新 UI 优先复用 `components/ui`，保持间距与现有页面一致。
- **SSE/聊天**：变更事件消费时同步 `use-sse`、`chat-store` 与 `parts/` 渲染；类型与后端 schema 对齐。
- **新页面**：放入正确路由组 `(main)` / `(mobile)`，并遵循现有 layout 嵌套。

## 与后端协作

- 路径与查询参数以 `05-API接口文档.md` 和实际 `backend/app/api` 为准；改 API 时更新 `lib/api.ts` 与 `types/`。

## 全仓上下文

- 单仓地图：`.cursor/rules/openyak-workspace.mdc`；桌面打包：`openyak-build` 规则与 `npm run build:release*`。
