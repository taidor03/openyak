# Wiki Knowledge Center 实现计划

> **状态：✅ 已全部完成**

**Goal:** 为 xflow-desktop (OpenYak) 添加原生的 Wiki 知识中心模块，使 LLM 可以读写、搜索、合并、摄入、巡检项目级和用户级 Wiki，并在 System Prompt 中注入当前 Wiki 路径。

**Architecture:** 在后端 `backend/app/wiki/` 中用 Python 原生实现 Wiki 核心逻辑（从 `nashsu/llm_wiki` 的 TypeScript 源码选择性移植），通过 `WikiTool`（ToolDefinition 子类）注册到现有 ToolRegistry，无需外部 MCP 进程。System Prompt 通过扩展 `_environment_section` 注入 Wiki 路径信息。前端提供知识中心面板 UI。

**Tech Stack:** Python 3.11+, FastAPI, Pydantic v2, Next.js 15, Tailwind, shadcn/ui

---

## 目录结构（实际实现）

```
backend/app/wiki/
├── __init__.py            # 模块入口
├── filename.py            # Slug/文件名生成（移植自 wiki-filename.ts）
├── cleanup.py             # Wikilink 清理 + Section 合并算法
├── resolver.py            # Wikilink 解析 + 路径解析（移植自 wiki-page-resolver.ts）
├── search.py              # Token 搜索 + RRF 排序（移植自 search.ts，去掉向量搜索）
├── service.py             # WikiService — 高层 API（CRUD + 搜索 + 合并 + 摄入 + 巡检 + 日志）
└── tool.py                # WikiTool — ToolDefinition 子类（9 个 action）

backend/app/api/
└── wiki.py                # Wiki REST API 路由（12 个端点）

frontend/src/
├── app/(main)/knowledge/
│   ├── page.tsx           # 知识中心页面（路由入口）
│   └── content.tsx        # 知识中心内容组件（侧边栏 + 一体式编辑器/预览）
└── i18n/locales/
    ├── zh/common.json     # 中文 i18n（含 merge/save 等）
    └── en/common.json     # 英文 i18n
```

> **注意**：原计划中 `frontend/src/components/knowledge/` 下的三个组件（wiki-browser、wiki-page-view、wiki-search）实际未拆分，所有逻辑集中在 `content.tsx` 中。这在当前页面复杂度下是合理的，未来如果组件膨胀可以再拆分。

---

## Task 1: Wiki 核心算法 — filename.py ✅

**Files:**
- Create: `backend/app/wiki/__init__.py`
- Create: `backend/app/wiki/filename.py`

**实现要点:**

移植 `wiki-filename.ts` 的 slug 生成和文件名生成逻辑：

1. `make_query_slug(title)` — Unicode-aware slug：NFKC 标准化，保留 Unicode 字母/数字/ASCII连字符，空白→连字符，截断50字符，fallback "query"
2. `make_query_filename(title)` — 生成完整文件名 `{slug}-{YYYY-MM-DD}-{HHMMSS}.md`，返回 `FilenameInfo` namedtuple

**Python 实现关键点:**
- 使用 `unicodedata.normalize("NFKC", ...)` 替代 TS 的 `.normalize("NFKC")`
- 使用 `re.sub(r"[^\w-]", "", slug, flags=re.UNICODE)` — Python 的 `\w` 在 UNICODE 模式下匹配 Unicode 字母和数字
- 注意：Python 的 `\w` 包含下划线，但 TS 版不保留下划线，需额外 strip

---

## Task 2: Wiki 核心算法 — cleanup.py ✅

**Files:**
- Create: `backend/app/wiki/cleanup.py`

**实现要点:**

移植 `wiki-cleanup.ts` 的 wikilink 清理逻辑，后扩展了 section 合并算法：

1. `normalize_wiki_ref_key(s)` — 标准化 wiki 引用键（去路径前缀、去 .md、小写、去空格/连字符/下划线）
2. `build_deleted_keys(infos)` — 构建已删除页面的标准化键集合
3. `extract_frontmatter_title(content)` — 从 YAML frontmatter 提取 title
4. `clean_index_listing(text, deleted_keys)` — 清理 index.md 中的已删除条目
5. `strip_deleted_wikilinks(text, deleted_keys)` — 替换指向已删除页面的 wikilink 为纯文本
6. **`parse_sections(body)`** — 将 Markdown 正文按 `##`~`######` 标题解析为 `(heading, content, level)` 元组列表，preamble（第一个 `##` 前的内容）heading 为 `None`、level 为 `0`。level 记录标题层级（2-6），供 `merge_sections` 使用。
7. **`merge_sections(existing_body, new_sections_text)`** — Section 级合并算法：
   - 匹配的 heading → 替换（保留原始位置 + 保留原始标题层级）
   - 新 heading → 追加到末尾（使用自身标题层级）
   - Preamble 始终从已有页面保留
   - 使用 `normalize_wiki_ref_key` 做大小写和空格无关的标题匹配

---

## Task 3: Wiki 核心算法 — resolver.py ✅

**Files:**
- Create: `backend/app/wiki/resolver.py`

**实现要点:**

移植 `wiki-page-resolver.ts` 的解析逻辑（简化版，不依赖 FileNode 树）：

1. `unwrap_wikilink(s)` — 解析 `[[target|alias]]` 格式
2. `resolve_wiki_page(wiki_root, slug)` — 在 wiki 目录下查找匹配的 .md 文件
3. `resolve_related_slug(wiki_root, ref)` — 解析 related 引用到实际文件路径

**简化策略:** TS 版依赖 `FileNode` 树做目录遍历，Python 版直接用 `pathlib.Path` 做 glob/遍历，更轻量。

---

## Task 4: Wiki 核心算法 — search.py ✅

**Files:**
- Create: `backend/app/wiki/search.py`

**实现要点:**

移植 `search.ts` 的 token 搜索逻辑（不含向量搜索和 Tauri IPC）：

1. `tokenize_query(query)` — 分词（含 CJK bigram 支持）
2. `search_wiki(wiki_root, query, max_results=20)` — 全文搜索 wiki 目录
3. `SearchResult` dataclass — 搜索结果结构（含 `page_id`, `title`, `category`, `snippet`, `title_match`, `score`）
4. 评分系统：filename exact (200) + phrase in title (50) + phrase in content (20/occ) + title token (5) + content token (1)
5. Snippet 生成
6. **不含** RRF 融合和向量搜索（第一版不需要）

---

## Task 5: WikiService 高层 API ✅

**Files:**
- Create: `backend/app/wiki/service.py`

**实际实现的完整方法清单:**

```python
class WikiService:
    # ── 路径解析 ──
    @staticmethod
    def resolve_wiki_root(workspace: str | None) -> str | None

    # ── 初始化 ──
    @staticmethod
    async def initialize(wiki_root: str) -> dict[str, Any]

    # ── 读取 ──
    @staticmethod
    async def read_page(wiki_root: str, page_id: str) -> dict[str, Any] | None

    @staticmethod
    async def find_page_by_title(wiki_root: str, title: str, category: str) -> dict[str, Any] | None

    # ── 写入（先读后写模式）──
    @staticmethod
    async def write_page(wiki_root: str, title: str, content: str, category: str = "entities", *, force: bool = False) -> dict[str, Any]

    # ── 合并 ──
    @staticmethod
    async def merge_page(wiki_root: str, title: str, new_sections: str, category: str = "entities") -> dict[str, Any]

    # ── 删除 ──
    @staticmethod
    async def delete_page(wiki_root: str, page_id: str) -> bool

    # ── 列表 ──
    @staticmethod
    async def list_pages(wiki_root: str, category: str | None = None) -> list[dict[str, Any]]

    # ── 搜索 ──
    @staticmethod
    async def search(wiki_root: str, query: str, max_results: int = 20) -> list[SearchResult]

    # ── 状态 ──
    @staticmethod
    async def get_status(wiki_root: str) -> dict[str, Any]

    # ── 摄入 ──
    @staticmethod
    async def ingest_source(wiki_root: str, source_name: str, source_content: str, *, purpose: str = "general") -> dict[str, Any]

    # ── 巡检 ──
    @staticmethod
    async def lint_wiki(wiki_root: str, scope: str = "full") -> dict[str, Any]

    # ── 日志 ──
    @staticmethod
    async def append_log(wiki_root: str, action: str, title: str, category: str) -> None

    # ── 内部 ──
    @staticmethod
    def _find_duplicate_pages(wiki_root: str) -> list[dict[str, Any]]

    @staticmethod
    async def _update_index(wiki_root: str, title: str, slug: str, category: str) -> None
```

**write_page 先读后写模式说明:**

| force 参数 | 已有页面 | 行为 |
|------------|----------|------|
| `False`（默认） | 不存在 | 创建新页面 |
| `False`（默认） | 已存在 | 返回 `exists=True` + 已有内容预览，不写入 |
| `True` | 不存在 | 创建新页面 |
| `write_page(force=True)` | 已存在 | 覆盖更新（保留原始 `created` 时间戳 + 保留原始 `related`/`sources` 元数据） |

---

## Task 6: WikiTool — 注册到 ToolRegistry ✅

**Files:**
- Create: `backend/app/wiki/tool.py`
- Modify: `backend/app/main.py` — 在 `_register_builtin_tools` 中注册 WikiTool

**实际实现的 9 个 action:**

| Action | 参数 | 描述 |
|--------|------|------|
| `status` | — | Wiki 状态 |
| `search` | query, max_results | 搜索页面 |
| `list` | category | 列出页面 |
| `read` | page_id / title | 读取页面 |
| `write` | title, content, category, force | 写入页面（先读后写） |
| `merge` | title, content, category | Section 级合并 |
| `ingest` | source_name, source, purpose | 源文档摄入 |
| `lint` | — | 健康巡检 |
| `delete` | page_id | 删除页面 |

**关键:** `execute()` 通过 `ctx.workspace` 获取工作区路径，自动解析 `wiki_root`。

---

## Task 7: System Prompt 注入 Wiki 路径 ✅

**Files:**
- Modify: `backend/app/session/system_prompt.py` — `_environment_section` 新增 Wiki 路径段落
- Modify: `backend/app/session/prompt.py` — `_build_system_prompt_parts` 传入 wiki_root

**实际注入内容:**

```
# Wiki Knowledge Center
- Wiki root: {wiki_root} ({wiki_type})
- Use the `wiki` tool to read, write, merge, search, and manage knowledge pages
- Available categories: entities, concepts, sources, synthesis, comparison, queries
- **Write policy**:
  - ONLY write when the user explicitly asks, or when you discover genuinely novel, useful knowledge not already stored
  - NEVER auto-write conversation summaries — the wiki is a curated knowledge base, not a log
  - ALWAYS search before writing to avoid duplicates
  - If a page already exists, the write action returns the existing content — you must then either:
    1. Use the **merge** action (RECOMMENDED) to update specific sections while preserving the rest, OR
    2. Prepare a fully merged version and call write again with force=true
  - Do NOT overwrite existing pages with force=true without incorporating existing knowledge
- **Merge action**: the preferred way to update pages — sections with matching headings are replaced, new headings are appended, all existing knowledge is preserved
```

---

## Task 8: Wiki REST API ✅

**Files:**
- Create: `backend/app/api/wiki.py`
- Modify: `backend/app/api/router.py` — 注册 wiki 路由

**API 端点（12 个）:**

| 方法 | 路径 | 描述 |
|------|------|------|
| GET | /api/wiki/status | 获取 Wiki 状态 |
| POST | /api/wiki/initialize | 初始化 Wiki 目录 |
| GET | /api/wiki/pages | 列出页面 |
| GET | /api/wiki/pages/{page_id} | 读取页面 |
| POST | /api/wiki/pages | 写入页面（`force` 参数） |
| POST | /api/wiki/merge | Section 级合并写入 |
| POST | /api/wiki/ingest | 源文档摄入 |
| GET | /api/wiki/lint | 健康巡检 |
| DELETE | /api/wiki/pages/{page_id} | 删除页面 |
| POST | /api/wiki/search | 搜索 Wiki |
| GET | /api/wiki/duplicates | 查找重复页面 |
| POST | /api/wiki/deduplicate | 自动去重 |

**所有端点接收 `workspace` 查询参数**以决定 wiki_root。

**请求模型:**

| 模型 | 字段 |
|------|------|
| `WikiWriteRequest` | title, content, category, force |
| `WikiSearchRequest` | query, max_results |
| `WikiMergeRequest` | title, content, category |
| `WikiIngestRequest` | source_name, source, purpose |

---

## Task 9: 前端知识中心 UI ✅

**Files:**
- Create: `frontend/src/app/(main)/knowledge/page.tsx`
- Create: `frontend/src/app/(main)/knowledge/content.tsx`
- Modify: `frontend/src/components/layout/sidebar-nav.tsx` — 添加知识中心导航入口
- Modify: `frontend/src/i18n/locales/zh/common.json` — 中文翻译
- Modify: `frontend/src/i18n/locales/en/common.json` — 英文翻译

**UI 设计（实际实现）:**

- **左侧边栏**：
  - Wiki 目标选择器（默认全局知识库，下拉可切换项目 Wiki）
  - 搜索栏（300ms 防抖）
  - 分类列表 + 页面列表 / 搜索结果
  - 新建页面按钮

- **右侧面板**（一体式）：
  - 查看模式：Markdown 渲染 + 编辑/删除按钮
  - 编辑模式：右上角 Edit/Preview 切换（segmented control），编辑已有页面时显示 "Merge & Save"（主按钮）+ "Overwrite"（次按钮），新建时显示 "Save"
  - 预览模式：自动去除 YAML frontmatter，显示纯净 Markdown 渲染
  - 新建页面默认分类为 "entities"（与后端一致）

---

## Wiki 目录结构约定

```
{wiki_root}/
├── index.md               # Wiki 索引
├── log.md                 # 变更日志（每次写入自动追加）
├── entities/              # 实体页面
│   └── {slug}-{date}-{time}.md
├── concepts/              # 概念页面
├── sources/               # 来源摘要页面（Ingest 创建）
├── synthesis/             # 综合页面
├── comparison/            # 对比页面
└── queries/               # 查询保存页面
```

每个 .md 文件格式：
```markdown
---
title: KV Cache
category: concepts
created: 2026-05-17T14:30:52Z
updated: 2026-05-17T14:30:52Z
related: []
sources: []
---

## Overview
Content here...

## Key Details
More content...
```

> **注意**: body 中不使用 `#` (h1) 标题，因为标题已在 frontmatter 中声明。使用 `##`~`######` 作为正文结构。这样 `merge_sections` 才能正确按标题合并。

---

## Wiki Root 解析规则

| 场景 | workspace | wiki_root |
|------|-----------|-----------|
| 项目对话 | `/path/to/project` | `/path/to/project/.wiki` |
| 全局对话 | `None` / `"."` | `~/.xflow/wiki` |
