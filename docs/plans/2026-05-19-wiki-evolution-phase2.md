# Wiki Knowledge Center Phase 2 — 前端拖拽 Ingest + Review 审批 UI

> **Goal:** 实现用户直接拖拽文件到知识中心触发摄入，以及 Lint 结果生成 Review Items 的前端审批界面。
>
> **依赖:** Phase 1 已完成（双层 Lint、内容清洗、搜索增强、组件拆分）

**Architecture:** 前端通过 HTML5 Drag & Drop API 接收文件，读取内容后调用 `/api/wiki/ingest` 触发摄入。Review 审批 UI 读取 lint 结果，展示待审项目列表，用户可选择"创建页面"/"跳过"等操作。

**Tech Stack:** React DnD + FastAPI + 现有 WikiService

---

## Task 1: 前端拖拽 Ingest — 后端支持

**Files:**
- Modify: `backend/app/api/wiki.py`
- Modify: `backend/app/wiki/service.py`

**实现内容:**
1. `api/wiki.py`: 新增 `POST /wiki/ingest-file` 端点，接受 `UploadFile` 文件上传
2. `service.py`: 新增 `ingest_file()` 方法，读取上传文件内容，自动检测文件类型（.md / .txt / .pdf），调用 `ingest_source()`
3. 支持多种文件格式：.md（直接读取）、.txt（直接读取）、.pdf（提取文本，若无可选依赖则返回错误提示）

---

## Task 2: 前端拖拽 Ingest — 拖拽区域 + 文件处理

**Files:**
- Create: `frontend/src/app/(main)/knowledge/wiki-dnd-ingest.tsx`
- Modify: `frontend/src/app/(main)/knowledge/content.tsx`
- Modify: `frontend/src/app/(main)/knowledge/wiki-sidebar.tsx`

**实现内容:**
1. `wiki-dnd-ingest.tsx`: 创建 `DndIngestOverlay` 组件
   - 监听 dragenter/dragover/dragleave/drop 事件
   - 拖拽时显示半透明覆盖层 + "释放文件以摄入" 提示
   - drop 时读取文件内容（FileReader API），调用 ingest API
   - 支持多文件同时拖拽
   - 显示摄入进度和结果
2. `content.tsx`: 集成 DndIngestOverlay，包裹整个知识中心区域
3. `wiki-sidebar.tsx`: 在侧栏底部添加"拖拽文件到此处"的提示区域

---

## Task 3: Review 审批 UI — 后端 Review Items

**Files:**
- Create: `backend/app/wiki/review.py`
- Modify: `backend/app/wiki/service.py`
- Modify: `backend/app/api/wiki.py`
- Modify: `backend/app/wiki/tool.py`

**实现内容:**
1. `review.py`: Review Items 生成逻辑
   - `generate_review_items()`: 将 lint 结果转化为可操作的 Review Items
   - 每个 Review Item 包含: type, severity, title, description, affected_pages, suggested_actions
   - 对于 broken-link: 建议创建缺失页面
   - 对于 orphan: 建议添加 wikilinks
   - 对于 stale: 建议更新内容
   - 对于 semantic issues (contradiction 等): 建议人工审阅
2. `service.py`: 新增 `get_review_items()` 方法
3. `api/wiki.py`: 新增 `GET /wiki/review` 端点
4. `tool.py`: 新增 `review` action

---

## Task 4: Review 审批 UI — 前端审批界面

**Files:**
- Create: `frontend/src/app/(main)/knowledge/wiki-review-panel.tsx`
- Modify: `frontend/src/app/(main)/knowledge/wiki-sidebar.tsx`
- Modify: `frontend/src/app/(main)/knowledge/content.tsx`

**实现内容:**
1. `wiki-review-panel.tsx`: 创建 Review 审批面板组件
   - 左侧显示 Review Items 列表（按 severity 排序：warning > info）
   - 每项显示: 图标 + 类型 + 标题 + 受影响页面数量
   - 点击展开详情: 描述 + 受影响页面列表 + 建议操作按钮
   - 操作按钮: "创建缺失页面" / "添加链接" / "标记已处理" / "跳过"
   - 顶部统计: 总 issues / warnings / 已处理
2. `wiki-sidebar.tsx`: 添加 Review 入口按钮（带 badge 显示未处理数）
3. `content.tsx`: 集成 Review 面板，替换右侧面板内容

---

## Task 5: i18n 国际化 — Phase 2 新增文案

**Files:**
- Modify: `frontend/src/i18n/locales/zh/common.json`
- Modify: `frontend/src/i18n/locales/en/common.json`

**实现内容:**
1. 添加拖拽 Ingest 相关文案: dropToIngest, ingesting, ingestSuccess, ingestFailed, unsupportedFileType
2. 添加 Review 相关文案: reviewItems, reviewPanel, markResolved, skipItem, createMissingPage, addLinks
3. 添加文件上传相关文案: uploadFile, selectFile, fileTooLarge
