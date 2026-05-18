# 06 - 知识中心 Wiki 服务

> **定制编号**: 2f64ef0, 2f95df7, 70362fc  
> **涉及提交**: `2f64ef0`, `2f95df7`, `70362fc`, `38edce7`(部分)  
> **涉及范围**: 后端 Wiki 服务 + 前端知识中心页面 + AI Wiki 工具 + 消息轮询重构

---

## 一、功能概述

知识中心（Knowledge Hub）是 Xflow Desktop 的核心定制功能之一，提供：

1. **Wiki 后端服务**：完整的 Wiki 页面 CRUD、搜索、合并、清理
2. **AI Wiki 工具**：AI 助手可在对话中直接操作 Wiki 知识
3. **前端知识中心页面**：可视化 Wiki 管理 UI
4. **消息轮询策略重构**：配合知识中心的实时性需求

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
    async def merge_page(self, page_id: str, content: str) -> dict

    # 删除页面
    async def delete_page(self, page_id: str) -> bool

    # 搜索页面
    async def search(self, query: str, category: str | None = None) -> list[dict]

    # 列出页面
    async def list_pages(self, category: str | None = None) -> list[dict]

    # 获取 Wiki 状态
    async def get_status(self) -> dict
```

### 2.3 Wiki 根路径解析

Wiki 根目录的解析优先级：

1. **项目级 Wiki**：`<workspace>/.wiki/`
2. **全局 Wiki**：`~/.xflow/wiki/`

### 2.4 Wiki 分类体系

```python
_WIKI_CATEGORIES = [
    "entities",    # 实体分类
    "concepts",    # 概念定义
    "sources",     # 来源参考
    "synthesis",   # 综合总结
    "comparison",  # 对比分析
    "queries",     # 常用查询
]
```

每个分类对应 Wiki 根目录下的子目录。

### 2.5 页面格式

Wiki 页面使用 Markdown 格式，含 YAML frontmatter：

```markdown
---
title: 页面标题
category: entities
created: 2026-05-17T12:00:00
updated: 2026-05-17T12:00:00
---

页面内容...
```

### 2.6 文件名安全转换（filename.py）

```python
def query_to_filename(query: str) -> str:
    """将查询字符串转换为安全的文件名"""
    # 移除/替换不安全字符
    # 限制长度
    # 添加时间戳避免冲突
```

### 2.7 搜索引擎（search.py）

Lexical search 实现：

- **标题匹配**：精确 + 模糊匹配，权重更高
- **内容片段**：正文中关键词匹配，返回上下文片段
- **分类过滤**：可选按 category 过滤

### 2.8 清理模块（cleanup.py）

- **section merge**：合并同一页面的多个编辑 section
- **frontmatter 解析**：读取/写入 YAML 头部
- **deleted keys 清理**：移除 frontmatter 中标记为 deleted 的字段

### 2.9 Wikilink 解析（resolver.py）

```python
def resolve_page_path(wiki_root: Path, page_id: str) -> Path | None:
    """解析 wikilink 到文件路径"""

def unwrap_wikilink(text: str) -> str:
    """去除 [[wikilink]] 包装"""
```

---

## 三、WikiTool — AI 内置工具

### 3.1 工具注册

**文件**：`backend/app/wiki/tool.py`

```python
class WikiTool:
    """
    暴露 read, write, merge, search, list, delete, status 等操作
    通过单个 `wiki` 工具注册到 ToolRegistry
    """
```

### 3.2 工具 Actions

| Action | 说明 | 参数 |
|--------|------|------|
| status | 获取 Wiki 状态（页数、分类、初始化状态） | — |
| search | 按关键词搜索 Wiki 页面 | `query`, `category?` |
| list | 列出 Wiki 页面 | `category?` |
| read | 读取指定页面 | `page_id` |
| write | 创建或覆盖页面 | `title`, `content`, `category?`, `force?` |
| merge | 合并保存页面 | `page_id`, `content` |
| delete | 删除页面 | `page_id` |

### 3.3 写入保护机制

- **force=false（默认）**：如果页面已存在，返回现有内容，让 AI 决定如何处理
- **force=true**：直接覆盖

### 3.4 System Prompt 集成

**`backend/app/session/system_prompt.py`**：

```python
# 注入 wiki_root 说明到 system prompt
wiki_section = f"""
You have access to a Wiki Knowledge Center at {wiki_root}.
Use the `wiki` tool to store, retrieve, and search knowledge.
Always search before writing to avoid duplicates.
"""
```

**`backend/app/session/prompt.py`**：

Wiki 工具描述随 system prompt 一起发送给 AI。

---

## 四、Wiki REST API

### 4.1 API 路由

**新增文件**：`backend/app/api/wiki.py`

```
GET  /api/wiki/config      # 获取 Wiki 配置（wiki_root 等）
PUT  /api/wiki/config      # 更新 Wiki 配置
GET  /api/wiki/status      # 获取 Wiki 状态
GET  /api/wiki/resolve     # 解析页面路径
```

### 4.2 路由注册

**`backend/app/api/router.py`**：新增 wiki 路由

**`backend/app/main.py`**：wiki 模块初始化

---

## 五、前端知识中心页面

### 5.1 路由

**新增文件**：`frontend/src/app/(main)/knowledge/page.tsx`

**新增文件**：`frontend/src/app/(main)/knowledge/content.tsx`（1058 行主内容组件）

### 5.2 功能

- **全局 Wiki / 项目 Wiki 切换**：Tab 切换不同 Wiki 根目录
- **分类侧边栏导航**：按 6 大分类浏览
- **Wiki 页面 CRUD**：新建、编辑、预览、删除
- **合并保存**：AI 修改与用户手动修改的智能合并
- **覆盖保存**：直接覆盖现有内容
- **搜索功能**：防抖 300ms，标题匹配高亮与内容片段
- **Markdown 预览**：react-markdown + remark-gfm
- **分类图标**：每个分类对应不同图标
- **i18n 支持**：中英文 47 条翻译/语言

### 5.3 i18n

**`frontend/src/i18n/locales/{en,zh}/common.json`**：

新增 47 条知识中心相关翻译键，涵盖：
- 分类名称（entities/concepts/sources/synthesis/comparison/queries）
- CRUD 操作文案（新建/编辑/删除/保存/合并保存/覆盖保存）
- 搜索相关文案
- 确认提示文案
- 状态提示文案

---

## 六、消息轮询策略重构（2f64ef0）

### 6.1 重构动机

原 `useMessages` 使用 `useInfiniteQuery` 内置 `refetch`，存在以下问题：
- 每次轮询重新获取所有页面，开销大
- 历史页数据不变也被刷新
- 翻页 offset 计算在 `-1 pageParams` 时漂移

### 6.2 新方案

**手动轮询 + 智能合并**：

```typescript
// useMessages 重构
export function useMessages(sessionId: string) {
  // 1. useInfiniteQuery 管理分页
  // 2. 手动 setInterval 轮询最新页（offset=-1）
  // 3. merge 进缓存，保留历史页
  // 4. fetchPreviousPage 改用 oldestOffset 追踪
}
```

### 6.3 SSE 配合

**`frontend/src/hooks/use-sse.ts`**：

- DONE 和消息事件均改用 `refreshLatestMessages` 替代 `invalidateQueries`
- 仅刷新最新页，不破坏历史页缓存

### 6.4 message-list 修复

**`frontend/src/components/messages/message-list.tsx`**：

修复 `hasActiveStream` 条件导致重复显示 streaming fallback 的问题。

---

## 七、Wiki 迁移（38edce7）

将「OpenYak MCP 自定义配置」从全局 Wiki 迁移到项目 Wiki，新建 `.wiki/entities/` 存放实体分类页面。

---

## 八、涉及文件清单

| 文件路径 | 变更类型 | 说明 |
|---------|---------|------|
| `backend/app/wiki/__init__.py` | 新增 | 模块初始化 |
| `backend/app/wiki/service.py` | 新增 | WikiService（878 行） |
| `backend/app/wiki/tool.py` | 新增 | WikiTool（520 行） |
| `backend/app/wiki/resolver.py` | 新增 | 页面路径解析 |
| `backend/app/wiki/search.py` | 新增 | 搜索引擎 |
| `backend/app/wiki/cleanup.py` | 新增 | 清理模块 |
| `backend/app/wiki/filename.py` | 新增 | 文件名转换 |
| `backend/app/api/wiki.py` | 新增 | REST API |
| `backend/app/api/router.py` | 修改 | 注册 wiki 路由 |
| `backend/app/main.py` | 修改 | wiki 初始化 |
| `backend/app/session/prompt.py` | 修改 | Wiki 工具注入 |
| `backend/app/session/system_prompt.py` | 修改 | wiki_root 说明 |
| `frontend/src/app/(main)/knowledge/page.tsx` | 新增 | 路由页面 |
| `frontend/src/app/(main)/knowledge/content.tsx` | 新增 | 主内容组件（1058 行） |
| `frontend/src/lib/message-cache.ts` | 新增 | 消息缓存层 |
| `frontend/src/hooks/use-messages.ts` | 修改 | 手动轮询 + 智能合并 |
| `frontend/src/hooks/use-sse.ts` | 修改 | refreshLatestMessages |
| `frontend/src/components/messages/message-list.tsx` | 修改 | hasActiveStream 修复 |
| `frontend/src/components/layout/sidebar-nav.tsx` | 修改 | 知识中心入口 |
| `frontend/src/i18n/locales/{en,zh}/common.json` | 修改 | 47 条翻译/语言 |
| `.wiki/` | 新增 | Wiki 初始文件 |

---

## 九、重新实现检查清单

- [ ] Wiki 模块完整结构（service/tool/resolver/search/cleanup/filename）
- [ ] WikiService 全文操作（read/write/merge/delete/search/list/status）
- [ ] WikiTool AI 内置工具注册（7 个 actions）
- [ ] 写入保护机制（force=false 默认返回现有内容）
- [ ] Wiki 根路径解析（项目级 `.wiki/` → 全局 `~/.xflow/wiki/`）
- [ ] 6 大分类体系（entities/concepts/sources/synthesis/comparison/queries）
- [ ] Markdown + YAML frontmatter 页面格式
- [ ] Lexical search（标题匹配 + 内容片段 + 分类过滤）
- [ ] Section merge + frontmatter 解析 + deleted keys 清理
- [ ] Wikilink 解析与去包装
- [ ] 文件名安全转换
- [ ] System prompt 注入 wiki_root 说明
- [ ] Wiki REST API（config/status/resolve）
- [ ] 前端知识中心页面（全局/项目 Wiki 切换 + 分类导航 + CRUD + 搜索 + Markdown 预览）
- [ ] 合并保存 / 覆盖保存双模式
- [ ] 消息轮询重构（手动轮询 + 智能合并 + oldestOffset）
- [ ] SSE `refreshLatestMessages` 替代 `invalidateQueries`
- [ ] i18n 47 条知识中心翻译/语言
- [ ] 侧边栏知识中心入口（BookOpen 图标）
