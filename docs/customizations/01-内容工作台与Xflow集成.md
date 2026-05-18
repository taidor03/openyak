# 01 - 内容工作台与 Xflow 集成

> **定制编号**: XFLOW-001 ~ XFLOW-004  
> **涉及范围**: 前端路由 + 后端工具 + API 客户端 + 类型定义 + .cursor 配置

---

## 一、功能概述

本模块实现了 Xflow 桌面端与外部 Xflow 业务后端的深度集成，核心包含：

1. **内容工作台**（XFLOW-001）：完整的内容管理页面，含产品、博客、分类、搭配、视频五大模块
2. **Xflow API 配置与客户端**（XFLOW-002/003）：连接外部 Xflow 后端的配置管理与 API 客户端封装
3. **Xflow 后端工具**（XFLOW-004）：将 Xflow 业务能力注册为 AI 可调用的内置工具

> **提示**：Provider 与模型本地缓存（XFLOW-012）及 model_ids 支持（XFLOW-007）已独立至 [08-Provider与模型管理.md](./08-Provider与模型管理.md)。

---

## 二、内容工作台（XFLOW-001）

### 2.1 路由结构

新增 `frontend/src/app/(main)/content_workbench/` 路由组：

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

**配置存储**：Xflow 连接配置（URL + Token）持久化在后端 `config.py`：

```python
# backend/app/config.py
class Settings(BaseModel):
    # --- xflow API ---
    xflow_api_url: str = ""    # OPENYAK_XFLOW_API_URL
    xflow_api_token: str = ""  # OPENYAK_XFLOW_API_TOKEN
```

**设置页新增 Xflow Tab**：

- 文件：`frontend/src/components/settings/xflow-tab.tsx`
- 功能：Xflow 服务器 URL 与 API Token 配置、连接测试
- 集成到设置页标签栏：`settings-tabs.ts` 新增条目

```typescript
// frontend/src/components/settings/settings-tabs.ts
{ id: "xflow", icon: LayoutDashboard, labelKey: "tabXflow" },
```

**Hook**：`use-xflow-config.ts`

```typescript
export function useXflowConfig(): UseQueryResult<XflowConfig>
export function useUpdateXflowConfig(): UseMutationResult
export function useTestXflowConnection(): UseMutationResult
```

### 3.2 API 客户端

**文件**：`frontend/src/lib/xflow-api.ts`（199 行）

封装了完整的 Xflow REST API 客户端，所有请求自动注入 Bearer Token。配置从 `localStorage` 的 `xflow-config` key 读取：

```typescript
const XFLOW_CONFIG_KEY = "xflow-config";

export function getXflowConfig(): XflowConfig | null {
  const raw = window.localStorage.getItem(XFLOW_CONFIG_KEY);
  if (!raw) return null;
  const parsed = JSON.parse(raw);
  if (parsed.url && parsed.token) return parsed;
  return null;
}

export function setXflowConfig(config: XflowConfig): void {
  window.localStorage.setItem(XFLOW_CONFIG_KEY, JSON.stringify(config));
}
```

**基础请求封装**：

```typescript
async function xflowFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const config = getXflowConfig();
  if (!config?.url || !config?.token) {
    throw new Error("xflow API 未配置，请先在设置中填写 URL 和 Token");
  }
  const url = `${config.url.replace(/\/$/, "")}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: { ...buildHeaders(config), ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`xflow API 错误 ${res.status}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
```

**CRUD 函数完整列表**：

```typescript
// 产品 CRUD
export const listProducts = (params?)          // GET /api/products?page=&page_size=&search=
export const getProduct = (id)                 // GET /api/products/{id}
export const createProduct = (data)            // POST /api/products
export const updateProduct = (id, data)        // PUT /api/products/{id}
export const deleteProduct = (id)              // DELETE /api/products/{id}

// 博客 CRUD
export const listBlogs = (params?)             // GET /api/blogs
export const getBlog = (id)                    // GET /api/blogs/{id}
export const createBlog = (data)               // POST /api/blogs
export const updateBlog = (id, data)           // PUT /api/blogs/{id}
export const deleteBlog = (id)                 // DELETE /api/blogs/{id}

// 分类 CRUD
export const listCategories = (params?)        // GET /api/categories
export const getCategory = (id)                // GET /api/categories/{id}
export const createCategory = (data)           // POST /api/categories
export const updateCategory = (id, data)       // PUT /api/categories/{id}
export const deleteCategory = (id)             // DELETE /api/categories/{id}

// 搭配 CRUD
export const listOutfits = (params?)           // GET /api/outfits
export const createOutfit = (data)             // POST /api/outfits
export const updateOutfit = (id, data)         // PUT /api/outfits/{id}
export const deleteOutfit = (id)               // DELETE /api/outfits/{id}

// 视频 CRUD
export const listVideos = (params?)            // GET /api/videos
export const createVideo = (data)              // POST /api/videos
export const updateVideo = (id, data)          // PUT /api/videos/{id}
export const deleteVideo = (id)                // DELETE /api/videos/{id}

// 仪表盘
export const getDashboardStats = ()            // GET /api/dashboard/stats

// 连接测试
export const testXflowConnection = (url, token) // GET {url}/api/health (8s timeout)
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

**文件**：`backend/app/tool/builtin/xflow_tools.py`（400 行）

将 Xflow 业务能力注册为 AI 内置工具，注入 `ToolRegistry`。

**注入点** — `backend/app/main.py` 中 `_register_builtin_tools()` 函数内：

```python
# 在 SkillTool 注册之后、FTS SearchTool 之前
# xflow API tools — always registered; tools surface a config error when invoked without credentials
from app.tool.builtin.xflow_tools import ALL_XFLOW_TOOLS
for xflow_tool_cls in ALL_XFLOW_TOOLS:
    registry.register(xflow_tool_cls())
```

### 4.2 配置读取机制

所有 Xflow 工具通过 `_xflow_request` 辅助函数统一读取配置和发送请求：

```python
async def _xflow_request(
    method: str,
    path: str,
    *,
    body: dict[str, Any] | None = None,
) -> dict[str, Any]:
    settings = get_settings()
    url = settings.xflow_api_url
    token = settings.xflow_api_token
    if not url or not token:
        raise ValueError(
            "xflow API 未配置，请在设置中填写 OPENYAK_XFLOW_API_URL 和 OPENYAK_XFLOW_API_TOKEN"
        )
    base = url.rstrip("/")
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=30.0) as client:
        kwargs: dict[str, Any] = {"headers": headers}
        if body is not None:
            kwargs["json"] = body
        response = await getattr(client, method.lower())(f"{base}{path}", **kwargs)
        response.raise_for_status()
        if response.status_code == 204:
            return {}
        return dict(response.json())
```

### 4.3 工具清单

`ALL_XFLOW_TOOLS` 包含 11 个工具类：

| 工具类 | tool id | 功能 | 并发安全 | 参数 |
|--------|---------|------|---------|------|
| `XflowListProductsTool` | `xflow_list_products` | 列出商品 | ✅ | page, page_size, search |
| `XflowGetProductTool` | `xflow_get_product` | 商品详情 | ✅ | id (required) |
| `XflowCreateProductTool` | `xflow_create_product` | 创建商品 | ❌ | title (required), description, price, category_id, status |
| `XflowUpdateProductTool` | `xflow_update_product` | 更新商品 | ❌ | id (required), title, description, price, status |
| `XflowDeleteProductTool` | `xflow_delete_product` | 删除商品 | ❌ | id (required) |
| `XflowListBlogsTool` | `xflow_list_blogs` | 列出博文 | ✅ | page, page_size |
| `XflowListCategoriesTool` | `xflow_list_categories` | 列出分类 | ✅ | page, page_size |
| `XflowListOutfitsTool` | `xflow_list_outfits` | 列出穿搭 | ✅ | page, page_size |
| `XflowListVideosTool` | `xflow_list_videos` | 列出视频 | ✅ | page, page_size |
| `XflowGetDashboardStatsTool` | `xflow_get_dashboard_stats` | 看板统计 | ✅ | (无参数) |
| `XflowSearchContentTool` | `xflow_search_content` | 跨类型搜索 | ✅ | query (required) |

---

## 五、侧边栏导航增强

### 5.1 完整重写

**文件**：`frontend/src/components/layout/sidebar-nav.tsx`

原始组件只返回 `null`，被完全重写为带导航链接的侧边栏：

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslation } from "react-i18next";
import { LayoutDashboard, BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_LINKS = [
  {
    href: "/content-workbench",
    labelKey: "contentWorkbench",
    icon: LayoutDashboard,
  },
  {
    href: "/knowledge",
    labelKey: "knowledgeCenter",
    icon: BookOpen,
  },
] as const;

export function SidebarNav() {
  const pathname = usePathname();
  const { t } = useTranslation("common");

  return (
    <nav className="px-3 pt-1 pb-2 flex flex-col gap-0.5">
      {NAV_LINKS.map(({ href, labelKey, icon: Icon }) => {
        const active = pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors",
              active
                ? "bg-[var(--brand-primary)] text-[var(--brand-primary-text)]"
                : "text-[var(--text-secondary)] hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)]",
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            {t(labelKey)}
          </Link>
        );
      })}
    </nav>
  );
}
```

---

## 六、.cursor 配置文件

### 6.1 Cursor Rules

新增 5 个 `.cursor/rules/` MDC 规则文件：

| 文件 | 说明 |
|------|------|
| `.cursor/rules/openyak-workspace.mdc` | 单仓地图、npm 脚本索引、架构决策入口 |
| `.cursor/rules/openyak-backend.mdc` | 后端目录结构与约定 |
| `.cursor/rules/openyak-frontend.mdc` | 前端目录结构与约定 |
| `.cursor/rules/openyak-desktop.mdc` | 桌面端（Tauri）约定 |
| `.cursor/rules/openyak-build.mdc` | 构建与部署约定 |

### 6.2 Cursor Skills

新增 3 个 `.cursor/skills/` 技能文件：

| 文件 | 说明 |
|------|------|
| `.cursor/skills/openyak-workspace/SKILL.md` | 全栈协作入口，文档索引 |
| `.cursor/skills/openyak-backend-dev/SKILL.md` | 后端开发技能 |
| `.cursor/skills/openyak-frontend-dev/SKILL.md` | 前端开发技能 |

### 6.3 Skill Registry 搜索路径扩展

**文件**：`backend/app/skill/registry.py`

```python
_EXTERNAL_SKILL_DIRS = [".claude", ".agents", ".cursor"]
```

`.cursor` 被新增到 `_EXTERNAL_SKILL_DIRS`，使 `SkillRegistry.scan()` 递归搜索 `.cursor/skills/` 下的 `SKILL.md` 文件。

---

## 七、配置常量表

| 常量 | 值 | 文件 |
|------|-----|------|
| `XFLOW_CONFIG_KEY` | `"xflow-config"` | `frontend/src/lib/xflow-api.ts` |
| `_TIMEOUT` (后端) | `30.0` 秒 | `backend/app/tool/builtin/xflow_tools.py` |
| 连接测试超时 | `8000` ms | `frontend/src/lib/xflow-api.ts` |
| `xflow_api_url` | 环境变量 `OPENYAK_XFLOW_API_URL` | `backend/app/config.py` |
| `xflow_api_token` | 环境变量 `OPENYAK_XFLOW_API_TOKEN` | `backend/app/config.py` |

---

## 八、涉及文件清单

| 类别 | 文件路径 | 变更类型 |
|------|---------|---------|
| 前端路由 | `frontend/src/app/(main)/content_workbench/**` | 新增 |
| API 客户端 | `frontend/src/lib/xflow-api.ts` | 新增 |
| 类型定义 | `frontend/src/types/xflow.ts` | 新增 |
| Hook | `frontend/src/hooks/use-xflow-config.ts` | 新增 |
| Hook | `frontend/src/hooks/use-xflow-dashboard.ts` | 新增 |
| 设置页 | `frontend/src/components/settings/xflow-tab.tsx` | 新增 |
| 设置页 | `frontend/src/components/settings/settings-tabs.ts` | 修改（+xflow 条目） |
| UI 组件 | `frontend/src/components/ui/client-only.tsx` | 新增 |
| UI 组件 | `frontend/src/components/ui/label.tsx` | 新增 |
| i18n | `frontend/src/i18n/locales/{en,zh}/contentWorkbench.json` | 新增 |
| 后端工具 | `backend/app/tool/builtin/xflow_tools.py` | 新增 |
| 后端入口 | `backend/app/main.py` | 修改（+ALL_XFLOW_TOOLS 注册） |
| 后端配置 | `backend/app/config.py` | 修改（+xflow_api_url/token） |
| 后端技能 | `backend/app/skill/registry.py` | 修改（+.cursor 搜索路径） |
| 侧边栏 | `frontend/src/components/layout/sidebar-nav.tsx` | 修改（完整重写） |
| 常量 | `frontend/src/lib/constants.ts` | 修改 |
| Store | `frontend/src/stores/sidebar-store.ts` | 修改 |
| 类型 | `frontend/src/types/index.ts` | 修改 |
| 类型 | `frontend/src/types/usage.ts` | 修改 |
| i18n | `frontend/src/i18n/config.ts` | 修改 |
| i18n | `frontend/src/i18n/locales/{en,zh}/{common,settings}.json` | 修改 |
| Cursor 规则 | `.cursor/rules/openyak-*.mdc` | 新增（5 个） |
| Cursor 技能 | `.cursor/skills/openyak-*/SKILL.md` | 新增（3 个） |

---

## 九、重新实现检查清单

- [ ] 内容工作台路由结构及 Next.js 静态导出兼容的 `[id]` 页拆分模式
- [ ] Xflow API 客户端完整 CRUD 封装（产品/博客/分类/搭配/视频/仪表盘）
- [ ] Xflow 配置管理（设置页 Tab + Hook + 连接测试）
- [ ] 类型定义完整性（所有接口与后端保持一致）
- [ ] 后端 Xflow 工具注册及 ToolRegistry 集成（`ALL_XFLOW_TOOLS` 11 个工具类）
- [ ] `main.py` 在 `SkillTool` 注册之后插入 `ALL_XFLOW_TOOLS` 注册
- [ ] `config.py` 新增 `xflow_api_url` / `xflow_api_token` 字段
- [ ] `sidebar-nav.tsx` 完整重写（内容工作台 LayoutDashboard + 知识中心 BookOpen）
- [ ] `settings-tabs.ts` 新增 xflow 条目
- [ ] `.cursor/skills` 搜索路径注册（`skill/registry.py` 的 `_EXTERNAL_SKILL_DIRS` 新增 `.cursor`）
- [ ] contentWorkbench i18n 命名空间（中英 49 条/语言）
- [ ] `.cursor/rules/` 5 个 MDC 规则文件
- [ ] `.cursor/skills/` 3 个 SKILL.md 技能文件

> **Provider/model_ids/缓存相关**检查清单已移至 [08-Provider与模型管理.md](./08-Provider与模型管理.md)。
> **默认端口/默认语言**检查清单已移至 [07-构建配置与插件精简.md](./07-构建配置与插件精简.md)。
