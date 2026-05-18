# Xflow Desktop 定制开发文档

> 本目录记录了基于 OpenYak 上游的所有定制开发内容，用于在新版本 OpenYak 基础上精准重新实现。

---

## 文档索引

| 编号 | 文档 | 定制编号 | 核心内容 |
|------|------|---------|---------|
| 01 | [内容工作台与 Xflow 集成](./01-内容工作台与Xflow集成.md) | XFLOW-001~004 | 内容管理页面、Xflow API 客户端、后端工具、.cursor 规则/技能 |
| 02 | [会话管理与 UI 增强](./02-会话管理与UI增强.md) | XFLOW-008, 009, 013 | 归档视图、快速新建、会话缓存、活跃生成指示、侧边栏导航 |
| 03 | [MCP 连接器管理](./03-MCP连接器管理.md) | XFLOW-015 | MCP 管理页、动态配置热重载、headers 支持、后台连接 |
| 04 | [后端启动状态指示器](./04-后端启动状态指示器.md) | XFLOW-014 | 启动指示器、Context Provider、Tauri IPC 事件驱动 |
| 05 | [数据持久化与缓存策略](./05-数据持久化与缓存策略.md) | — | TanStack Query 持久化、会话缓存、乐观更新 |
| 06 | [知识中心 Wiki 服务](./06-知识中心Wiki服务.md) | — | WikiService、WikiTool、前端知识中心 |
| 07 | [构建配置与插件精简](./07-构建配置与插件精简.md) | XFLOW-005, 006, 016 | Tauri 构建、连接器精简、插件删除、端口/语言配置 |
| 08 | [Provider 与模型管理](./08-Provider与模型管理.md) | XFLOW-007, 012 | model_ids 支持、Provider/Model 本地缓存、自动检测优化 |
| 09 | [项目级技能发现与使用](./09-项目级技能发现与使用.md) | XFLOW-017 | workspace_path 技能发现、CRUD 端点、agent 来源、活动面板/推理行技能展示 |

---

## Commit 来源映射

以下为 `c66a041` 之后所有 commit 与文档的映射关系（❌ 标记为 bug 修复，不写入文档）：

| Commit | 提交信息 | 映射文档 | 类型 |
|--------|---------|---------|------|
| `a7d6ac4` | 调整忽略文件 | 07 | chore |
| `5e82ad0` | feat: 实施 xflow 定制功能（XFLOW-001 ~ XFLOW-012） | 01, 02, 07, 08 | feat |
| `0a1400a` | feat(XFLOW-013): 会话列表本地缓存 | 02, 05 | feat |
| `f756ad9` | feat: 内置四个零配置 MCP | 03 | feat |
| `d4384fe` | feat(XFLOW-014): 后端启动状态指示器 | 04 | feat |
| `7ac0fab` | feat(XFLOW-015): MCP 管理页 + 动态配置热重载 | 03 | feat |
| `54f4420` | chore: 精简内置连接器与插件 | 07 | chore |
| `6098791` | ❌ fix: 修复 CSP 图片源限制 & 启动指示器切页重复显示 | — | fix |
| `7e33620` | chore: 同步本地构建配置 | 07 | chore |
| `4ac128b` | feat: MCP 服务器配置新增 headers 字段支持 | 03 | feat |
| `e471750` | feat: TanStack Query 持久化到 localStorage | 05 | feat |
| `30c6d38` | refactor: 后端启动指示器重构为 Context Provider + /livez | 04 | refactor |
| `d32de62` | feat: 桌面端启动流程优化 — 窗口先显示 + IPC 就绪通知 | 04 | feat |
| `e7b9a87` | refactor: 移除 open-websearch 内置 MCP | 03 | refactor |
| `f71e07c` | perf: 后端 MCP 连接移至后台任务 | 03 | perf |
| `8d7f6b1` | refactor: 移除全部内置 MCP | 03 | refactor |
| `ad7a8c2` | ❌ chore: 删除 superpowers 插件（上游已默认不内置） | — | chore |
| `2f64ef0` | feat: Knowledge Hub + 消息轮询重构 | 06 | feat |
| `2f95df7` | feat: Knowledge Hub 前端 + 消息缓存 + Wiki 后端 | 06 | feat |
| `38edce7` | feat: AI 记忆增强 + 任务完成 + 活跃生成指示 + SSE 增强 | 02 | feat |
| `70362fc` | docs: Wiki 文件 + 循环检测只读工具阈值放宽 | 06 | docs/feat |
| `e7eee89` | fix: 循环检测强制 stop + SSE 空闲恢复快速路径 + 心跳循环安全 | 02 | fix/feat |
| `d89ab3e` | refactor: 延迟创建 assistant message + 清理孤儿 + SSE 立即完成 | — | refactor |

---

## 重新实现优先级建议

基于新版本 OpenYak 重新实现时，建议按以下优先级执行：

### P0 — 核心框架层（先行）
1. **07 - 构建配置**：端口、语言、签名、构建命令 → 确保能构建
2. **05 - 数据持久化**：TanStack Query 持久化 + 乐观更新 → 冷启动体验基础

### P1 — 功能层
3. **08 - Provider 与模型管理**：model_ids + 缓存 → 模型选择体验
4. **04 - 后端启动指示器**：Rust + IPC + Provider → 桌面端核心体验
5. **03 - MCP 管理**：管理页 + 热重载 + 后台连接 → AI 能力基础
6. **02 - 会话管理**：缓存 + 归档 + 活跃生成指示 → 日常使用

### P2 — 业务层
7. **01 - 内容工作台**：Xflow 集成 → 业务核心
8. **06 - 知识中心**：Wiki 服务 → 知识管理
9. **09 - 项目级技能发现**：workspace_path 发现 + CRUD + 活动面板展示 → AI 能力扩展

---

## 定制开发统计

| 指标 | 数值 |
|------|------|
| 总 Commit 数 | 23 |
| 定制开发 Commit | 21（排除 2 个：6098791 CSP 修复 + ad7a8c2 superpowers 清理） |
| 涉及文件数 | 303 |
| 新增代码行 | ~12,155 |
| 删除代码行 | ~36,825（主要为插件精简） |
| 文档数量 | 9 |
| XFLOW 定制编号 | XFLOW-001 ~ XFLOW-017 |
