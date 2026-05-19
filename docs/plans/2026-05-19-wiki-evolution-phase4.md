# Wiki Knowledge Center Phase 4 — 高级特性

> **Goal:** 向量语义搜索、自动 Ingest 监控、矛盾检测、自动保存、内容去重
>
> **依赖:** Phase 1-3 完成（搜索增强、摄入队列、Lint 系统）
>
> **注意:** 向量搜索需要 embedding 服务（可用本地 ollama 或 OpenAI API），矛盾检测需要 LLM 支持

**Architecture:** 向量搜索使用本地 embedding 模型，存储为 JSON 文件。自动 Ingest 使用文件系统监控。矛盾检测复用语义 Lint。自动保存在前端定时器。去重使用内容哈希 + LLM 语义比对。

---

## Task 1: 向量搜索 — Embedding 生成 + 存储

**Files:**
- Create: `backend/app/wiki/embedding.py`
- Create: `backend/app/wiki/vector_store.py`
- Modify: `backend/app/wiki/service.py`
- Modify: `backend/app/wiki/search.py`

**实现内容:**
1. `embedding.py`: 调用 ollama/OpenAI API 生成向量，自动检测可用后端，不可用时优雅降级
2. `vector_store.py`: JSON 文件向量存储 + 余弦相似度检索 + 索引重建
3. `service.py`: `rebuild_vector_index()` + `semantic_search()` 方法
4. `search.py`: `search_with_rrf()` RRF 融合 token + 向量搜索

---

## Task 2: 向量搜索 — API + 前端

**Files:**
- Modify: `backend/app/api/wiki.py`
- Modify: `frontend/src/app/(main)/knowledge/wiki-sidebar.tsx`

**实现内容:**
1. `POST /wiki/rebuild-vectors` + `POST /wiki/search` 支持 `mode=semantic|hybrid`
2. 搜索栏添加模式切换（关键词/语义/混合）

---

## Task 3: 自动 Ingest — 目录监控

**Files:**
- Create: `backend/app/wiki/watcher.py`
- Modify: `backend/app/wiki/service.py`
- Modify: `backend/app/api/wiki.py`

**实现内容:**
1. `watcher.py`: watchfiles 监控 workspace，新文件入队，修改标记 stale，删除触发级联清理
2. `service.py`: `start_watcher()` / `stop_watcher()` / `get_watcher_status()`
3. `POST /wiki/watcher/start` + `POST /wiki/watcher/stop` + `GET /wiki/watcher/status`

---

## Task 4: 矛盾检测

**Files:**
- Modify: `backend/app/wiki/lint.py`
- Create: `backend/app/wiki/contradiction.py`

**实现内容:**
1. `contradiction.py`: 只对比有共同关键词/标签的页面对，使用 LLM 判断矛盾，返回矛盾描述+相关段落
2. `lint.py`: 集成到语义 Lint contradiction 检查

---

## Task 5: 自动保存

**Files:**
- Modify: `frontend/src/app/(main)/knowledge/wiki-editor.tsx`

**实现内容:**
1. 每 30s 自动保存草稿到 localStorage，编辑器打开时检查恢复
2. `useAutoSave` hook: debounce 5s，状态指示器（已保存/保存中/未保存）

---

## Task 6: 内容去重

**Files:**
- Create: `backend/app/wiki/dedup.py`
- Modify: `backend/app/wiki/service.py`
- Modify: `backend/app/api/wiki.py`
- Modify: `frontend/src/app/(main)/knowledge/wiki-review-panel.tsx`

**实现内容:**
1. `dedup.py`: 内容哈希 + trigram 相似度 + 向量相似度三层去重检测
2. 增强 `GET /wiki/duplicates` + `POST /wiki/deduplicate`
3. Review 面板展示重复检测结果
