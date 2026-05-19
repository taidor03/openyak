# llm_wiki → xflow-desktop 知识中心吸收分析报告 v2（深度版）

> **分析版本**: 2026-05-19  
> **分析方式**: 逐文件读取 llm_wiki 完整源码（/tmp/llm_wiki/，约 130+ TypeScript 模块，17 Rust 后端模块）  
> **对比基线**: xflow-desktop 知识中心（backend/app/wiki/ 17 个 Python 模块，27 个 REST API 端点，13 个 MCP tool actions，前端 10 个组件文件）

---

## 一、全景对比图

### llm_wiki 完整架构

```
src/lib/                          # 核心逻辑层
├── search.ts                     # Rust 搜索的 JS 桥 (TS → Tauri IPC → Rust)
├── search-rrf.test.ts            # RRF 融合搜索测试
├── wiki-graph.ts                 # 知识图谱构建 (节点/边/社区)
├── graph-*.ts                    # 6 个子模块: insights / relevance / filters / visibility / search
├── frontmatter.ts                # YAML 解析 (含 LLM 容错修复)
├── wiki-filename.ts              # 文件名生成 (已移植到 xflow)
├── wiki-page-resolver.ts         # Wikilink 解析 (已移植到 xflow)
├── wiki-cleanup.ts               # 清理与索引维护 (已移植到 xflow)
├── wiki-page-delete.ts           # 页面删除 + 级联清理
├── wiki-type-style.ts            # 页面类型视觉风格定义
├── page-merge.ts                 # 按章节合并页面
├── lint.ts                       # Wiki 页面质量检查 (结构化 3 项 + 语义 4 项)
├── enrich-wikilinks.ts           # LLM 驱动的 wikilink 自动补全
├── ingest.ts                     # LLM 两步思维链摄入 (分析→生成)
├── ingest-queue.ts               # 异步处理队列
├── ingest-cache.ts               # 去重缓存
├── ingest-sanitize.ts            # 内容清洗
├── embedding.ts                  # 向量嵌入生成
├── image-caption-pipeline.ts     # 图片自动描述
├── text-chunker.ts               # 文本分块
├── auto-save.ts                  # 自动保存
├── dedup*.ts                     # 去重 (4 个模块)
├── deep-research.ts              # 深度研究功能
├── ...
│
src/components/
├── graph/graph-view.tsx          # 知识图谱可视化
├── editor/
│   ├── wiki-editor.tsx           # WYSIWYG 编辑器 (Milkdown)
│   ├── wiki-reader.tsx           # 只读页面展示
│   ├── frontmatter-panel.tsx     # 前端 YAML 元数据编辑器
│   └── file-preview.tsx          # 文件预览
├── search/search-view.tsx        # 搜索结果视图
├── lint/lint-view.tsx            # 质检结果展示
├── mermaid-diagram.tsx           # Mermaid 图表渲染
├── layout/knowledge-tree.tsx     # 知识树导航
└── review/review-view.tsx        # 评审视图

src-tauri/src/
├── commands/search.rs            # Rust 全文搜索 (高性能)
├── commands/vectorstore.rs       # LanceDB 向量存储
├── commands/fs.rs                # 文件系统操作
├── commands/extract_images.rs    # 图片提取
└── types/wiki.rs                 # Wiki 数据结构

src/lib/__tests__/                # 30+ 测试套件
```

### xflow-desktop 知识中心架构

```
backend/app/wiki/
├── service.py        # 核心业务 (CRUD + ingest + merge + graph + lint + review + queue + cascade + sweep + vector + contradiction + dedup + watcher)
├── search.py         # Token 搜索 + LRU 缓存 + snippet 高亮 (移植自 llm_wiki search.ts，增强版)
├── cleanup.py        # 索引清理/章节合并/frontmatter 合并 (移植自 llm_wiki wiki-cleanup.ts + page-merge.ts)
├── resolver.py       # Wikilink 解析 (移植自 llm_wiki wiki-page-resolver.ts)
├── filename.py       # 文件名生成 (移植自 llm_wiki wiki-filename.ts)
├── graph.py          # 知识图谱构建 (移植自 llm_wiki wiki-graph.ts + graph-insights.ts)
├── lint.py           # 双层 Lint: 结构化 3 项 + 语义 4 项 (移植自 llm_wiki lint.ts)
├── sanitize.py       # LLM 输出清洗 (移植自 llm_wiki ingest-sanitize.ts)
├── review.py         # Review Items 持久化存储 + Lint→Review 转换
├── ingest_queue.py   # 持久化摄入队列 (移植自 llm_wiki ingest-queue.ts)
├── cascade.py        # 级联删除 (移植自 llm_wiki wiki-page-delete.ts)
├── review_sweep.py   # Review Sweep 两阶段自动清理 (移植自 llm_wiki sweep-reviews.ts)
├── embedding.py      # 向量嵌入生成 (移植自 llm_wiki embedding.ts)
├── vector_store.py   # JSON 文件向量存储 + RRF 融合搜索 (移植自 llm_wiki vectorstore.rs)
├── contradiction.py  # 矛盾检测 (移植自 llm_wiki lint.ts contradiction 检测)
├── dedup.py          # 内容去重 (移植自 llm_wiki dedup*.ts, 精确+近似+语义三级, 语义级opt-in)
├── watcher.py        # 文件系统监控自动摄入 (移植自 llm_wiki source-lifecycle.ts)
├── tool.py           # MCP bridge (13 个 action)
└── __init__.py

backend/app/api/wiki.py  # 27 个 REST 端点

frontend/src/app/(main)/knowledge/
├── page.tsx                # 知识中心首页 (22 行)
├── content.tsx             # 薄壳组合层 (422 行, 已拆分)
├── wiki-types.ts           # 共享类型定义 + 常量 + helpers (143 行)
├── wiki-sidebar.tsx        # 侧栏 + 搜索模式切换 (444 行)
├── wiki-editor.tsx         # 编辑器 + Frontmatter 编辑 + 自动保存 (498 行)
├── wiki-page-view.tsx      # 页面查看 + Frontmatter 展示 (124 行)
├── wiki-markdown.tsx       # Markdown 渲染 + Mermaid + LaTeX (169 行)
├── graph-view.tsx          # 知识图谱可视化 (600 行, Canvas 力导向图)
├── wiki-dnd-ingest.tsx     # 拖拽摄入覆盖层 (218 行)
└── wiki-review-panel.tsx   # Review 审批面板 (210 行)
```

---

## 二、逐项深度对比

### 🔴 [P0] 知识图谱可视化 (✅ 已实现)

#### llm_wiki 实现 (8 个模块)

| 模块 | 文件 | 行数 | 功能 |
|---|---|---|---|
| 图构建 | `wiki-graph.ts` | ~260 | 扫描 wiki 文件 → nodes[] + edges[] + communities[] |
| 洞察分析 | `graph-insights.ts` | ~170 | 跨界连接、孤立节点、知识缺口、桥接节点 |
| 关联分析 | `graph-relevance.ts` | ~310 | 4 种关联信号加权计算 (sourceOverlap + directLink + commonNeighbor + typeAffinity) |
| 图过滤器 | `graph-filters.ts` | ~130 | 按类型/结构/孤立节点/连接数过滤 |
| 图搜索 | `graph-search.ts` | ~50 | 在图内搜索节点标签/ID/类型 |
| 可见性 | `graph-visibility.ts` | ~10 | 节点类型可见性控制 |
| 前端渲染 | `graph-view.tsx` | ~250 | @react-sigma/core 力导向图渲染 |
| 测试 | `graph-filters.test.ts`, `graph-visibility.test.ts`, `graph-search.test.ts` | 3 套 | 单元测试 |

#### 图构建算法 (`wiki-graph.ts`)

```
1. 遍历所有 .md 文件 → 提取 frontmatter 的 title/type
2. 扫描 [[wikilink]] → src → target / src → tag 两类边
3. 构建反向链接索引 (谁链接到谁)
4. Louvain 社区检测 → 同色聚类
5. 计算每个节点的 linkCount (出 + 入)
6. 计算社区 cohesion (内部边 / 总可能边)
```

#### 图洞察 (`graph-insights.ts`)

```
SurprisingConnections (令人惊讶的关联):
  - 跨社区连接 (+3) → "crosses community boundary"
  - 跨类型连接 (+2 或 +1) → "connects source to concept"
  - 外围到中心连接 (+2) → "peripheral node links to hub"
  - 弱连接存在 (+1) → "weak but present connection"

KnowledgeGaps (知识缺口):
  - isolated-node: 孤立节点 (度 ≤ 1)
  - sparse-community: 稀疏社区 (cohesion < 0.15, ≥3 节点)
  - bridge-node: 桥接节点 (连接 ≥3 个社区)
```

#### 关联评分 (`graph-relevance.ts`) — 4 种信号 (检索图模型)

> ⚠️ **注意**: 此模块是 `RetrievalGraph`（检索关联图），与知识图谱可视化 (`wiki-graph.ts`) 是两套独立的图模型。检索图侧重于页面间关联度计算，不含社区检测和可视化。

| 信号 | 权重 | 含义 |
|---|---|---|
| `sourceOverlap` | 4.0 | 共享来源文件（页面 sources 字段交集） |
| `directLink` | 3.0 | 直接 wikilink 连接（双向，出链+入链各 3.0） |
| `commonNeighbor` | 1.5 | 共同邻居（Adamic-Adar 算法，度数越低的共同邻居权重越高） |
| `typeAffinity` | 1.0 | 类型亲和度（5×5 矩阵，如 entity↔concept=1.2, source↔source=0.5） |

**类型亲和度矩阵** (部分):

| | entity | concept | source | query | synthesis |
|---|---|---|---|---|---|
| entity | 0.8 | **1.2** | 1.0 | 0.8 | 1.0 |
| concept | **1.2** | 0.8 | 1.0 | 1.0 | **1.2** |
| source | 1.0 | 1.0 | 0.5 | 0.8 | 1.0 |

**关键设计**:
- 图缓存：`dataVersion` 匹配时直接返回缓存，避免重复构建
- 链接解析：大小写不敏感 + 空格→连字符规范化
- 自环过滤：`nodeA.id === nodeB.id` 时返回 0

#### xflow 吸收方案 (✅ 已实现)

| 步骤 | 功能 | 工作量 | 前置依赖 | 状态 |
|---|---|---|---|---|
| 1 | 后端 `/wiki/graph` API 返回 nodes + edges JSON | 1 天 | 文件遍历 + wikilink 解析 (已有) | ✅ 已实现 |
| 2 | 前端 Canvas 力导向图渲染 (graph-view.tsx) | 1.5 天 | 步骤 1 | ✅ 已实现 (Canvas 而非 @react-sigma) |
| 3 | 社区检测 (Union-Find) + 图洞察 | 1 天 | 步骤 2 | ✅ 已实现 |
| 4 | 图谱/列表/Review 视图切换 | 0.5 天 | 步骤 3 | ✅ 已实现 |

**与 llm_wiki 的差异**: 未实现图过滤器 (`graph-filters.ts`)、图搜索 (`graph-search.ts`)、可见性控制 (`graph-visibility.ts`)、关联评分 (`graph-relevance.ts`)、前端使用 Canvas 而非 @react-sigma

---

### 🔴 [P0] LLM 驱动内容增强 (✅ 部分实现)

#### llm_wiki 实现 (6 个模块)

| 模块 | 文件 | 功能 |
|---|---|---|
| 摘要/标签 | `ingest.ts` | 保存后异步调用 LLM，生成摘要 + 标签写入 frontmatter |
| 队列管理 | `ingest-queue.ts` | 防并发、去重、限流、重试 |
| 去重缓存 | `ingest-cache.ts` | 内容哈希缓存，相同内容不重复处理 |
| 内容清洗 | `ingest-sanitize.ts` | 去除无用内容，减少 token 消耗 |
| 链接补全 | `enrich-wikilinks.ts` | 检测内容中已有的 wiki 页面名，自动加 [[wikilink]] |
| 提示模板 | `ingest.prompt.test.ts` | 测试 LLM 提示是否有效 |

#### 核心流程 (`ingest.ts`) — 两步思维链 (Two-Step Chain-of-Thought)

```
源文件导入 →
  └→ ingest-queue.enqueue(source)
       └→ 去重检查 (ingest-cache, SHA256 内容哈希)
            └→ 缓存命中 → 跳过完整摄入，仅处理图片级联
            └→ 缓存未命中 → 完整摄入管线:

  ┌─ Step 0: 预处理 ─────────────────────────────────────────
  │  ├→ 提取嵌入图片 (PDF/PPTX/DOCX → wiki/media/<slug>/)
  │  ├→ 图片描述管线 (VLM 生成 alt 文本, SHA256 去重缓存)
  │  └→ 内容清洗 (ingest-sanitize.ts: 去代码围栏/修复 frontmatter)
  │
  ├─ Step 1: 分析 (Analysis) ────────────────────────────────
  │  └→ LLM 系统提示: "你是研究分析专家"
  │     输入: 源文件 + purpose.md + index.md + overview.md
  │     输出: 结构化分析
  │       ├─ Key Entities (名称/类型/是否已存在)
  │       ├─ Key Concepts (定义/重要性)
  │       ├─ Main Arguments & Findings
  │       ├─ Connections to Existing Wiki
  │       ├─ Contradictions & Tensions
  │       └─ Recommendations (应创建/更新的页面)
  │
  ├─ Step 2: 生成 (Generation) ──────────────────────────────
  │  └→ LLM 系统提示: "你是 wiki 维护者"
  │     输入: Step 1 分析 + 源文件 + schema.md + index.md
  │     输出: FILE 块 + REVIEW 块
  │       ├─ ---FILE: wiki/path/page.md--- ... ---END FILE---
  │       │   (含完整 frontmatter + body)
  │       └─ ---REVIEW: type | Title--- ... ---END REVIEW---
  │           (需人工审批的项目)
  │
  ├─ Step 3: 写入 ───────────────────────────────────────────
  │  ├→ parseFileBlocks() 解析 FILE 块 (6 种容错: CRLF/截断/空路径/路径穿越/代码围栏/大小写)
  │  ├→ isSafeIngestPath() 安全检查 (拒绝 .. / 绝对路径 / Windows 保留名)
  │  ├→ 语言感知守卫: contentMatchesTargetLanguage() 检测输出语言
  │  ├→ 页面合并: mergePageContent() (三层层叠: 数组字段 union → LLM body 合并 → 锁定字段回写)
  │  └→ log.md 追加 / index.md 覆写 / 内容页面合并
  │
  ├─ Step 4: 解析 Review 项 ─────────────────────────────────
  │  └→ parseReviewBlocks() → contradiction/duplicate/missing-page/suggestion
  │     含 OPTIONS/PAGES/SEARCH 字段
  │
  ├─ Step 5: 缓存 ──────────────────────────────────────────
  │  └→ saveIngestCache() (硬失败时跳过缓存)
  │
  └─ Step 6: 向量嵌入 ──────────────────────────────────────
     └→ embedPage() (如果 embedding 配置启用)
```

**并发控制**: `withProjectLock` 项目级互斥锁，防止两个摄入同时覆盖 index.md

#### 链接补全设计 (`enrich-wikilinks.ts`) — 精妙之处

```
之前的方案: LLM 返回完整页面 → 模型经常重写破坏内容 ❌
新方案: LLM 只返回 [{term, target}] JSON → 代码原地替换 ✅
  - 内容除 [[...]] 外字节级不变
  - frontmatter 不受影响
  - 长度只增加 4 × 链接数
```

#### xflow 吸收方案 (⚠️ 部分实现)

| 步骤 | 功能 | 工作量 | 状态 |
|---|---|---|---|
| 1 | `WikiService.ingest_source()` 源文件摄入 | 0.5 天 | ⚠️ 已实现（单步摄入，非两步思维链） |
| 2 | 前端 wiki-page-view.tsx 展示 frontmatter 中的 summary 和 tags | 0.5 天 | ✅ 已实现 |
| 3 | `WikiService.enrich_wikilinks()` 自动补全 [[wikilink]] | 0.5 天 | ❌ 未实现 |
| 4 | 搜索排序 + snippet 展示摘要 | 0.5 天 | ✅ 已实现（snippet 高亮 + LRU 缓存） |

**与 llm_wiki 的差异**: 缺少两步思维链 (分析→生成)、enrich-wikilinks 链接补全、语言感知守卫、图片描述管线、ingest-cache 去重缓存、并发控制 (withProjectLock)

**待实施优先级**: 🔴 P0 — 两步思维链 Ingest + enrich-wikilinks 是核心差异化功能

---

### 🔴 [P0] 搜索质量增强 (已有基础 → 大幅提升)

#### 当前 xflow 搜索与 llm_wiki 的差距

| 特性 | xflow 当前 | llm_wiki |
|---|---|---|
| Token 分词 | ✅ 已移植 (完全一致) | ✅ 完整实现 |
| Scoring 权重 | ✅ 已移植 (完全一致) | ✅ 完整实现 |
| **向量/语义搜索** | ✅ embedding.py + vector_store.py (JSON 存储) | ✅ LanceDB 向量存储 + embedding |
| **RRF 融合** | ✅ search_with_rrf() (k=60) | ✅ keyword + vector 双路融合排名 |
| **Rust 原生搜索** | ❌ Python glob 遍历 | ✅ Tauri Rust commands |
| **搜索结果缓存** | ✅ LRU 缓存 (5min TTL, 128 slots) | ✅ Tauri IPC 层 |
| **snippet 展示** | ✅ 高亮 snippet (`<mark>` 标签) | ✅ 完整 snippet + images |

#### llm_wiki 搜索架构 (Rust)

```rust
// src-tauri/src/commands/search.rs
// 1. Keyword pass: 正则索引 + 字符串匹配
// 2. Vector pass: 查 LanceDB (如果配置了 embedding)
// 3. RRF fusion: 合并两种排名
// 4. 结果返回含 snippet + images + scores
```

#### 向量存储 (`vectorstore.rs`)

```rust
// LanceDB embedded vector store
// - Chunk size: 200-400 tokens
// - Auto retry with halved chunk size on failure
// - Per-page + per-chunk indexing
```

#### xflow 吸收方案

| 步骤 | 功能 | 工作量 | 优先级 | 状态 |
|---|---|---|---|---|
| 1 | LRU 内存缓存搜索结果 (key=query_hash, TTL=5min) | 0.5 天 | P0 | ✅ 已实现 |
| 2 | 增强 snippet 截取逻辑 (高亮匹配位置) | 0.5 天 | P0 | ✅ 已实现 |
| 3 | RRF 融合 (先纯 token，后续可加 vector) | 1 天 | P1 | ✅ 已实现 |
| 4 | 接入 embedding 服务 (可选) | 2-3 天 | P2 | ✅ 已实现 (Ollama/OpenAI) |
| 5 | 前端搜索模式切换 (关键词/语义/混合) | 0.5 天 | P1 | ✅ 已实现 |

---

### 🟡 [P1] 前端组件生态

#### llm_wiki vs xflow 前端对比

| 组件 | llm_wiki | xflow 当前 | 建议 | 工作量 | 状态 |
|---|---|---|---|---|---|
| **编辑器** | ✏️ Milkdown WYSIWYG (ProseMirror 内核) | 📝 textarea + 预览 | 保持 textarea，加 toolbar | 3-5 天 (Milkdown) | — |
| **Frontmatter 编辑** | ✅ `frontmatter-panel.tsx` | ✅ 编辑器内嵌 + 展示面板 | 已实现 | — | ✅ |
| **知识树导航** | ✅ `knowledge-tree.tsx` | ✅ 类别侧栏 | 增强文件树展示 | 1 天 | — |
| **搜索结果页** | ✅ `search-view.tsx` | ✅ 侧栏内搜索 + 模式切换 | 增强搜索体验 | 1 天 | — |
| **Lint 结果页** | ✅ `lint-view.tsx` | ✅ Review 审批面板 | 已实现 | — | ✅ |
| **Mermaid 图表** | ✅ `mermaid-diagram.tsx` | ✅ WikiMarkdown 内嵌 | 已实现 | — | ✅ |
| **LaTeX 公式** | ✅ KaTeX | ✅ remark-math + rehype-katex | 已实现 | — | ✅ |
| **页面类型标签** | ✅ 8种类型 + 色块 | ❌ 无 | 低优先级 | 1 天 | — |
| **content.tsx 拆分** | ✅ 模块化设计 | ✅ 已拆分为 9 个组件 | 已实现 | — | ✅ |
| **拖拽摄入** | ✅ 文件拖拽 | ✅ DndIngestOverlay | 已实现 | — | ✅ |
| **Review 审批** | ✅ `review-view.tsx` | ✅ WikiReviewPanel | 已实现 | — | ✅ |
| **图谱可视化** | ✅ `graph-view.tsx` (@react-sigma) | ✅ Canvas 力导向图 | 已实现 (Canvas 而非 Sigma) | — | ✅ |

**剩余待做**:
1. Milkdown WYSIWYG 编辑器 (3-5 天，可选升级)
2. 知识树导航增强 (1 天)
3. 页面类型标签 + 色块 (1 天)

---

### 🟡 [P1] 内容质量体系

#### llm_wiki `lint.ts` — 页面质检模块（两层架构）

**结构化 Lint** (`runStructuralLint`) — 纯代码检测，无需 LLM：

| 检查项 | type | 检测内容 | 严重度 |
|---|---|---|---|
| 孤立页面 | `orphan` | 无入链（排除 index.md 和 log.md） | info |
| 断链 | `broken-link` | `[[wikilink]]` 指向不存在的页面（大小写不敏感匹配） | warning |
| 无出链 | `no-outlinks` | 页面不包含任何 `[[wikilink]]` | info |

**语义 Lint** (`runSemanticLint`) — LLM 驱动，检测结构化 Lint 无法发现的问题：

| 检查项 | type | 检测内容 | 严重度 |
|---|---|---|---|
| 矛盾 | `contradiction` | 两个或多个页面做出冲突声明 | warning/info |
| 过时 | `stale` | 信息看起来已过时或被取代 | warning/info |
| 缺失页面 | `missing-page` | 重要概念被大量引用但无专门页面 | warning/info |
| 建议 | `suggestion` | 值得添加到 wiki 的问题或来源 | warning/info |

**语义 Lint 工作流程**:
```
1. 读取所有 wiki 文件 → 每个取前 500 字符作为摘要
2. 拼接所有摘要 → 发送给 LLM 分析
3. LLM 输出格式: ---LINT: type | severity | title--- ... ---END LINT---
4. 解析 LINT 块 → 提取 affectedPages、描述信息
5. 语言感知: buildLanguageDirective 自动检测输入语言
```

**关键设计细节**:
- 结构化 Lint 使用 `slugMap` 做大小写不敏感匹配
- 语义 Lint 摘要截取 500 字符，总采样 2000 字符做语言检测
- 语义 Lint 结果统一设置 `type: "semantic"`，原始类型保留在 `detail` 的 `[rawType]` 前缀中

#### xflow 当前: 已实现双层 Lint 系统

| 层级 | 检查项 | 状态 |
|---|---|---|
| 结构化 Lint | 孤立页面 (orphan) | ✅ 已实现 |
| 结构化 Lint | 断链 (broken-link) | ✅ 已实现 |
| 结构化 Lint | 无出链 (no-outlinks) | ✅ 已实现 |
| 语义 Lint | 矛盾 (contradiction) — 代码检测 + LLM 可选 | ✅ 已实现 |
| 语义 Lint | 过时 (stale) — 需 LLM | ✅ 已实现 (LLM 可选) |
| 语义 Lint | 缺失页面 (missing-page) — 需 LLM | ✅ 已实现 (LLM 可选) |
| 语义 Lint | 建议 (suggestion) — 需 LLM | ✅ 已实现 (LLM 可选) |

**API 端点**: `GET /wiki/lint?scope=structural|semantic|full`

**MCP Tool Action**: `lint` (支持 `scope` 参数)

**矛盾检测增强**: `contradiction.py` 提供基于关键词重叠 (Jaccard > 0.2) 的候选检测，无需 LLM；LLM 验证为可选步骤。

---

### 🟡 [P2] 页面类型系统

#### llm_wiki `wiki-type-style.ts` — 8 种页面类型

| 类型 | 颜色 | 图标 | 用途 |
|---|---|---|---|
| `entity` | 🔵 蓝色 | User | 人/组织/项目 |
| `concept` | 🟢 绿色 | Lightbulb | 关键概念/术语 |
| `query` | 🟠 琥珀色 | HelpCircle | 对话/研究查询 |
| `source` | 🪨 灰色 | FileText | 文献/文档摘要 |
| `thesis` | 🔴 玫瑰红 | Target | 论点/主张 |
| `finding` | 🟣 紫色 | TrendingUp | 研究发现 |
| `event` | 🔷 青色 | Calendar | 事件/时间线 |
| `overview` | 🟤 靛蓝 | BookOpen | 综述/索引 |

xflow 当前有 6 个 `DEFAULT_CATEGORIES`（实体/概念/源/综合/比较/查询）作为目录分类，但不支持前端的图标色块展示和元数据里的 type 字段。

**建议**: 引入 `type` 字段 + 前端类型标签展示

工作量: 1 天

---

### 🟡 [P2] 持久化摄入队列 (`ingest-queue.ts`)

#### llm_wiki 实现

llm_wiki 的摄入队列是一个完整的任务调度系统，远超简单的异步队列：

| 特性 | 实现 | 说明 |
|---|---|---|
| 持久化 | `.llm-wiki/ingest-queue.json` | 进程重启后恢复 pending/failed 任务 |
| 项目隔离 | `projectId` (UUID) + 注册表 | 防止跨项目写入，项目移动后仍可追溯 |
| 去重入队 | `upsertQueuedIngestTask()` | 同源文件 pending/failed 任务被合并，不重复排队 |
| 批量入队 | `enqueueBatch()` | 一次导入多文件，共享一次磁盘写入 |
| 自动重试 | MAX_RETRIES=3 | 处理中失败 → 重置为 pending，3 次后标记 failed |
| 取消清理 | `cleanupWrittenFiles()` | 取消/中断时级联删除已写入的 wiki 页面 |
| 项目切换 | `pauseQueue()` / `restoreQueue()` | 中断当前任务、持久化状态、加载新项目队列 |
| 队列耗尽回调 | `onQueueDrained()` | 队列清空后触发 Review Sweep (见下节) |

**项目切换握手流程**:
```
用户切换项目 →
  pauseQueue():
    ├→ 中止当前 LLM 调用 (AbortController)
    ├→ 中止 Sweep LLM 调用
    ├→ processing 任务 → 回退为 pending
    ├→ 保存队列到旧项目的 .llm-wiki/ingest-queue.json
    └→ 清空内存状态
  restoreQueue(newProject):
    ├→ 从新项目的 .llm-wiki/ingest-queue.json 加载
    ├→ processing → 回退为 pending (中断恢复)
    ├→ 丢弃跨项目任务 (防污染)
    └→ 恢复处理 processNext()
```

#### xflow 当前: ✅ 已实现持久化摄入队列

| 特性 | xflow 实现 | 说明 |
|---|---|---|
| 持久化 | `.ingest-queue.json` | 进程重启后恢复 pending/failed 任务 |
| 项目隔离 | 按 wiki_root 隔离 | 每个项目的队列独立存储 |
| 自动重试 | MAX_RETRIES=3 | 失败后自动重置为 pending |
| 手动重试 | `retry_failed()` | 手动将 failed 任务重置 |
| 清理完成 | `clear_done()` | 移除已完成的任务 |

**API 端点**: `GET /wiki/ingest-queue` + `POST /wiki/ingest-queue/process` + `POST /wiki/ingest-queue/{job_id}/retry`

**与 llm_wiki 的差异**: 未实现项目切换握手 (`pauseQueue/restoreQueue`)、去重入队 (`upsertQueuedIngestTask`)、批量入队 (`enqueueBatch`)、队列耗尽回调

---

### 🟡 [P2] Review Sweep 自动清理 (`sweep-reviews.ts`)

#### llm_wiki 实现

当摄入队列耗尽时自动触发，清理不再有效的 Review 项目：

```
队列耗尽 → onQueueDrained() →
  Stage 1: 规则匹配 (零成本)
    ├→ missing-page: 候选名已在 wiki 中存在 → auto-resolved
    └→ duplicate: affectedPages 中任一页面已不存在 → auto-resolved

  Stage 2: LLM 语义判断 (仍有 pending 项时)
    ├→ 构建 wiki 页面索引 (id + title)
    ├→ 批量评审: JUDGE_BATCH_SIZE=40, MAX_JUDGE_BATCHES=5
    ├→ LLM 输出: {"resolved": ["id1", "id2"]}
    └→ 保守策略: contradiction/confirm/suggestion 类型默认保留
```

**安全守卫**:
- 项目切换时中止 LLM 调用 (`sweepAbortController`)
- 异步 I/O 后二次检查项目是否已切换
- LLM 解析失败 → 空集 (不误删)

#### xflow 当前: ✅ 已实现 Review Sweep

**Phase 1 (规则清理)**: 移除断链、空 frontmatter 字段、重复字段、格式问题
**Phase 2 (语义清理)**: Stub — 需要 LLM 集成

**API 端点**: `POST /wiki/review-sweep?phase=rules|semantic|full`

**与 llm_wiki 的差异**: 缺少队列耗尽自动触发、LLM 批量评审、保守策略保留

---

### 🟡 [P2] 源文件级联删除 (`source-lifecycle.ts` + `wiki-page-delete.ts`)

#### llm_wiki 实现

删除源文件时，自动清理所有关联的 wiki 页面和引用：

**`source-lifecycle.ts`** — 源文件级删除:
```
删除源文件 → deleteSourceFiles():
  1. 删除源文件 raw/sources/<file>
  2. 清理预处理缓存 .cache/<file>.txt
  3. 移除摄入缓存条目 ingest-cache.json
  4. 扫描所有 wiki 页面的 frontmatter.sources 字段:
     ├→ sources 全部在删除列表 → 标记为待删除
     └→ sources 部分在删除列表 → 重写 sources 字段 (保留其余)
  5. 级联删除待删除页面 → cascadeDeleteWikiPagesWithRefs()
  6. 追加删除日志 → wiki/log.md
```

**`wiki-page-delete.ts`** — wiki 页面级联删除:
```
删除 wiki 页面 → cascadeDeleteWikiPagesWithRefs():
  1. 读取目标页面标题 (删除前快照)
  2. 级联删除每个目标:
     ├→ 删除 .md 文件
     ├→ 移除向量嵌入 (LanceDB)
     └→ 删除关联媒体目录 (仅 source 页面: wiki/media/<slug>/)
  3. 扫描所有存活 wiki 页面:
     ├→ index.md: 移除指向已删页面的条目
     ├→ body: [[deleted-slug]] → 替换为纯文本
     └→ frontmatter.related: 过滤已删 slug
```

**支持的源文件格式** (20 种):
```
md, mdx, txt, pdf, docx, pptx, xlsx,
odt, odp, ods, xls, csv, json, html,
htm, rtf, xml, yaml, yml
```

#### xflow 当前: ✅ 已实现两级级联删除

**Wiki 页面级级联删除** (`cascade.py`):
- `find_cascade_targets()`: 预览删除影响（页面引用、索引条目、依赖页面）
- `cascade_delete()`: 执行级联删除，清理 wikilink 引用和 index.md

**API 端点**: `GET /wiki/pages/{page_id}/cascade` (预览) + `DELETE /wiki/pages/{page_id}/cascade` (执行)

**与 llm_wiki 的差异**: 未实现源文件级级联删除 (`source-lifecycle.ts`)；✅ 已补全向量嵌入清理 (`_remove_vector_embedding`) 和媒体目录清理 (`_clean_media_directory`)；✅ 级联目标预览含嵌入/媒体状态

---

### 🟡 [P2] 页面合并引擎 (`page-merge.ts`)

#### llm_wiki 实现

当多个源文件贡献内容到同一 wiki 页面时，三层层叠合并：

```
mergePageContent(newContent, existingContent, merger):
  Fast path 1: 新页面 → 直接返回
  Fast path 2: 字节相同 → 返回 existing
  Fast path 3: body 相同 → 仅返回 frontmatter union 结果

  Layer 1: Frontmatter 数组字段 union (确定性)
    ├→ sources: 两个来源列表取并集
    ├→ tags: 两个标签列表取并集
    └→ related: 两个关联列表取并集

  Layer 2: LLM Body 合并 (需 LLM)
    ├→ 输入: existing 版本 + incoming 版本
    ├→ 输出: 合并后的完整文件 (frontmatter + body)
    ├→ 安全检查 1: 必须有合法 frontmatter
    └→ 安全检查 2: body 长度 ≥ max(old, new) × 0.7 (防截断)

  Layer 3: 锁定字段回写 (确定性)
    ├→ type: 强制回写已有值 (防止重分类)
    ├→ title: 强制回写已有值 (防止断链)
    ├→ created: 强制回写已有值 (时间戳不可变)
    └→ updated: 强制设为今天
```

**回退策略**: LLM 失败/安全检查拒绝 → 使用 array-merged + incoming body + 备份旧内容

**备份机制**: 合并前快照保存到 `.llm-wiki/page-history/<path>-<timestamp>.md`

#### xflow 当前: ✅ 已实现页面合并引擎

**Layer 1 (确定性合并)**: `merge_frontmatter()` — tags/sources/related 取并集，created 保留旧值，updated 取最新
**Section 级合并**: `merge_sections()` — 按 heading 合并，匹配标题替换，新标题追加

**与 llm_wiki 的差异**: 未实现 Layer 2 (LLM Body 合并)；✅ 已补全 Layer 3 锁定字段 (`title`/`category`/`type`, `_LOCKED_FIELDS`)；✅ 已补全备份机制 (`.history/<page_id>/`, 最多保留 10 个)；✅ 已补全 Body 长度防截断守卫 (≥50% 缩减则中止合并)

---

### 🟡 [P2] 内容清洗 (`ingest-sanitize.ts`)

#### llm_wiki 实现

LLM 输出在实际写入磁盘前，通过三步清洗修复常见问题：

| 问题 | 出现率 | 清洗方式 |
|---|---|---|
| 整页被 ```yaml 代码围栏包裹 | 30/67 页 (45%) | 检测首行+末行围栏，移除 |
| frontmatter 前缀 `frontmatter:` 键 | 常见 | 仅当下行是 `---` 时移除 |
| `related: [[a]], [[b]]` 非 YAML 语法 | 常见 | 重写为 `related: ["[[a]]", "[[b]]"]` |

**审计数据**: 在 67 个实体页面中，30 个有无法严格解析的 frontmatter。

#### xflow 当前: ✅ 已实现内容清洗

`sanitize_wiki_content()` 已集成到 `service.py` 的 `write_page()` 方法中，写入前自动调用。

| 问题 | 清洗方式 | 状态 |
|---|---|---|
| 整页被 ```yaml 代码围栏包裹 | 检测首行+末行围栏，移除 | ✅ |
| frontmatter 前缀 `frontmatter:` 键 | 仅当下行是 `---` 时移除 | ✅ |
| `related: [[a]], [[b]]` 非 YAML 语法 | 重写为 `related: ["[[a]]", "[[b]]"]` | ✅ |

---

### 🟢 [P3] 深度研究/高级特性

| 特性 | llm_wiki | xflow 当前 | 建议 | 工作量 |
|---|---|---|---|---|
| 深度研究 (`deep-research.ts`) | ✅ 多轮递归研究 | ❌ 暂无 | 暂不推荐 | 大 |
| 图片自动描述 (`image-caption-pipeline.ts`) | ✅ LLM 驱动 | ❌ 暂无 | 暂不推荐 | 2 天 |
| 源管理 (`sources-view.tsx`, `source-lifecycle.ts`) | ✅ 源的 CRUD + watch | ✅ watcher.py 部分实现 | 暂不推荐 | 大 |
| 自动保存 (`auto-save.ts`) | ✅ 定时自动保存 | ✅ wiki-editor.tsx (localStorage) | 已实现 | — |
| 去重 (`dedup*.ts`) | ✅ 内容哈希去重 | ⚠️ dedup.py (精确+近似, 语义级未实现) | 需补全 | 0.5天 |
| 评审系统 (`review-view.tsx`, `review-utils.ts`) | ✅ 人工评审 | ✅ WikiReviewPanel | 已实现 | — |
| 定时导入 (`scheduled-import.ts`) | ✅ cron 驱动 | ❌ 暂无 | 暂不推荐 | 中 |
| 知识树 (`knowledge-tree.tsx`) | ✅ 文件树导航 | ✅ 类别侧栏 | **优化现有** | 1 天 |
| 文件监控 (`watcher.ts`) | ✅ 文件系统监控 | ✅ watcher.py (watchfiles/polling) | 已实现 | — |
| 矛盾检测 (`contradiction.ts`) | ✅ LLM 驱动 | ✅ contradiction.py (代码+LLM) | 已实现 | — |

---

## 三、已移植模块审计

### ✅ Phase 1 移植完成 (代码注释明确标注 "Ported from")

| 模块 | llm_wiki 源文件 | xflow 文件 | 移植完整性 |
|---|---|---|---|
| 文件名生成 | `wiki-filename.ts` → `filename.py` | ✅ 完全一致 | NFKC 规范化、CJK 保留、timestamp 防碰撞 |
| Wikilink 解析 | `wiki-page-resolver.ts` → `resolver.py` | ✅ 完全一致 | 两级路径查找、`[[wikilink]]` + `![[preview]]` |
| Token 搜索 | `search.ts` → `search.py` | ✅ 增强版 (原简化，后补全) | 5 级加权、CJK bigram、stop words、LRU 缓存、snippet 高亮 |
| 清理/章节合并 | `wiki-cleanup.ts` → `cleanup.py` | ✅ 完全一致 | 标准化 ref key、索引清理、wikilink 剥离、section merge |

### ✅ Phase 2 新增模块 (前端拖拽 Ingest + Review 审批 UI)

| 模块 | llm_wiki 源文件 | xflow 文件 | 移植完整性 | 差异说明 |
|---|---|---|---|---|
| 拖拽摄入 | 文件拖拽组件 | `wiki-dnd-ingest.tsx` | ✅ 完整实现 | 多文件上传 + 状态显示 |
| Review 审批 | `review-view.tsx` | `wiki-review-panel.tsx` | ✅ 完整实现 | Lint 结果展示 + Resolve 操作 |
| Review 存储 | `review-utils.ts` | `review.py` | ✅ 增强 | 持久化 JSON 存储 + Lint→Review 转换 |
| 页面查看 + Frontmatter | `frontmatter-panel.tsx` | `wiki-page-view.tsx` + `wiki-editor.tsx` | ✅ 完整实现 | 展示 + 编辑双模式 |

### ✅ Phase 3 新增模块 (持久化队列 + 级联删除 + 页面合并 + Review Sweep)

| 模块 | llm_wiki 源文件 | xflow 文件 | 移植完整性 | 差异说明 |
|---|---|---|---|---|
| 持久化摄入队列 | `ingest-queue.ts` | `ingest_queue.py` | ⚠️ 大部分移植 | ✅ 去重入队 (`upsertQueuedIngestTask`)、✅ 批量入队 (`enqueueBatch`)、✅ 队列耗尽回调 (`is_drained` + log)；缺项目切换握手 (`pauseQueue/restoreQueue`) |
| 级联删除 | `wiki-page-delete.ts` | `cascade.py` | ✅ 增强移植 | ✅ 页面删除 + 引用清理 + ✅ 向量嵌入清理 (`remove_page`) + ✅ 媒体目录清理 (`_clean_media_directory`) + ✅ 级联目标预览含嵌入/媒体状态；缺源文件级级联 |
| 页面合并 | `page-merge.ts` | `cleanup.py` (merge_frontmatter + merge_sections) | ✅ 增强移植 | ✅ Layer 1 (数组 union) + ✅ Layer 3 锁定字段 (`title`/`category`/`type`) + ✅ Section 级合并 + ✅ 备份机制 (`.history/<page_id>/`) + ✅ Body 长度防截断守卫；缺 Layer 2 LLM Body 合并 |
| Review Sweep | `sweep-reviews.ts` | `review_sweep.py` | ✅ 两阶段完整 | ✅ Phase 1 规则清理 (断链/空字段/重复字段/格式) + ✅ Phase 2 LLM 语义清理 (过期/矛盾/重复实体/孤立页, 保守策略 flag-only)；支持 `llm_call_fn` 回调参数 |

### ✅ Phase 4 新增模块 (向量搜索 + 矛盾检测 + 去重 + 文件监控)

| 模块 | llm_wiki 源文件 | xflow 文件 | 移植完整性 | 差异说明 |
|---|---|---|---|---|
| 向量嵌入 | `embedding.ts` | `embedding.py` | ✅ 完整实现 | Ollama + OpenAI API 双后端 |
| 向量存储 | `vectorstore.rs` (LanceDB) | `vector_store.py` (JSON) | ⚠️ 存储差异 | JSON 文件持久化替代 LanceDB；RRF 融合已实现 |
| 矛盾检测 | `lint.ts` (contradiction) | `contradiction.py` | ✅ 增强 | 多了关键词重叠 Jaccard>0.2 代码检测，LLM 为可选 |
| 内容去重 | `dedup*.ts` (4 模块) | `dedup.py` | ✅ 三级完整 | ✅ 精确 (SHA256) + ✅ 近似 (trigram Jaccard>0.8) + ✅ 语义 (vector cosine>0.9, opt-in `include_semantic=True`)；支持 `find_duplicates_async` 异步版本 |
| 文件监控 | `source-lifecycle.ts` | `watcher.py` | ✅ 完整实现 | watchfiles + polling 降级 |
| 自动保存 | `auto-save.ts` | `wiki-editor.tsx` | ⚠️ 实现差异 | localStorage 草稿 vs 定时写文件 |

### ✅ 跨 Phase 新增模块 (搜索增强 + 图谱 + Lint + 内容清洗)

| 模块 | llm_wiki 源文件 | xflow 文件 | 移植完整性 | 差异说明 |
|---|---|---|---|---|
| 搜索缓存 | Tauri IPC 层 | `search.py` (_SearchCache) | ✅ 完整实现 | LRU 缓存 (5min TTL, 128 slots) |
| Snippet 高亮 | search.rs | `search.py` (highlight_snippet) | ✅ 完整实现 | `<mark>` 标签高亮 |
| RRF 融合 | search.rs + `search-rrf.test.ts` | `vector_store.py` (search_with_rrf) | ✅ 完整实现 | k=60 RRF 融合排名 |
| 图构建 | `wiki-graph.ts` | `graph.py` | ⚠️ 部分移植 | Union-Find 社区 + 洞察；缺 Louvain 算法 |
| 图渲染 | `graph-view.tsx` (@react-sigma) | `graph-view.tsx` (Canvas) | ⚠️ 渲染差异 | Canvas 力导向图替代 @react-sigma |
| 双层 Lint | `lint.ts` | `lint.py` | ✅ 完整实现 | 结构化 3 项 + 语义 4 项 + scope 参数 |
| 内容清洗 | `ingest-sanitize.ts` | `sanitize.py` | ✅ 完整实现 | 三步修复 (代码围栏/前缀/非 YAML 语法) |
| Mermaid 渲染 | `mermaid-diagram.tsx` | `wiki-markdown.tsx` (内嵌) | ✅ 完整实现 | remark + mermaid 插件 |
| LaTeX 渲染 | KaTeX | `wiki-markdown.tsx` (内嵌) | ✅ 完整实现 | remark-math + rehype-katex |

### ⚠️ xflow search.py 已补全的功能 (原简化标记已过时)

```python
# search.py 文件头原始注释 (已过时):
# Ported from nashsu/llm_wiki ``src/lib/search.ts``, with the following
# simplifications:
#   - No vector/embedding search (requires external LLM)  ← ✅ 已补全 (embedding.py + vector_store.py)
#   - No RRF fusion (only one ranking list)               ← ✅ 已补全 (search_with_rrf)
#   - No Tauri IPC / FileNode tree — uses pathlib directly ← 仍使用 pathlib (Python 架构决定)
#   - No image extraction from search results              ← ❌ 未实现
```

---

## 四、推荐吸收路线图 (按优先级排序)

### 第一阶段 — Quick Wins (本周可做) ✅ 已完成

| # | 功能 | 文件 | 工作量 | 效果 | 状态 |
|---|---|---|---|---|---|
| 1 | **LLM 自动摘要 + 标签** | `WikiService.ingest()` 新方法 + 前端展示 | 1 天 | 知识卡片不再空白 | ⚠️ 部分: ingest_source 已实现，缺两步思维链 |
| 2 | **搜索缓存 + snippet 增强** | `search.py` 加 LRU cache + snippet 优化 | 1 天 | 搜索响应 & 结果质量提升 | ✅ 已完成 |
| 3 | **Mermaid / LaTeX 渲染** | `wiki-markdown.tsx` 加 remark-math + mermaid | 1 天 | 文档渲染能力飞跃 | ✅ 已完成 |
| 4 | **Frontmatter 编辑面板** | `wiki-editor.tsx` + `wiki-page-view.tsx` | 1 天 | 用户可直接编辑元数据 | ✅ 已完成 |

### 第二阶段 — 核心差异化 (2 周) ✅ 已完成

| # | 功能 | 工作量 | 效果 | 状态 |
|---|---|---|---|---|
| 5 | **知识图谱可视化** | 4-5 天 | 🔥 核心差异化竞争力 | ✅ 已完成 (Canvas 力导向图) |
| 6 | **content.tsx 组件拆分** | 2 天 | 前端可维护性提升 | ✅ 已完成 (9 个组件) |
| 7 | **搜索模式切换** | 1 天 | 关键词/语义/混合搜索 | ✅ 已完成 |
| 8 | **双层 Lint + Review 审批** | 1-2 天 | 内容质量保障 | ✅ 已完成 |

### 第三阶段 — 进化 (每月) ✅ 已完成

| # | 功能 | 工作量 | 状态 |
|---|---|---|---|
| 9 | RRF 融合搜索 (keyword + vector) | 2-3 天 | ✅ 已完成 (search_with_rrf, k=60) |
| 10 | 持久化摄入队列 | 3-4 天 | ✅ 已完成 (ingest_queue.py) |
| 11 | Wiki 页面级联删除 | 2-3 天 | ✅ 已完成 (cascade.py) |
| 12 | 页面合并引擎 (Layer 1 + Section 级) | 1 天 | ✅ 已完成 (cleanup.py merge_frontmatter/merge_sections) |
| 13 | Review Sweep 自动清理 | 1-2 天 | ✅ 已完成 (review_sweep.py, 规则+LLM语义两阶段) |
| 14 | 内容清洗 (写入前三步修复) | 0.5 天 | ✅ 已完成 (sanitize.py) |
| 15 | 图洞察 (SurprisingConnections + KnowledgeGaps) | 2 天 | ✅ 已完成 (graph.py Union-Find 社区 + 洞察) |
| 16 | 矛盾检测 | 1 天 | ✅ 已完成 (contradiction.py) |
| 17 | 内容去重 | 2 天 | ✅ 已完成 (dedup.py 精确+近似+语义三级, 语义级opt-in) |
| 18 | 向量搜索 + embedding | 3 天 | ✅ 已完成 (embedding.py + vector_store.py) |
| 19 | 自动保存 | 1 天 | ✅ 已完成 (wiki-editor.tsx localStorage) |
| 20 | 文件监控自动摄入 | 2 天 | ✅ 已完成 (watcher.py) |

### 第四阶段 — 精进 (待实施)

| # | 功能 | 工作量 | 优先级 | 说明 |
|---|---|---|---|---|
| 21 | LLM 两步思维链 Ingest (分析→生成) | 3-4 天 | 🔴 P0 | 核心差异化功能 |
| 22 | LLM 链接补全 (enrich-wikilinks) | 1 天 | 🔴 P0 | 自动 [[wikilink]] 补全 |
| 23 | 页面合并 Layer 2 (LLM Body 合并) | 2 天 | 🟡 P1 | 智能 body 合并 |
| 24 | ~~页面合并 Layer 3 (锁定字段回写)~~ | ~~0.5 天~~ | ✅ 已完成 | type/title/category 锁定 + 备份 + 防截断守卫 |
| 25 | 图谱关联评分 (RetrievalGraph) | 2 天 | 🟡 P1 | 4 种关联信号加权 |
| 26 | 图过滤器 + 图搜索 | 1 天 | 🟡 P2 | 类型/结构/孤立节点过滤 |
| 27 | 源文件级级联删除 | 1.5 天 | 🟡 P2 | source-lifecycle 功能 |
| 28 | 页面类型系统 + 色块图标 | 1 天 | 🟡 P2 | 8 种 type + 前端展示 |
| 29 | 知识树导航增强 | 1 天 | 🟡 P2 | 文件树展示 |
| 30 | Review Sweep LLM 批量评审 | 1.5 天 | 🟡 P2 | 保守策略保留 |
| 31 | 摄入队列: 项目切换握手 | 1.5 天 | 🟡 P2 | pauseQueue/restoreQueue |
| 32 | 去重语义级 (vector similarity > 0.9) | 0.5 天 | 🟡 P2 | 补全 dedup.py 第三级 |
| 33 | 备份机制 (.llm-wiki/page-history/) | 1 天 | 🟢 P3 | 合并前快照保存 |
| 34 | 搜索结果图片提取 | 1 天 | 🟢 P3 | search.py 原简化项未补全 |

---

## 五、关键代码引用

### llm_wiki 搜索评分权重 (已完全移植)

```python
# xflow: backend/app/wiki/search.py
FILENAME_EXACT_BONUS      = 200
PHRASE_IN_TITLE_BONUS     = 50
PHRASE_IN_CONTENT_PER_OCC = 20
TITLE_TOKEN_WEIGHT         = 5
CONTENT_TOKEN_WEIGHT       = 1
```

### llm_wiki 关联评分权重 (❌ 未移植，🟡 P1 待实施)

```typescript
// src/lib/graph-relevance.ts — 检索图 (RetrievalGraph) 关联度计算
const WEIGHTS = {
  directLink: 3.0,      // 直接 wikilink 连接 (双向)
  sourceOverlap: 4.0,   // 共享来源文件 (sources 字段交集)
  commonNeighbor: 1.5,  // 共同邻居 (Adamic-Adar 算法)
  typeAffinity: 1.0,    // 类型亲和度 (5×5 矩阵)
} as const

// 类型亲和度矩阵 (部分)
const TYPE_AFFINITY = {
  entity:   { concept: 1.2, entity: 0.8, source: 1.0, synthesis: 1.0, query: 0.8 },
  concept:  { entity: 1.2, concept: 0.8, source: 1.0, synthesis: 1.2, query: 1.0 },
  source:   { entity: 1.0, concept: 1.0, source: 0.5, query: 0.8, synthesis: 1.0 },
  query:    { concept: 1.0, entity: 0.8, synthesis: 1.0, source: 0.8, query: 0.5 },
  synthesis:{ concept: 1.2, entity: 1.0, source: 1.0, query: 1.0, synthesis: 0.8 },
}
```

### llm_wiki 前端 GraphView 核心 (✅ 已用 Canvas 替代实现)

```tsx
// llm_wiki 使用 @react-sigma/core:
import { SigmaContainer, ControlsContainer, ZoomControl } from "@react-sigma/core";
import { useLoadGraph } from "@react-sigma/core";

// xflow 使用 Canvas 力导向图 (graph-view.tsx, 600 行):
// - 自实现力导向布局算法
// - 节点拖拽交互
// - 社区颜色编码
// - 悬停提示 (title, linkCount, community)
// - 缩放 + 平移
// 与 llm_wiki 差异: 无 @react-sigma 高级控件 (ZoomControl/FilterControl)，
// 无图内搜索/过滤/可见性控制
```

### llm_wiki LLM Ingest 两步提示模板 (❌ 未实现，🔴 P0 待实施)

```
// Step 1: 分析提示 (buildAnalysisPrompt)
"You are an expert research analyst. Read the source document and produce a structured analysis."
→ 输出: Key Entities / Key Concepts / Main Arguments / Connections / Contradictions / Recommendations
→ 上下文: purpose.md + index.md + 源文件内容

// Step 2: 生成提示 (buildGenerationPrompt)
"You are a wiki maintainer. Based on the analysis provided, generate wiki files."
→ 输出格式:
  ---FILE: wiki/path/page.md---
  (frontmatter + body)
  ---END FILE---
  ---REVIEW: type | Title---
  Description
  OPTIONS: Create Page | Skip
  PAGES: wiki/page1.md, wiki/page2.md
  SEARCH: query1 | query2 | query3
  ---END REVIEW---
→ 规则: 首字符必须为 `-`，禁止前言/分析散文/代码围栏
→ 安全: isSafeIngestPath() 拒绝路径穿越/绝对路径/Windows 保留名
→ 语言: languageRule() 在提示末尾重复强调，防止小模型回退训练语言
```

---

## 六、总结

| 维度 | llm_wiki 优势 | xflow 当前状态 | 差距 | 建议优先级 |
|---|---|---|---|---|
| **知识图谱** | 8 模块完整生态 (构建 + 分析 + 过滤 + 搜索 + 可视化) | ✅ 图构建 + Union-Find 社区 + Canvas 渲染 + 图洞察 + 视图切换 | 缺图过滤器/图搜索/可见性控制/关联评分 (RetrievalGraph)；Canvas 非 @react-sigma | 🟡 P2 (增强) |
| **LLM 驱动** | 两步思维链 Ingest + 链接补全 (异步队列) | ⚠️ 部分: 内容清洗 + ingest_source + Review 生成 | 缺两步思维链 (分析→生成)、链接补全 (enrich-wikilinks)、语言感知守卫、图片描述管线 | 🔴 P0 (核心) |
| **搜索质量** | RRF + 向量 + Rust + 缓存 | ✅ LRU 缓存 + snippet 高亮 + RRF 融合 + 向量搜索 (Ollama/OpenAI) + 模式切换 | Rust 原生搜索 (Python glob 替代) | 🟢 P3 (优化) |
| **前端组件** | 20+ 模板化组件 | ✅ 已拆分 9 个组件: sidebar/editor/page-view/markdown/graph/dnd-ingest/review | 缺 Milkdown WYSIWYG、页面类型色块、知识树增强 | 🟡 P2 (增强) |
| **内容质量** | 双层 Lint (结构化 3 项 + 语义 4 项) | ✅ 双层 Lint + 矛盾检测 (关键词+LLM) + Review 审批面板 | 语义 Lint 的 LLM 部分为可选 | 🟢 P3 (优化) |
| **摄入队列** | 持久化队列 + 项目隔离 + 自动重试 + 批量入队 | ✅ 持久化队列 (.ingest-queue.json) + 自动重试 + ✅ 去重入队 + ✅ 批量入队 + ✅ 队列耗尽回调 | 缺项目切换握手 (`pauseQueue/restoreQueue`) | 🟡 P2 (增强) |
| **级联删除** | 源文件级 + wiki 页面级 + 嵌入/媒体清理 | ✅ Wiki 页面级级联删除 + 引用清理 + ✅ 向量嵌入清理 + ✅ 媒体目录清理 + index.md 更新 | 缺源文件级级联删除 | 🟡 P2 (增强) |
| **页面合并** | 三层层叠 (数组 union → LLM 合并 → 锁定字段) | ✅ Layer 1 (frontmatter union) + ✅ Layer 3 (锁定字段 title/category/type) + Section 级合并 + ✅ 备份机制 + ✅ Body 防截断守卫 | 缺 Layer 2 (LLM Body 合并) | 🟡 P1 (核心增强) |
| **Review Sweep** | 两阶段自动清理 (规则 + LLM 语义) | ✅ 两阶段 (规则清理 + LLM 语义清理, 保守 flag-only 策略) | 缺 LLM 批量评审、队列耗尽自动触发 | 🟡 P2 (增强) |
| **内容清洗** | 三步修复 (45% LLM 输出有 frontmatter 问题) | ✅ sanitize_wiki_content() 集成到 write_page() | 基本一致 | ✅ 完成 |
| **类型系统** | 8 种类型 + 色块图标 | ❌ 6 个 DEFAULT_CATEGORIES (目录分类) | 缺 type 字段 + 前端色块图标展示 | 🟡 P2 |
| **去重** | LLM 检测重复实体 + 合并引擎 | ⚠️ dedup.py (精确 SHA256 + 近似 trigram Jaccard>0.8) | 语义级 (vector>0.9) 未实现；缺 LLM 驱动合并引擎 | 🟡 P2 (增强) |
| **后端性能** | Rust 原生搜索 | Python glob + LRU 缓存缓解 | 无 Rust 原生搜索 | 🟢 P3 |
| **自动保存** | 定时自动保存 | ✅ wiki-editor.tsx (localStorage 草稿) | 实现方式不同 (localStorage vs 定时写文件) | ✅ 完成 |
| **矛盾检测** | LLM 驱动 | ✅ contradiction.py (关键词重叠 Jaccard>0.2 + LLM 可选) | 比 llm_wiki 多了代码检测能力 | ✅ 完成 |
| **文件监控** | 文件系统监控 | ✅ watcher.py (watchfiles + polling 降级) | 基本一致 | ✅ 完成 |

**一句话结论**: Phase 1-4 已完成核心功能移植（搜索增强、图谱可视化、Review 审批、拖拽 Ingest、双层 Lint、级联删除+嵌入/媒体清理、页面合并+备份+防截断+锁定字段、内容清洗、摄入队列+去重入队+批量入队+队列耗尽回调、向量搜索、矛盾检测、三级去重(精确+近似+语义)、文件监控、自动保存）。**下一步重点**: 🔴 LLM 两步思维链 Ingest + 链接补全 (enrich-wikilinks)；🟡 页面合并 Layer 2 (LLM Body)、图谱关联评分 (RetrievalGraph)。
