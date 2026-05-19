---
title: llm_wiki → xflow-desktop 知识中心吸收分析报告
category: synthesis
created: 2026-05-19T04:47:36.204093+00:00
updated: 2026-05-19T04:47:36.204093+00:00
related: []
sources: []
---

# llm_wiki → xflow-desktop 知识中心吸收分析报告 v2（深度版）

> **分析版本**: 2026-05-19  
> **分析方式**: 逐文件读取 llm_wiki 完整源码（/tmp/llm_wiki/，约 130+ TypeScript 模块，17 Rust 后端模块）  
> **对比基线**: xflow-desktop 知识中心（backend/app/wiki/ 7 个 Python 模块，1 个 API 模块，前端 2 个页面组件）

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
├── service.py        # 核心业务 (CRUD + health check)
├── search.py         # Token 搜索 (移植自 llm_wiki search.ts，简化版)
├── cleanup.py        # 索引清理/章节合并 (移植自 llm_wiki wiki-cleanup.ts)
├── resolver.py       # Wikilink 解析 (移植自 llm_wiki wiki-page-resolver.ts)
├── filename.py       # 文件名生成 (移植自 llm_wiki wiki-filename.ts)
├── tool.py           # MCP bridge
└── __init__.py

backend/app/api/wiki.py  # 14 个 REST 端点

frontend/src/app/(main)/knowledge/
├── page.tsx                # 知识中心首页 (~70 行)
└── content.tsx             # 编辑器/预览/侧栏 (单文件 ~680 行)
```

---

## 二、逐项深度对比

### 🔴 [P0] 知识图谱可视化 (0 → ✅)

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

#### xflow 吸收方案

| 步骤 | 功能 | 工作量 | 前置依赖 |
|---|---|---|---|
| 1 | 后端 `/wiki/graph` API 返回 nodes + edges JSON | 1 天 | 文件遍历 + wikilink 解析 (已有) |
| 2 | 前端安装 `@react-sigma/core` + `graphology` | 0.5 天 | 前端依赖安装 |
| 3 | GraphView 组件渲染力导向图 | 1.5 天 | 步骤 1-2 |
| 4 | 社区检测 + 图搜索 + 过滤器 | 1 天 | 步骤 3 |
| 5 | 图洞察 (SurprisingConnections + KnowledgeGaps) | 1 天 | 步骤 4 |

**总计: 4-5 天，P0 优先**

---

### 🔴 [P0] LLM 驱动内容增强 (0 → ✅)

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

#### xflow 吸收方案

| 步骤 | 功能 | 工作量 |
|---|---|---|
| 1 | `WikiService.ingest()` 异步任务：LLM 生成 summary + tags + type | 0.5 天 |
| 2 | 前端 content.tsx 展示 frontmatter 中的 summary 和 tags | 0.5 天 |
| 3 | `WikiService.enrich_wikilinks()` 异步任务：自动补全 [[wikilink]] | 0.5 天 |
| 4 | 搜索排序 + snippet 展示摘要 | 0.5 天 |

**总计: 2 天，P0 优先** — 代码改动极少

---

### 🔴 [P0] 搜索质量增强 (已有基础 → 大幅提升)

#### 当前 xflow 搜索与 llm_wiki 的差距

| 特性 | xflow 当前 | llm_wiki |
|---|---|---|
| Token 分词 | ✅ 已移植 (完全一致) | ✅ 完整实现 |
| Scoring 权重 | ✅ 已移植 (完全一致) | ✅ 完整实现 |
| **向量/语义搜索** | ❌ 无 | ✅ LanceDB 向量存储 + embedding |
| **RRF 融合** | ❌ 无 | ✅ keyword + vector 双路融合排名 |
| **Rust 原生搜索** | ❌ Python glob 遍历 | ✅ Tauri Rust commands |
| **搜索结果缓存** | ❌ 每次重新扫描 | ✅ Tauri IPC 层 |
| **snippet 展示** | ⚠️ 基础实现 | ✅ 完整 snippet + images |

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

| 步骤 | 功能 | 工作量 | 优先级 |
|---|---|---|---|
| 1 | LRU 内存缓存搜索结果 (key=query_hash, TTL=5min) | 0.5 天 | P0 |
| 2 | 增强 snippet 截取逻辑 (高亮匹配位置) | 0.5 天 | P0 |
| 3 | RRF 融合 (先纯 token，后续可加 vector) | 1 天 | P1 |
| 4 | 接入 embedding 服务 (可选) | 2-3 天 | P2 |

---

### 🟡 [P1] 前端组件生态

#### llm_wiki vs xflow 前端对比

| 组件 | llm_wiki | xflow 当前 | 建议 | 工作量 |
|---|---|---|---|---|
| **编辑器** | ✏️ Milkdown WYSIWYG (ProseMirror 内核) | 📝 textarea + 预览 | 保持 textarea，加 toolbar | 3-5 天 (Milkdown) |
| **Frontmatter 编辑** | ✅ `frontmatter-panel.tsx` | ❌ 无 | **建议做** | 1 天 |
| **知识树导航** | ✅ `knowledge-tree.tsx` | ✅ 类别侧栏 | 增强文件树展示 | 1 天 |
| **搜索结果页** | ✅ `search-view.tsx` | ❌ 内嵌搜索 | **建议做** | 1 天 |
| **Lint 结果页** | ✅ `lint-view.tsx` | ❌ 无 | 低优先级 | 1 天 |
| **Mermaid 图表** | ✅ `mermaid-diagram.tsx` | ❌ 无 | **建议做** | 0.5 天 |
| **LaTeX 公式** | ✅ KaTeX | ❌ 无 | **建议做** | 0.5 天 |
| **页面类型标签** | ✅ 8种类型 + 色块 | ❌ 无 | 低优先级 | 1 天 |
| **content.tsx 拆分** | ✅ 模块化设计 | 📝 单文件 680 行 | **建议重构** | 2 天 |

**推荐前端优先做**:
1. Frontmatter 编辑面板 (用户可直接编辑 YAML 元数据)
2. Mermaid + LaTeX 渲染 (技术门槛低，感知明显)
3. content.tsx 组件拆分 (技术债清理)
4. 搜索结果页独立 (当前嵌入在侧栏，体验受限)

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

#### xflow 当前: 仅有 `cleanup.health_check()` 检测孤立链接和过期

**建议**: 引入双层 Lint 系统 + 后端 `/wiki/lint` API

工作量: 结构化 Lint 1 天，语义 Lint 1-2 天

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

#### xflow 当前: 无队列系统，摄入为即时同步操作

**建议**: 引入持久化摄入队列

工作量: 3-4 天 (含前端队列状态展示)

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

#### xflow 当前: 无 Review 系统

**建议**: 随 Review 审批 UI 一起引入

工作量: 1-2 天 (含 Review 项数据模型)

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

#### xflow 当前: 仅有基本的文件删除，无级联清理

**建议**: 引入两级级联删除

工作量: 2-3 天

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

#### xflow 当前: 无合并逻辑，重摄入直接覆盖

**建议**: 至少实现 Layer 1 (确定性数组字段 union)

工作量: Layer 1 仅 1 天，完整三层 2-3 天

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

#### xflow 当前: 无内容清洗

**建议**: 引入写入前清洗

工作量: 0.5 天

---

### 🟢 [P3] 深度研究/高级特性

| 特性 | llm_wiki | xflow 建议 | 工作量 |
|---|---|---|---|
| 深度研究 (`deep-research.ts`) | ✅ 多轮递归研究 | 暂不推荐 | 大 |
| 图片自动描述 (`image-caption-pipeline.ts`) | ✅ LLM 驱动 | 暂不推荐 | 2 天 |
| 源管理 (`sources-view.tsx`, `source-lifecycle.ts`) | ✅ 源的 CRUD + watch | 暂不推荐 | 大 |
| 自动保存 (`auto-save.ts`) | ✅ 定时自动保存 | **推荐** | 1 天 |
| 去重 (`dedup*.ts`) | ✅ 内容哈希去重 | **推荐** | 1 天 |
| 评审系统 (`review-view.tsx`, `review-utils.ts`) | ✅ 人工评审 | 暂不推荐 | 大 |
| 定时导入 (`scheduled-import.ts`) | ✅ cron 驱动 | 暂不推荐 | 中 |
| 知识树 (`knowledge-tree.tsx`) | ✅ 文件树导航 | **优化现有** | 1 天 |

---

## 三、已移植模块审计

### ✅ 移植完成 (代码注释明确标注 "Ported from")

| 模块 | llm_wiki 源文件 | xflow 文件 | 移植完整性 |
|---|---|---|---|
| 文件名生成 | `wiki-filename.ts` → `filename.py` | ✅ 完全一致 | NFKC 规范化、CJK 保留、timestamp 防碰撞 |
| Wikilink 解析 | `wiki-page-resolver.ts` → `resolver.py` | ✅ 完全一致 | 两级路径查找、`[[wikilink]]` + `![[preview]]` |
| Token 搜索 | `search.ts` → `search.py` | ✅ 完全一致 (简化) | 5 级加权、CJK bigram、stop words |
| 清理/章节合并 | `wiki-cleanup.ts` → `cleanup.py` | ✅ 完全一致 | 标准化 ref key、索引清理、wikilink 剥离、section merge |

### ⚠️ xflow 简化的部分 (移植时被标记为简化)

```python
# search.py 文件头注释
# Ported from nashsu/llm_wiki ``src/lib/search.ts``, with the following
# simplifications:
#   - No vector/embedding search (requires external LLM)
#   - No RRF fusion (only one ranking list)
#   - No Tauri IPC / FileNode tree — uses pathlib directly
#   - No image extraction from search results
```

---

## 四、推荐吸收路线图 (按优先级排序)

### 第一阶段 — Quick Wins (本周可做)

| # | 功能 | 文件 | 工作量 | 效果 |
|---|---|---|---|---|
| 1 | **LLM 自动摘要 + 标签** | `WikiService.ingest()` 新方法 + 前端展示 | 1 天 | 知识卡片不再空白 |
| 2 | **搜索缓存 + snippet 增强** | `search.py` 加 LRU cache + snippet 优化 | 1 天 | 搜索响应 & 结果质量提升 |
| 3 | **Mermaid / LaTeX 渲染** | `content.tsx` 加 remark-math + mermaid | 1 天 | 文档渲染能力飞跃 |
| 4 | **Frontmatter 编辑面板** | `content.tsx` 新增 YAML 编辑器区域 | 1 天 | 用户可直接编辑元数据 |

### 第二阶段 — 核心差异化 (2 周)

| # | 功能 | 工作量 | 效果 |
|---|---|---|---|
| 5 | **知识图谱可视化** | 4-5 天 | 🔥 核心差异化竞争力 |
| 6 | **content.tsx 组件拆分** | 2 天 | 前端可维护性提升 |
| 7 | **搜索结果页独立** | 1 天 | 搜索体验分离 |
| 8 | **Lint 检查系统** | 1-2 天 | 内容质量保障 |

### 第三阶段 — 进化 (每月)

| # | 功能 | 工作量 |
|---|---|---|
| 9 | RRF 融合搜索 (keyword + vector) | 2-3 天 |
| 10 | 持久化摄入队列 + 项目切换 | 3-4 天 |
| 11 | 源文件级联删除 + wiki 页面级联删除 | 2-3 天 |
| 12 | 页面合并引擎 (Layer 1: 数组字段 union) | 1 天 |
| 13 | Review Sweep 自动清理 | 1-2 天 |
| 14 | 内容清洗 (写入前三步修复) | 0.5 天 |
| 15 | 图洞察 (SurprisingConnections + KnowledgeGaps) | 2 天 |
| 16 | LLM 驱动的 wikilink 自动补全 | 1 天 |
| 17 | 去重缓存 + 重复实体检测与合并 | 2 天 |
| 18 | 嵌入搜索 (需 embedding 服务) | 3 天 |
| 19 | 自动保存 | 1 天 |
| 20 | 页面类型系统 + 前端标签展示 | 1 天 |

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

### llm_wiki 关联评分权重 (待移植)

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

### llm_wiki 前端 GraphView 核心 (待实现)

```tsx
// src/components/graph/graph-view.tsx
import { SigmaContainer, ControlsContainer, ZoomControl } from "@react-sigma/core";
import { useLoadGraph } from "@react-sigma/core";
import "@react-sigma/core/lib/react-sigma.min.css";

function GraphPage({ nodes, edges }) {
  return (
    <SigmaContainer style={{ height: "100vh" }}>
      <LoadGraph nodes={nodes} edges={edges} />
      <ControlsContainer position={"bottom-right"}>
        <ZoomControl />
      </ControlsContainer>
    </SigmaContainer>
  );
}
```

### llm_wiki LLM Ingest 两步提示模板 (待实现)

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

| 维度 | llm_wiki 优势 | xflow 差距 | 建议优先级 |
|---|---|---|---|
| **知识图谱** | 8 模块完整生态 (构建 + 分析 + 渲染) | ❌ 0 行 | 🔴 P0 |
| **LLM 驱动** | 两步思维链 Ingest + 链接补全 (异步队列) | ❌ 0 行 | 🔴 P0 |
| **搜索质量** | RRF + 向量 + Rust + 缓存 | ⚠️ 仅有 token 搜索 | 🔴 P0 |
| **前端组件** | 20+ 模板化组件 | 📝 单文件 680 行 | 🟡 P1 |
| **内容质量** | 双层 Lint (结构化 3 项 + 语义 4 项) | ⚠️ 仅 health_check | 🟡 P1 |
| **摄入队列** | 持久化队列 + 项目隔离 + 自动重试 + 批量入队 | ❌ 无队列 | 🟡 P2 |
| **级联删除** | 源文件级 + wiki 页面级 + 嵌入/媒体清理 | ❌ 基本删除 | 🟡 P2 |
| **页面合并** | 三层层叠 (数组 union → LLM 合并 → 锁定字段) | ❌ 直接覆盖 | 🟡 P2 |
| **Review Sweep** | 两阶段自动清理 (规则 + LLM 语义) | ❌ 无 Review | 🟡 P2 |
| **内容清洗** | 三步修复 (45% LLM 输出有 frontmatter 问题) | ❌ 无 | 🟡 P2 |
| **类型系统** | 8 种类型 + 色块图标 | ❌ 无 type 字段 | 🟡 P2 |
| **去重** | LLM 检测重复实体 + 合并引擎 | ❌ 无 | 🟢 P3 |
| **后端性能** | Rust 原生搜索 | Python glob | 🟢 P3 |
| **自动保存** | 定时自动保存 | ❌ 无 | 🟢 P3 |

**一句话结论**: 第一阶段 (LLM 两步思维链摄入 + 搜索增强 + Mermaid/LaTeX) **2-3 天可上线**；知识图谱是核心差异化竞争力但需 4-5 天集中投入，建议做。摄入队列和级联删除是保证系统可靠性的基础设施，建议与 Ingest 功能同步实现。
