# Wiki Knowledge Center Phase 3 — 基础设施增强

> **Goal:** 持久化摄入队列、级联删除、页面合并引擎增强、Review Sweep 自动清理
>
> **依赖:** Phase 1 已完成；Phase 2 Review Items 数据结构

**Architecture:** 摄入队列使用 JSON 文件持久化（项目隔离），级联删除扩展现有 delete_page，合并引擎增加 frontmatter 数组字段 union。

---

## Task 1: 持久化摄入队列

**Files:**
- Create: `backend/app/wiki/ingest_queue.py`
- Modify: `backend/app/wiki/service.py`
- Modify: `backend/app/api/wiki.py`
- Modify: `backend/app/wiki/tool.py`

**实现内容:**
1. `ingest_queue.py`: IngestJob + IngestQueue 类
   - JSON 文件持久化 `{wiki_root}/.queue.json`，项目隔离
   - enqueue / dequeue / mark_done / mark_failed / list_pending / retry_failed
   - 失败自动重试（最多 3 次）
2. `service.py`: `enqueue_ingest()` + `process_ingest_queue()`
3. `api/wiki.py`: `POST /wiki/ingest-queue` + `GET /wiki/ingest-queue` + `POST /wiki/ingest-queue/{job_id}/retry`
4. `tool.py`: `ingest-queue` action

---

## Task 2: 摄入队列前端面板

**Files:**
- Create: `frontend/src/app/(main)/knowledge/wiki-queue-panel.tsx`
- Modify: `frontend/src/app/(main)/knowledge/wiki-sidebar.tsx`

**实现内容:**
1. 队列面板: 任务列表 + 状态 badge + 重试按钮
2. 侧栏添加队列入口（badge 显示 pending/failed 数）

---

## Task 3: 源文件级联删除 + Wiki 页面级联删除增强

**Files:**
- Create: `backend/app/wiki/cascade.py`
- Modify: `backend/app/wiki/service.py`

**实现内容:**
1. `cascade.py`: `find_cascade_targets()` + `cascade_delete()`
   - 清理其他页面中的 [[wikilinks]] 引用
   - 清理 index.md 索引条目
   - source 页面删除时检查关联 entity/concept 页面
2. `service.py`: `delete_page()` 添加 `cascade=True` 参数，返回级联影响报告

---

## Task 4: 页面合并引擎增强 — 数组字段 union

**Files:**
- Modify: `backend/app/wiki/cleanup.py`
- Modify: `backend/app/wiki/service.py`

**实现内容:**
1. `cleanup.py`: `merge_frontmatter()` 三层合并
   - Layer 1: tags/sources/related 取并集
   - Layer 2: created 保留旧值，updated 取最新
   - Layer 3: title/category 不覆盖
2. `service.py`: `merge_page()` 调用 `merge_frontmatter()`

---

## Task 5: Review Sweep 自动清理

**Files:**
- Create: `backend/app/wiki/review_sweep.py`
- Modify: `backend/app/wiki/service.py`
- Modify: `backend/app/api/wiki.py`

**实现内容:**
1. `review_sweep.py`: 两阶段清理
   - Phase 1 规则清理: 移除 broken wikilinks、空 frontmatter 字段、重复字段、格式问题
   - Phase 2 LLM 语义清理（可选）: 标记 stale、矛盾、重复
2. `service.py`: `run_review_sweep()` 方法
3. `api/wiki.py`: `POST /wiki/review-sweep` + `GET /wiki/review-sweep`
