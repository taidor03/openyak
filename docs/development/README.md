# OpenYak 二次开发文档

欢迎使用 OpenYak 二次开发文档。本文档集提供了详细的开发指南，帮助开发者理解、扩展和定制 OpenYak。

## 文档目录

### 入门指南

- **[01-项目概述](./01-项目概述.md)** — 项目简介、核心特性、技术栈、项目结构和快速开始
- **[02-架构设计](./02-架构设计.md)** — 三层架构、核心子系统、数据流、状态管理和安全架构

### 开发指南

- **[03-后端开发指南](./03-后端开发指南.md)** — Python/FastAPI 后端开发环境、项目结构、核心概念和最佳实践
- **[04-前端开发指南](./04-前端开发指南.md)** — Next.js/React 前端开发环境、组件开发、状态管理和样式系统

### API 文档

- **[05-API接口文档](./05-API接口文档.md)** — 完整的 RESTful API 和 SSE 流式接口文档

### 核心系统开发

- **[06-Agent系统开发](./06-Agent系统开发.md)** — Agent 系统架构、内置 Agent、权限系统和自定义 Agent 开发
- **[07-工具系统开发](./07-工具系统开发.md)** — 工具系统架构、24 个内置工具、工具注册和自定义工具开发
- **[08-提供商集成](./08-提供商集成.md)** — LLM 提供商架构、内置提供商、提供商目录和自定义提供商集成

### 配置和部署

- **[09-配置和环境](./09-配置和环境.md)** — 环境变量配置、配置文件、数据库配置和安全配置
- **[12-构建与部署](./12-构建与部署.md)** — 前后端构建、桌面端打包、多平台部署和 CI/CD

### 扩展系统

- **[11-插件与技能系统](./11-插件与技能系统.md)** — Cowork Plugin 架构、技能定义、内置插件和自定义插件开发

### 实战案例

- **[10-二次开发实战](./10-二次开发实战.md)** — 实际开发案例，包括添加工具、Agent、提供商、前端页面等

## 快速导航

### 我想...

#### 了解 OpenYak
从 [项目概述](./01-项目概述.md) 开始，了解 OpenYak 是什么、核心特性和技术栈。

#### 搭建开发环境
参考 [后端开发指南](./03-后端开发指南.md) 和 [前端开发指南](./04-前端开发指南.md) 搭建开发环境。

#### 添加新工具
阅读 [工具系统开发](./07-工具系统开发.md) 了解如何创建和注册自定义工具。

#### 添加新 Agent
阅读 [Agent 系统开发](./06-Agent系统开发.md) 了解如何创建自定义 Agent。

#### 集成新 LLM 提供商
阅读 [提供商集成](./08-提供商集成.md) 了解如何集成自定义 LLM 提供商。

#### 创建领域插件
阅读 [插件与技能系统](./11-插件与技能系统.md) 了解如何创建自定义插件和技能。

#### 调用 API
查看 [API接口文档](./05-API接口文档.md) 了解所有可用的 API 端点。

#### 配置生产环境
参考 [配置和环境](./09-配置和环境.md) 和 [构建与部署](./12-构建与部署.md)。

#### 查看实战案例
阅读 [二次开发实战](./10-二次开发实战.md) 学习实际开发案例。

## 技术栈概览

### 后端
- **语言**: Python 3.12+
- **框架**: FastAPI (async ASGI)
- **数据库**: SQLite (WAL mode)
- **ORM**: SQLAlchemy 2.0+ (async)
- **验证**: Pydantic v2
- **LLM SDK**: OpenAI, Anthropic, Google GenAI

### 前端
- **框架**: Next.js 15 (App Router + Turbopack)
- **语言**: TypeScript 5.7
- **UI 库**: React 19
- **样式**: Tailwind CSS 4 + CSS 变量主题
- **组件**: shadcn/ui (Radix UI)
- **状态**: Zustand 5 (客户端) + TanStack Query 5 (服务端)
- **动画**: Framer Motion

### 桌面
- **框架**: Tauri v2
- **语言**: Rust

## 核心概念

### Agent（智能体）
Agent 是 OpenYak 的核心执行单元，每个 agent 有独立的 system prompt、工具权限和工具列表。7 个内置 agent：build/plan/explore/general/compaction/title/summary。

### Tool（工具）
工具是 agent 执行具体操作的接口，每个工具继承 `ToolDefinition` 基类。24 个内置工具覆盖文件操作、搜索、执行、交互、网络等场景。

### Provider（提供商）
Provider 是 LLM 服务的抽象层，支持 21 个 BYOK 提供商 + Ollama 本地 + ChatGPT 订阅。

### Session（会话）
Session 是对话的容器，消息以 Message + Part 两级结构存储，支持无限滚动分页和上下文压缩。

### Plugin（插件）
插件是领域专用功能包，包含技能（SKILL.md）、参考文档和脚本，可通过 API 安装/启用。

### Artifact（工件）
Artifact 是可复用的内容块，支持 Markdown、代码、Mermaid 流程图、表格、文档预览。

## 开发流程

### 1. 环境准备
```bash
git clone https://github.com/openyak/openyak.git
cd openyak
npm install
cd backend && pip install -e ".[dev]" && cd ..
```

### 2. 启动开发
```bash
npm run dev:all
# 后端: http://localhost:8000
# 前端: http://localhost:3000
```

### 3. 开发 & 测试
```bash
# 后端测试
cd backend && pytest

# 前端类型检查
cd frontend && npx tsc --noEmit

# 前端 E2E
cd frontend && npx playwright test
```

### 4. 构建
```bash
npm run build:frontend  # 前端
npm run build:backend   # 后端
npm run build:desktop   # 桌面端
```

## 贡献指南

### 代码规范
- **前端**: Functional components + hooks，Tailwind CSS + CSS 变量
- **后端**: Async everywhere，Pydantic v2，SQLAlchemy async ORM
- **通用**: Conventional Commits，小而聚焦的 PR

### 提交规范
```
<type>(<scope>): <description>

Types: fix, feat, refactor, docs, test, chore, perf
Scopes: frontend, backend, desktop, ollama, mcp, plugin
```

## 相关资源

- **GitHub**: https://github.com/openyak/openyak
- **官网**: https://open-yak.com
- **讨论区**: https://github.com/openyak/openyak/discussions
- **问题反馈**: https://github.com/openyak/openyak/issues
- **设计系统**: [DESIGN.md](../../DESIGN.md)
- **贡献指南**: [CONTRIBUTING.md](../../CONTRIBUTING.md)

## 许可证

MIT License

---

**最后更新**: 2026年5月
