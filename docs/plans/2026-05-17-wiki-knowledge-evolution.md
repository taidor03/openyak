# Wiki Knowledge Center — 知识演化机制优化方案

> **状态：Phase 1-3 + 前端重构 全部完成**
>
> 基于 Karpathy LLM Wiki 原始设计文档 + nashsu/llm_wiki 实现深度研究

## 一、问题诊断

### 现状（已全部修复）

|| 问题 | 表现 | 根因 | 修复方案 |
|------|------|------|------|------|
| **重复写入** | 同标题页面被创建多次 | `write_page` 不做去重 | ✅ 同标题去重 + 先读后写 |
| **覆盖丢失** | 更新已有页面时旧内容被整体替换 | 没有合并，只有覆盖 | ✅ `merge` action + section 级合并 |
| **无审核** | LLM 自行决定写什么，用户事后才发现 | 缺少确认机制 | ✅ 先读后写（force=false 默认返回已有内容） |
| **触发失控** | LLM 每次对话都自动写入 | write action 缺乏约束 | ✅ WRITE POLICY 提示词 + 系统提示约束 |
| **无消化流程** | 原始资料无法系统化地融入知识网络 | 没有 Ingest 流程 | ✅ `ingest` action + 源文档结构化页面 |
| **无巡检** | 知识库逐渐腐化（孤儿、断链、过时） | 没有 Lint 机制 | ✅ `lint` action + 孤儿/断链/过时检测 |

### llm_wiki 的核心设计思想

Karpathy 的 LLM Wiki 不是一个"带搜索的笔记系统"，而是一个**知识编译器**：

> "The tedious part of maintaining a knowledge base is not the reading or the thinking — it's the bookkeeping. LLMs don't get bored, don't forget to update a cross-reference, and can touch 15 files in one pass."

nashsu/llm_wiki 的实现提供了 5 个关键机制，以及 OpenYak 的对应实现：

|| llm_wiki 机制 | OpenYak 对应实现 | 差异说明 |
|----------------|-----------------|----------|
| 三层分离（Raw → Wiki → Schema） | `sources/` + 其他 categories | OpenYak 简化为单层 Wiki，sources 页面同时包含原始内容和提取结果 |
| Ingest（摄入） | `ingest` action | ✅ 完整实现。LLM 调用 ingest 创建源页面，然后自行提取实体/概念 |
| Page Merge（页面合并） | LLM 语义合并（需二次 LLM 调用） | ✅ 纯算法 section 合并 + 先读后写让 LLM 自行合并，避免 tool 层 LLM 调用 |
| Save to Wiki（手动保存） | 用户点击 "Save" 按钮 | ✅ 前端 "Merge & Save" 按钮，用户主动触发 |
| Lint（巡检） | LLM 定期检查 | ✅ 纯算法巡检（孤儿/断链/过时/空分类），LLM 按需调用 |

---

## 二、已实现的完整方案

### 1. Write 策略——先读后写

**核心机制**: 当 LLM 调用 `write` 写入已有页面时，不是直接覆盖，而是返回已有内容让 LLM 审阅。

**流程:**

```
LLM 调用 write(title, content, force=false)
        ↓
write_page 检测到已有页面
        ↓
返回 exists=true + 已有内容预览（前 2000 字符，已去除 frontmatter）
+ 提示 LLM 选择 merge 或 force write
        ↓
LLM 选择：
  ├── 方案 A（推荐）：调用 merge(title, new_sections, category)
  │   → 纯算法 section 级合并
  │   → 匹配 heading 替换，新 heading 追加
  │   └── 方案 B：准备完整合并内容 → 调用 write(title, merged_content, force=true)
```

**为什么不在 tool 层做 LLM 语义合并（像 llm_wiki 那样）？**

llm_wiki 的 `page-merge` 需要在 tool 执行中再发起 LLM 调用，在 OpenYak 架构下会导致：
- 延迟增加（多一次 LLM 往返）
- 成本增加
- 上下文窗口占用
- 工具执行超时风险

**替代方案**：让 LLM 自己做合并推理。先读后写模式天然地把合并决策推给 LLM，而 `merge` action 提供了一个无需推理的快速路径（纯算法合并），LLM 可以根据场景选择。

### 2. Merge Action——Section 级合并

**算法核心** (`cleanup.py` → `merge_sections`):

```
输入：existing_body（已有页面正文）, new_sections_text（新增/修改的 sections）

1. parse_sections(existing_body)  → [(heading, content, level), ...]
2. parse_sections(new_sections_text)  → [(heading, content, level), ...]
3. 用 normalize_wiki_ref_key 做 heading 匹配（大小写/空格/连字符无关）
4. 匹配到的 heading → 替换（保留原始位置 + 保留原始标题层级）
5. 未匹配的 heading → 追加到末尾（使用自身标题层级）
6. Preamble（第一个 ## 前的内容）始终从已有页面保留
```

**示例:**

已有页面：
```markdown
This is the preamble.

## Overview
Old overview content.

## Performance
Some performance data.
```

Merge 传入：
```markdown
## Overview
Updated overview with new info.

## Limitations
New section about limitations.
```

合并结果：
```markdown
This is the preamble.

## Overview
Updated overview with new info.

## Performance
Some performance data.

## Limitations
New section about limitations.
```

### 3. Ingest 摄入流程

**流程:**

```
LLM 调用 ingest(source_name, source, purpose)
        ↓
在 sources/ 目录创建结构化源页面
（包含 Source 元信息 + Content + Key Entities/Concepts 占位）
        ↓
追加 log.md 条目
        ↓
返回结果 + 提示 LLM 后续步骤：
  1. 读取源页面，提取关键实体 → 创建 entity 页面
  2. 提取关键概念 → 创建 concept 页面
  3. 添加 [[wikilinks]] 交叉引用
  4. 更新源页面的 Key Entities 和 Key Concepts sections
```

**关键设计决策**: Ingest 只做"存储"不做"提取"。提取实体/概念由 LLM 在后续 tool 调用中完成。这避免了在 tool 中发起二次 LLM 调用，同时让 LLM 对提取结果有完全控制权。

**purpose 参数**用于标记源文档类型，供 LLM 在后续提取时参考：

| purpose | 含义 |
|---------|------|
| `general` | 一般资料 |
| `research` | 研究论文/报告 |
| `reference` | 参考文档/手册 |
| `tutorial` | 教程/指南 |

### 4. Lint 巡检机制

**当前实现的检查项**（纯算法，不需要 LLM）：

| 检查项 | 检测逻辑 | 严重性 |
|--------|----------|--------|
| 孤儿页面 | 扫描所有 wikilink，统计入链数 = 0 的页面 | info |
| 断链 | `[[wikilink]]` 引用的目标页面不存在 | warning |
| 过时页面 | `updated` 时间戳超过 30 天 | info |
| 空分类 | 分类目录下没有 .md 文件 | info |

**返回结果结构:**

```json
{
  "issues": [...],
  "total_issues": 5,
  "warnings": 1,
  "healthy": false,
  "pages_checked": 12,
  "summary": {
    "orphans": 2,
    "broken_links": 1,
    "stale": 1,
    "empty_categories": 1
  }
}
```

**未实现的检查项**（需要 LLM 语义理解，暂不实现）：

| 检查项 | 说明 | 实现难度 |
|--------|------|----------|
| 矛盾检测 | 两个页面说矛盾的事实 | 高（需要 LLM 语义理解） |
| 重复检测 | 同一知识在多个页面重复 | 中（可基于向量相似度） |

### 5. Log.md 审计日志

每次写入/合并/摄入操作自动追加到 `{wiki_root}/log.md`：

```markdown
# Wiki Log

A chronological record of wiki mutations.

## [2026-05-17] create | OpenYak MCP Config
- Category: concepts

## [2026-05-17] merge | KV Cache
- Category: concepts

## [2026-05-17] ingest | Transformer Architecture
- Category: sources
```

### 6. 前端编辑器重构

**从左右分栏改为一体式编辑/预览切换：**

| 之前 | 之后 |
|------|------|
| 左右 50/50 分栏（textarea + preview） | 一体式面板，右上角切换 |
| 编辑和预览同时可见 | 编辑/预览互斥显示 |
| 保存按钮统一样式 | 编辑已有页面显示 "Merge & Save"（主按钮）+ "Overwrite"（次按钮），新建显示 "Save" |

**Edit/Preview 切换器**: segmented control 样式，带 `Code2`（编辑）和 `Eye`（预览）图标，当前激活项有高亮背景。

**预览模式**: 自动去除 YAML frontmatter，用户看到的是纯净的 Markdown 渲染结果。

**默认分类**: 新建页面默认选择 "entities"（与后端 `write_page` 默认值一致）。

### 7. System Prompt 约束

在 `_environment_section` 中注入完整的 Write Policy，包括：
- 禁止自动写入对话摘要
- 必须先搜索再写入
- 已有页面必须选择 merge 或 force write
- 不允许不审阅就 force overwrite
- 推荐 merge 作为首选更新方式

---

## 三、完整文件改动清单

### 后端

| 文件 | 新增方法/功能 |
|------|---------------|
| `backend/app/wiki/cleanup.py` | `parse_sections()`, `merge_sections()` |
| `backend/app/wiki/service.py` | `find_page_by_title()`, `write_page(force=)`, `merge_page()`, `append_log()`, `ingest_source()`, `lint_wiki()` |
| `backend/app/wiki/tool.py` | `merge`, `ingest`, `lint` actions + `force`/`source_name`/`source`/`purpose` 参数 + WRITE POLICY |
| `backend/app/api/wiki.py` | `WikiMergeRequest`, `WikiIngestRequest` 模型 + `/merge`, `/ingest`, `/lint` 端点 + `force` 字段 |
| `backend/app/session/system_prompt.py` | Wiki Knowledge Center 章节完整 Write Policy |

### 前端

| 文件 | 改动 |
|------|------|
| `frontend/src/app/(main)/knowledge/content.tsx` | 一体式编辑器 + Edit/Preview 切换 + Merge & Save + force API 适配 |
| `frontend/src/i18n/locales/zh/common.json` | mergeSave, mergeSaveTooltip, pageMerged, mergeFailed |
| `frontend/src/i18n/locales/en/common.json` | mergeSave, mergeSaveTooltip, pageMerged, mergeFailed |

---

## 四、完整 API 端点清单

| 方法 | 路径 | 描述 | 请求体 |
|------|------|------|--------|
| GET | /api/wiki/status | Wiki 状态 | — |
| POST | /api/wiki/initialize | 初始化 Wiki | — |
| GET | /api/wiki/pages | 列出页面 | — |
| GET | /api/wiki/pages/{page_id} | 读取页面 | — |
| POST | /api/wiki/pages | 写入页面 | WikiWriteRequest |
| POST | /api/wiki/merge | Section 合并 | WikiMergeRequest |
| POST | /api/wiki/ingest | 源文档摄入 | WikiIngestRequest |
| GET | /api/wiki/lint | 健康巡检 | — |
| DELETE | /api/wiki/pages/{page_id} | 删除页面 | — |
| POST | /api/wiki/search | 搜索 Wiki | WikiSearchRequest |
| GET | /api/wiki/duplicates | 查找重复 | — |
| POST | /api/wiki/deduplicate | 自动去重 | — |

---

## 五、Wiki Tool Actions 完整清单

| Action | 描述 | 关键参数 | LLM 调用场景 |
|--------|------|----------|---------------|
| `status` | Wiki 状态 | — | 了解知识库概况 |
| `search` | 搜索页面 | query, max_results | 写入前查重 / 查找知识 |
| `list` | 列出页面 | category | 浏览知识库 |
| `read` | 读取页面 | page_id / title | 查看具体页面内容 |
| `write` | 写入页面 | title, content, category, **force** | 新建页面 / 确认后覆盖 |
| `merge` | Section 级合并 | title, content, category | 更新已有页面（推荐） |
| `ingest` | 源文档摄入 | source_name, source, purpose | 系统化知识摄入 |
| `lint` | 健康巡检 | — | 定期检查知识库健康 |
| `delete` | 删除页面 | page_id | 删除过时/错误页面 |

---

## 六、未来优化方向

以下功能当前未实现，可作为后续迭代方向：

| 优先级 | 功能 | 说明 |
|--------|------|------|
| P2 | 前端拖拽 Ingest | 支持用户直接拖拽文件到知识中心触发摄入 |
| P2 | Review 审批 UI | Lint 结果生成 Review Items，前端展示审批界面 |
| P3 | 矛盾检测 | LLM 语义理解，检测两个页面的矛盾事实 |
| P3 | 向量搜索 | 对 wiki 页面做 embedding，支持语义搜索 |
| P3 | 自动 Ingest | 监控 workspace 目录，新文件自动触发摄入提示 |
