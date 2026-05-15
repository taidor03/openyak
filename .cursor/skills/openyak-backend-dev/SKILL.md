---
name: openyak-backend-dev
description: >-
  Implements and debugs OpenYak FastAPI backend features—API routes, agents,
  tools, providers, sessions, streaming/SSE, storage, MCP. Use when editing
  `backend/`, adding endpoints, Python tests, or when the user mentions后端、
  FastAPI、uvicorn、PyInstaller、SQLite、工具、Agent、Provider、会话、流式.
---

# OpenYak 后端开发技能

## 何时使用

- 修改或新增 `backend/app/` 下的 API、业务逻辑、模型、测试。
- 排查 Python 运行时、数据库、SSE/流式、工具执行、Ollama、MCP 相关问题。

## 权威文档（按需深读）

| 主题 | 路径 |
|------|------|
| 总览与结构 | `docs/development/03-后端开发指南.md` |
| REST / SSE | `docs/development/05-API接口文档.md` |
| Agent | `docs/development/06-Agent系统开发.md` |
| 工具 | `docs/development/07-工具系统开发.md` |
| 提供商 | `docs/development/08-提供商集成.md` |
| 路由薄层 | `docs/adr/0007-route-module-thin-api-layer.md` |
| 消息与 Part | `docs/adr/0003-messages-are-parts.md` |

## 入口与关键路径

- **应用工厂**：`backend/app/main.py` → `create_app`
- **配置**：`backend/app/config.py`（Pydantic Settings）
- **路由聚合**：`backend/app/api/router.py` → **新模块必须在 `api_router` 上 `include_router`**
- **典型域目录**：`agent/`、`tool/`（`base.py`、`registry.py`、`builtin/`）、`session/`、`provider/`、`streaming/`、`storage/`、`schemas/`、`models/`
- **依赖与打包**：`backend/requirements.txt`、`backend/pyproject.toml`、`backend/openyak.spec`

## 本地运行（与仓库一致）

- 根目录：`npm run dev:backend`（与根 `package.json` 一致：使用 `cd backend && ./venv/bin/python -m uvicorn ...`）
- 或直接：`cd backend && uvicorn app.main:create_app --factory --reload --reload-dir app --host 0.0.0.0 --port 8000`
- 环境：复制 `backend/.env.example` → `.env`；测试用 `backend/tests/`

## 实现约定

- 优先 **async**；HTTP 层保持薄，复杂逻辑放在对应子包。
- 请求/响应用 **Pydantic v2**（`schemas/`）；持久化用 **SQLAlchemy 2 async**（`models/` + `storage/`）。
- 新增工具：实现 `ToolDefinition`、注册进 `ToolRegistry`；权限与 Agent 映射见 `agent/` 与文档 07。
- 新增对外行为时核对 `05-API接口文档.md`，必要时补 OpenAPI 可读性（类型注解与 schema）。

## 与前端协作

- 前端开发期通常请求 `NEXT_PUBLIC_API_URL`（默认 `http://localhost:8000`）；变更路径或 SSE 事件名时同步前端 `lib/api.ts`、相关 hooks 与类型。

## 全仓上下文

- 单仓地图与构建脚本：`.cursor/rules/openyak-workspace.mdc`、`.cursor/skills/openyak-workspace/SKILL.md`。
