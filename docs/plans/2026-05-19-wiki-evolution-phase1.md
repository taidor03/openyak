# Wiki Knowledge Center Phase 1 — Evolution Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 基于 llm_wiki 吸收分析报告，实施知识中心 Phase 1 全部功能：搜索增强、Mermaid/LaTeX 渲染、Frontmatter 编辑、知识图谱可视化、前端组件拆分、双层 Lint、内容清洗。

**Architecture:** 后端 Python (FastAPI) 提供所有数据 API；前端 React/Next.js 渲染。知识图谱后端负责图构建（遍历 wiki 文件 + wikilink 解析），前端使用 @react-sigma/core 渲染力导向图。Lint 分两层：结构化 Lint 纯代码检测，语义 Lint 调用 LLM。

**Tech Stack:** Python/FastAPI (后端), React/Next.js + @react-sigma/core + graphology + rehype-katex + remark-math + mermaid (前端)

---

## Task 1: 搜索缓存 + Snippet 增强

**Files:**
- Modify: `backend/app/wiki/search.py`
- Modify: `backend/app/wiki/service.py`

**实现内容:**
1. 给 `search_wiki()` 添加 LRU 内存缓存 (key=wiki_root+query, TTL=5min)
2. 增强 `_build_snippet()` 高亮匹配关键词
3. SearchResult 添加 `highlighted_snippet` 字段

---

## Task 2: Mermaid / LaTeX 渲染

**Files:**
- Modify: `frontend/src/app/(main)/knowledge/content.tsx` (WikiMarkdown 组件)
- Install: `remark-math`, `rehype-katex`, `katex`

**实现内容:**
1. WikiMarkdown 添加 remark-math + rehype-katex 插件支持 LaTeX
2. WikiMarkdown 添加 mermaid 代码块渲染组件
3. 在 layout 或 page 中引入 KaTeX CSS

---

## Task 3: Frontmatter 编辑面板

**Files:**
- Modify: `frontend/src/app/(main)/knowledge/content.tsx`

**实现内容:**
1. 在页面查看模式下，展示 frontmatter 元数据（title, category, tags, sources, related, type, summary）
2. 在编辑模式下，添加可折叠的 YAML frontmatter 编辑区域
3. 支持编辑 tags（逗号分隔）、related、sources 等数组字段

---

## Task 4: 知识图谱后端 API

**Files:**
- Create: `backend/app/wiki/graph.py`
- Modify: `backend/app/wiki/service.py`
- Modify: `backend/app/api/wiki.py`

**实现内容:**
1. `graph.py`: 图构建算法 (遍历 .md 文件 → nodes + edges)
   - 节点: page_id, title, category, type, linkCount
   - 边: source → target (wikilink), source → tag
   - 社区检测 (简单连通分量算法)
2. `service.py`: 添加 `get_graph()` 静态方法
3. `api/wiki.py`: 添加 `GET /wiki/graph` 端点
4. 图洞察: SurprisingConnections + KnowledgeGaps

---

## Task 5: 知识图谱前端 GraphView

**Files:**
- Create: `frontend/src/app/(main)/knowledge/graph-view.tsx`
- Modify: `frontend/src/app/(main)/knowledge/content.tsx`
- Modify: `frontend/src/app/(main)/knowledge/page.tsx`
- Install: `@react-sigma/core`, `graphology`, `sigma`

**实现内容:**
1. GraphView 组件: 使用 @react-sigma/core 渲染力导向图
2. 页面类型颜色映射
3. 节点点击跳转到对应 wiki 页面
4. 图谱/列表视图切换按钮

---

## Task 6: content.tsx 组件拆分

**Files:**
- Create: `frontend/src/app/(main)/knowledge/wiki-sidebar.tsx`
- Create: `frontend/src/app/(main)/knowledge/wiki-editor.tsx`
- Create: `frontend/src/app/(main)/knowledge/wiki-page-view.tsx`
- Create: `frontend/src/app/(main)/knowledge/wiki-markdown.tsx`
- Modify: `frontend/src/app/(main)/knowledge/content.tsx`

**实现内容:**
1. 抽取 WikiSidebar 组件 (侧栏: 搜索 + 分类 + 页面列表)
2. 抽取 WikiEditor 组件 (编辑器: 标题 + 分类 + textarea + 预览)
3. 抽取 WikiPageView 组件 (页面查看: 标题 + 元数据 + Markdown 渲染)
4. 抽取 WikiMarkdown 为独立组件
5. content.tsx 变为薄壳组合层

---

## Task 7: 双层 Lint 系统

**Files:**
- Modify: `backend/app/wiki/service.py` (lint_wiki 方法)
- Modify: `backend/app/api/wiki.py` (添加 lint 语义端点)
- Modify: `backend/app/wiki/tool.py` (lint action)
- Create: `backend/app/wiki/lint.py`

**实现内容:**
1. 结构化 Lint (纯代码):
   - 孤立页面 (orphan)
   - 断链 (broken-link)
   - 无出链 (no-outlinks)
2. 语义 Lint (LLM 驱动):
   - 矛盾 (contradiction)
   - 过时 (stale)
   - 缺失页面 (missing-page)
   - 建议 (suggestion)
3. API: `GET /wiki/lint?scope=structural|semantic|full`

---

## Task 8: 内容清洗

**Files:**
- Create: `backend/app/wiki/sanitize.py`
- Modify: `backend/app/wiki/service.py` (write_page 调用清洗)

**实现内容:**
1. 三步清洗:
   - 移除整页代码围栏 (```yaml ... ```)
   - 移除 frontmatter 前缀 `frontmatter:` 键
   - 修复 `related: [[a]], [[b]]` 为 `related: ["[[a]]", "[[b]]"]`
2. 在 write_page 写入前自动调用

---
