# 01 - 内容工作台与 Xflow 集成

> **定制编号**: XFLOW-001 ~ XFLOW-004  
> **首次提交**: `5e82ad0` — feat: 实施 xflow 定制功能（XFLOW-001 ~ XFLOW-012）  
> **涉及范围**: 前端路由 + 后端工具 + API 客户端 + 类型定义

---

## 一、功能概述

本模块实现了 Xflow 桌面端与外部 Xflow 业务后端的深度集成，核心包含：

1. **内容工作台**（XFLOW-001）：完整的内容管理页面，含产品、博客、分类、搭配、视频五大模块
2. **Xflow API 配置与客户端**（XFLOW-002/003）：连接外部 Xflow 后端的配置管理与 API 客户端封装
3. **Xflow 后端工具**（XFLOW-004）：将 Xflow 业务能力注册为 AI 可调用的内置工具

> **提示**：Provider 与模型本地缓存（XFLOW-012）及 model_ids 支持（XFLOW-007）已独立至 [09-Provider与模型管理.md](./09-Provider与模型管理.md)。

---

## 二、内容工作台（XFLOW-001）

### 2.1 路由结构

新增 `frontend/src/app/(main)/content_workbench/` 路由组，包含以下页面：

```
content_workbench/
├── page.tsx                    # 仪表盘总览页（Dashboard）
├── nav.tsx                     # 侧边导航组件
├── products/
│   ├── page.tsx                # 产品列表页
│   ├── new/page.tsx            # 新建产品页
│   └── [id]/
│       ├── page.tsx            # 产品详情页（generateStaticParams）
│       └── edit-client.tsx     # 编辑产品客户端组件（useParams）
├── blogs/
│   ├── page.tsx                # 博客列表页
│   ├── new/page.tsx            # 新建博客页
│   └── [id]/
│       ├── page.tsx            # 博客详情页
│       └── edit-client.tsx     # 编辑博客客户端组件
├── categories/
│   ├── page.tsx                # 分类列表页
│   ├── new/page.tsx            # 新建分类页
│   └── [id]/
│       ├── page.tsx            # 分类详情页
│       └── edit-client.tsx     # 编辑分类客户端组件
├── outfits/
│   ├── page.tsx                # 搭配列表页
│   └── [id]/
│       ├── page.tsx            # 搭配详情页
│       └── edit-client.tsx     # 编辑搭配客户端组件
└── videos/
    └── page.tsx                # 视频列表页
```

### 2.2 动态路由拆分策略

Next.js 静态导出要求动态路由 `[id]` 页必须拆分为：

- **page.tsx**：使用 `generateStaticParams` 满足静态导出要求
- **edit-client.tsx**：使用 `useParams` 的客户端组件，处理实际编辑逻辑

**关键实现模式**（以产品编辑为例）：

```tsx
// products/[id]/page.tsx
export async function generateStaticParams() {
  return []; // 静态导出占位，实际数据在客户端加载
}

export default function ProductEditPage() {
  return <ProductEditClient />;
}
```

```tsx
// products/[id]/edit-client.tsx
"use client";
import { useParams } from "next/navigation";
import { useXflowConfig } from "@/hooks/use-xflow-config";
// ... 客户端渲染与编辑逻辑
```

### 2.3 仪表盘页面

仪表盘总览页展示 Xflow 业务的关键指标：

- 产品统计：总数 / 已发布 / 草稿
- 博客统计：总数 / 已发布 / 草稿
- 分类统计：总数
- 搭配统计：总数 / 已发布 / 草稿
- 视频统计：总数 / 已发布 / 草稿

数据来源：`useXflowDashboard` hook → `getDashboardStats()` API。

### 2.4 i18n 支持

新增 `contentWorkbench` 命名空间翻译文件：

- `frontend/src/i18n/locales/en/contentWorkbench.json`（49 条）
- `frontend/src/i18n/locales/zh/contentWorkbench.json`（49 条）

涵盖所有 CRUD 操作、状态标签、表单字段、确认提示等。

---

## 三、Xflow API 配置与客户端（XFLOW-002/003）

### 3.1 配置管理

**配置存储**：Xflow 连接配置（URL + Token）持久化在后端，前端通过设置页管理。

**设置页新增 Xflow Tab**：

- 文件：`frontend/src/components/settings/xflow-tab.tsx`
- 功能：Xflow 服务器 URL 与 API Token 配置、连接测试
- 集成到设置页标签栏：`settings-tabs.ts` 新增 `xflow` 条目

**Hook**：`use-xflow-config.ts`

```typescript
// 核心 hook 导出
export function useXflowConfig(): UseQueryResult<XflowConfig>
export function useUpdateXflowConfig(): UseMutationResult
export function useTestXflowConnection(): UseMutationResult
```

### 3.2 API 客户端

**文件**：`frontend/src/lib/xflow-api.ts`

封装了完整的 Xflow REST API 客户端，所有请求自动注入 Bearer Token：

```typescript
// 基础请求封装
async function xflowFetch<T>(path: string, options?: RequestInit): Promise<T>

// 产品 CRUD
export const getProducts(params?)       // GET /api/products
export const getProduct(id)             // GET /api/products/{id}
export const createProduct(data)        // POST /api/products
export const updateProduct(id, data)    // PUT /api/products/{id}
export const deleteProduct(id)          // DELETE /api/products/{id}

// 博客 CRUD
export const getBlogs(params?)
export const getBlog(id)
export const createBlog(data)
export const updateBlog(id, data)
export const deleteBlog(id)

// 分类 CRUD
export const getCategories(params?)
export const getCategory(id)
export const createCategory(data)
export const updateCategory(id, data)
export const deleteCategory(id)

// 搭配 CRUD
export const getOutfits(params?)
export const getOutfit(id)
export const createOutfit(data)
export const updateOutfit(id, data)
export const deleteOutfit(id)

// 视频 CRUD
export const getVideos(params?)
export const createVideo(data)
export const updateVideo(id, data)
export const deleteVideo(id)

// 仪表盘
export const getDashboardStats()        // GET /api/dashboard/stats

// 连接测试
export const testXflowConnection(url, token)
```

### 3.3 类型定义

**文件**：`frontend/src/types/xflow.ts`

```typescript
export interface Product {
  id: number | string;
  title: string;
  description?: string | null;
  price?: number | null;
  image_url?: string | null;
  category_id?: number | string | null;
  status?: "published" | "draft";
  created_at?: string;
  updated_at?: string;
}

export interface Blog {
  id: number | string;
  title: string;
  content?: string | null;
  excerpt?: string | null;
  featured_image_url?: string | null;
  category_id?: number | string | null;
  status?: "published" | "draft";
  created_at?: string;
  updated_at?: string;
}

export interface Category {
  id: number | string;
  name: string;
  description?: string | null;
  image_url?: string | null;
  parent_id?: number | string | null;
  created_at?: string;
  updated_at?: string;
}

export interface Outfit {
  id: number | string;
  title: string;
  description?: string | null;
  image_url?: string | null;
  product_ids?: (number | string)[];
  status?: "published" | "draft";
  created_at?: string;
  updated_at?: string;
}

export interface Video {
  id: number | string;
  title: string;
  description?: string | null;
  url?: string | null;
  thumbnail_url?: string | null;
  status?: "published" | "draft";
  created_at?: string;
  updated_at?: string;
}

export interface DashboardStats {
  products: { total: number; published: number; draft: number };
  blogs: { total: number; published: number; draft: number };
  categories: { total: number };
  outfits: { total: number; published: number; draft: number };
  videos: { total: number; published: number; draft: number };
}

export interface XflowPaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

export interface XflowConfig {
  url: string;
  token: string;
}
```

---

## 四、Xflow 后端工具（XFLOW-004）

### 4.1 工具注册

**文件**：`backend/app/tool/builtin/xflow_tools.py`

将 Xflow 业务能力注册为 AI 内置工具，注入 `ToolRegistry`。工具通过 Xflow 后端 API 获取业务数据，使 AI 助手能够在对话中直接操作产品、博客、分类等内容。

### 4.2 工具能力

工具通过 HTTP 请求访问 Xflow 后端 API，支持：

- 查询产品/博客/分类/搭配/视频列表
- 读取单个资源详情
- 创建和更新内容
- 获取仪表盘统计

工具配置从会话的 Xflow 配置中读取 URL 和 Token。

---

## 五、AI 工具配置文件（.cursor）

### 5.1 Cursor Rules

新增 5 个 `.cursor/rules/` MDC 规则文件，为 AI 编码助手提供项目上下文：

| 文件 | 说明 |
|------|------|
| `.cursor/rules/openyak-workspace.mdc` | 单仓地图、npm 脚本索引、架构决策入口 |
| `.cursor/rules/openyak-backend.mdc` | 后端目录结构与约定 |
| `.cursor/rules/openyak-frontend.mdc` | 前端目录结构与约定 |
| `.cursor/rules/openyak-desktop.mdc` | 桌面端（Tauri）约定 |
| `.cursor/rules/openyak-build.mdc` | 构建与部署约定 |

### 5.2 Cursor Skills

新增 3 个 `.cursor/skills/` 技能文件：

| 文件 | 说明 |
|------|------|
| `.cursor/skills/openyak-workspace/SKILL.md` | 全栈协作入口，文档索引 |
| `.cursor/skills/openyak-backend-dev/SKILL.md` | 后端开发技能 |
| `.cursor/skills/openyak-frontend-dev/SKILL.md` | 前端开发技能 |

---

## 六、涉及文件清单

| 类别 | 文件路径 | 变更类型 |
|------|---------|---------|
| 前端路由 | `frontend/src/app/(main)/content_workbench/**` | 新增 |
| API 客户端 | `frontend/src/lib/xflow-api.ts` | 新增 |
| 类型定义 | `frontend/src/types/xflow.ts` | 新增 |
| Hook | `frontend/src/hooks/use-xflow-config.ts` | 新增 |
| Hook | `frontend/src/hooks/use-xflow-dashboard.ts` | 新增 |
| 设置页 | `frontend/src/components/settings/xflow-tab.tsx` | 新增 |
| UI 组件 | `frontend/src/components/ui/client-only.tsx` | 新增 |
| UI 组件 | `frontend/src/components/ui/label.tsx` | 新增 |
| i18n | `frontend/src/i18n/locales/{en,zh}/contentWorkbench.json` | 新增 |
| 后端工具 | `backend/app/tool/builtin/xflow_tools.py` | 新增 |
| 后端入口 | `backend/app/main.py` | 修改（XFLOW 工具注册） |
| 后端技能 | `backend/app/skill/registry.py` | 修改（.cursor/skills 搜索路径） |
| 侧边栏 | `frontend/src/components/layout/sidebar-nav.tsx` | 修改（完整重写，含内容工作台入口） |
| 常量 | `frontend/src/lib/constants.ts` | 修改 |
| Store | `frontend/src/stores/sidebar-store.ts` | 修改 |
| 类型 | `frontend/src/types/index.ts` | 修改 |
| 类型 | `frontend/src/types/usage.ts` | 修改 |
| i18n | `frontend/src/i18n/config.ts` | 修改 |
| i18n | `frontend/src/i18n/locales/{en,zh}/{common,settings}.json` | 修改 |
| Cursor 规则 | `.cursor/rules/openyak-*.mdc` | 新增（5 个） |
| Cursor 技能 | `.cursor/skills/openyak-*/SKILL.md` | 新增（3 个） |

---

## 七、重新实现检查清单

基于新版本 OpenYak 重新实现本模块时，需确认以下关键点：

- [ ] 内容工作台路由结构及 Next.js 静态导出兼容的 `[id]` 页拆分模式
- [ ] Xflow API 客户端完整 CRUD 封装（产品/博客/分类/搭配/视频/仪表盘）
- [ ] Xflow 配置管理（设置页 Tab + Hook + 连接测试）
- [ ] 类型定义完整性（所有接口与后端保持一致）
- [ ] 后端 Xflow 工具注册及 ToolRegistry 集成（`ALL_XFLOW_TOOLS`）
- [ ] `sidebar-nav.tsx` 完整重写（内容工作台 LayoutDashboard + 知识中心 BookOpen）
- [ ] `.cursor/skills` 搜索路径注册（`skill/registry.py` 的 `_EXTERNAL_SKILL_DIRS` 新增 `.cursor`）
- [ ] contentWorkbench i18n 命名空间（中英 49 条/语言）
- [ ] i18n 默认语言设为 zh
- [ ] 默认端口改为 8090
- [ ] `.cursor/rules/` 5 个 MDC 规则文件
- [ ] `.cursor/skills/` 3 个 SKILL.md 技能文件

> **Provider/model_ids/缓存相关**检查清单已移至 [09-Provider与模型管理.md](./09-Provider与模型管理.md)。
