# 06 - 知识中心 Wiki 服务

> **涉及范围**: 后端 Wiki 服务 + 前端知识中心页面 + AI Wiki 工具
git 历史`2f95df7` 包含了 06 定制的完整实现，这个定制比较独立，可直接提取加以调整来实现。
---

## 一、功能概述

1. **Wiki 后端服务**：完整的 Wiki 页面 CRUD、搜索、合并、清理
2. **AI Wiki 工具**：AI 助手可在对话中直接操作 Wiki 知识
3. **前端知识中心页面**：可视化 Wiki 管理 UI

---

## 二、后端 Wiki 服务

### 2.1 模块结构

```
backend/app/wiki/
├── __init__.py       # 模块初始化
├── service.py        # WikiService 全文操作（878 行）
├── tool.py           # WikiTool 内置工具注册（520 行）
├── resolver.py       # 页面路径解析与 wikilink 去包装
├── search.py         # lexical search（标题匹配 + 内容片段）
├── cleanup.py        # section merge、frontmatter 解析、deleted keys 清理
└── filename.py       # query → safe filename 转换
```

### 2.2 WikiService（service.py）

核心服务类，提供 Wiki 全文操作：

```python
class WikiService:
    def __init__(self, wiki_root: Path):
        self.wiki_root = wiki_root

    # 读取页面
    async def read_page(self, page_id: str) -> dict | None

    # 写入/创建页面
    async def write_page(self, title: str, content: str, **kwargs) -> dict

    # 合并保存（保留 AI 修改 + 用户手动修改）
    async def merge_page(self, page_id: str, new_content: str) -> dict

    # 搜索页面
    async def search(self, query: str, limit: int = 10) -> list[dict]

    # 列出所有页面
    async def list_pages(self, category: str | None = None) -> list[dict]

    # 删除页面
    async def delete_page(self, page_id: str) -> bool

    # Wiki 状态（页面数、最后更新时间）
    async def status(self) -> dict

    # 重复检测与合并
    async def duplicates(self) -> list[dict]
    async def deduplicate(self, page_ids: list[str]) -> dict
```

### 2.3 Wiki 根路径解析

Wiki 根路径按优先级解析：

1. 项目级 `.wiki/`（当前项目目录下）
2. 全局 `~/.xflow/wiki/`（用户主目录下）

项目级 Wiki 优先，使不同项目可以拥有独立的 Wiki 知识库。

### 2.4 6 大分类体系

```
.wiki/
├── entities/     # 实体分类页面
├── concepts/     # 概念说明页面
├── sources/      # 来源引用页面
├── synthesis/    # 综合总结页面
├── comparison/   # 对比分析页面
└── queries/      # 常见问题页面
```

### 2.5 写入保护机制

`write_page` 默认 `force=false`：

- 如果页面已存在，返回 `exists=true` 和现有内容
- AI 必须选择 `merge` 操作（只提供变更部分）或 `write + force=true`（覆盖全部）
- 这防止 AI 意外覆盖用户手动修改的内容

---

## 三、WikiTool — AI 内置工具

### 3.1 工具注册

**文件**：`backend/app/wiki/tool.py`（520 行）

工具 id: `"wiki"`

`is_concurrency_safe = False`（Wiki 操作有副作用，不可并发）

### 3.2 工具参数 Schema

```python
"parameters": {
    "type": "object",
    "required": ["action"],
    "properties": {
        "action": {
            "type": "string",
            "enum": ["read", "write", "merge", "search", "list", "delete", "status", "ingest"],
            "description": "Action to perform"
        },
        "query": {
            "type": "string",
            "description": "Search query (for search action)"
        },
        "title": {
            "type": "string",
            "description": "Page title (for write/merge action, or as search key for read)"
        },
        "content": {
            "type": "string",
            "description": "Page content in Markdown (for write/merge action)"
        },
        "page_id": {
            "type": "string",
            "description": "Page ID/slug (for read/delete action)"
        },
        "category": {
            "type": "string",
            "description": "Page category (entities/concepts/sources/synthesis/comparison/queries)"
        },
        "force": {
            "type": "boolean",
            "description": "For write action: if true, overwrite existing page"
        },
        "source_name": {
            "type": "string",
            "description": "Name/title for the source document (for ingest action)"
        },
        "source_content": {
            "type": "string",
            "description": "Source document content (for ingest action)"
        },
    }
}
```

### 3.3 8 个 Action 说明

| Action | 功能 | 关键行为 |
|--------|------|---------|
| `read` | 读取页面 | 通过 page_id 或 title 查找 |
| `write` | 写入/创建页面 | force=false 时如已存在返回 exists=true |
| `merge` | 合并保存 | 只提供变更部分，保留用户手动修改 |
| `search` | 搜索页面 | 标题匹配 + 内容片段 |
| `list` | 列出页面 | 可按 category 过滤 |
| `delete` | 删除页面 | 按 page_id 删除 |
| `status` | Wiki 状态 | 页面数、最后更新时间 |
| `ingest` | 导入来源 | 将外部文档内容导入为 Wiki 页面 |

### 3.4 AI 使用指引（嵌入 tool description）

```
- When updating an existing page, prefer the **merge** action to preserve \
  user edits that may have happened since the last AI update.
- If the write action returns `exists=true`, you MUST either:
  1. merge action: supply only the new/changed sections
  2. write action with force=true: supply the FULL merged content
```

---

## 四、Wiki REST API

**文件**：`backend/app/api/wiki.py`

| 端点 | 方法 | 功能 |
|------|------|------|
| `/api/wiki/status` | GET | Wiki 状态信息 |
| `/api/wiki/initialize` | POST | 初始化 Wiki 目录结构 |
| `/api/wiki/pages` | GET | 列出所有页面 |
| `/api/wiki/pages/{page_id:path}` | GET | 读取页面 |
| `/api/wiki/pages` | POST | 写入/创建页面 |
| `/api/wiki/merge` | POST | 合并保存 |
| `/api/wiki/ingest` | POST | 导入外部文档 |
| `/api/wiki/lint` | GET | 检查 Wiki 问题 |
| `/api/wiki/pages/{page_id:path}` | DELETE | 删除页面 |
| `/api/wiki/search` | POST | 搜索页面 |
| `/api/wiki/duplicates` | GET | 检测重复页面 |
| `/api/wiki/deduplicate` | POST | 合并重复页面 |

**路由注册**：`backend/app/api/router.py` 注册 wiki 路由

**初始化**：`backend/app/main.py` 中 wiki 初始化

---

## 五、前端知识中心页面

### 5.1 路由

**新增文件**：

- `frontend/src/app/(main)/knowledge/page.tsx` — 路由页面
- `frontend/src/app/(main)/knowledge/content.tsx` — 主内容组件（1058 行）

### 5.2 功能描述

- 全局/项目 Wiki 切换
- 6 大分类导航
- 页面列表、详情查看、编辑
- Markdown 预览
- 合并保存 / 覆盖保存双模式
- 搜索功能
- 重复检测与合并

### 5.3 i18n

- `frontend/src/i18n/locales/{en,zh}/common.json`：47 条知识中心翻译/语言

### 5.4 侧边栏入口

`frontend/src/components/layout/sidebar-nav.tsx` 中 BookOpen 图标导航到 `/knowledge`

---

## 六、涉及文件清单

| 文件路径 | 变更类型 | 说明 |
|---------|---------|------|
| `backend/app/wiki/__init__.py` | 新增 | 模块初始化 |
| `backend/app/wiki/service.py` | 新增 | WikiService（878 行） |
| `backend/app/wiki/tool.py` | 新增 | WikiTool（520 行，8 个 actions） |
| `backend/app/wiki/resolver.py` | 新增 | 页面路径解析 |
| `backend/app/wiki/search.py` | 新增 | 搜索引擎 |
| `backend/app/wiki/cleanup.py` | 新增 | 清理模块 |
| `backend/app/wiki/filename.py` | 新增 | 文件名转换 |
| `backend/app/api/wiki.py` | 新增 | REST API（14 个端点） |
| `backend/app/api/router.py` | 修改 | 注册 wiki 路由 |
| `backend/app/main.py` | 修改 | wiki 初始化 |
| `backend/app/session/prompt.py` | 修改 | Wiki 工具注入 |
| `backend/app/session/system_prompt.py` | 修改 | wiki_root 说明 |
| `frontend/src/app/(main)/knowledge/page.tsx` | 新增 | 路由页面 |
| `frontend/src/app/(main)/knowledge/content.tsx` | 新增 | 主内容组件（1058 行） |
| `frontend/src/components/layout/sidebar-nav.tsx` | 修改 | 知识中心入口 |
| `frontend/src/i18n/locales/{en,zh}/common.json` | 修改 | 47 条翻译/语言 |
| `.wiki/` | 新增 | Wiki 初始文件（6 大分类） |

---

## 七、重新实现检查清单

- [ ] Wiki 模块完整结构（service/tool/resolver/search/cleanup/filename）
- [ ] WikiService 全文操作（read/write/merge/delete/search/list/status/duplicates/deduplicate/ingest）
- [ ] WikiTool AI 内置工具注册（8 个 actions: read/write/merge/search/list/delete/status/ingest）
- [ ] 写入保护机制（force=false 默认返回现有内容）
- [ ] Wiki 根路径解析（项目级 `.wiki/` → 全局 `~/.xflow/wiki/`）
- [ ] 6 大分类体系（entities/concepts/sources/synthesis/comparison/queries）
- [ ] 文件名安全转换
- [ ] System prompt 注入 wiki_root 说明
- [ ] Wiki REST API（14 个端点）
- [ ] 前端知识中心页面（全局/项目 Wiki 切换 + 分类导航 + CRUD + 搜索 + Markdown 预览）
- [ ] 合并保存 / 覆盖保存双模式
- [ ] i18n 47 条知识中心翻译/语言
- [ ] 侧边栏知识中心入口（BookOpen 图标）
