---
name: openyak-workspace
description: Navigate and extend the OpenYak monorepo (Tauri + Next.js + FastAPI); use when editing this repo, adding features, or aligning changes with docs/development and docs/adr.
---

# OpenYak 工作区技能

## 何时使用

- 在本仓库实现或修复功能（前后端、桌面、构建）。
- 需要快速定位权威文档、目录职责或架构决策。
- 用户提到 Agent、工具、Provider、插件、SSE、会话/消息、构建/打包。

## 相关技能

| 场景 | 路径 |
|------|------|
| 后端实现 / 调试 | `.cursor/skills/openyak-backend-dev/SKILL.md` |
| 前端实现 / 调试 | `.cursor/skills/openyak-frontend-dev/SKILL.md` |

## 第一步

1. 读 `.cursor/rules/openyak-workspace.mdc`（单仓地图与 npm 脚本索引）。
2. **专注后端或前端时**：分别配合 `.cursor/skills/openyak-backend-dev/SKILL.md`、`.cursor/skills/openyak-frontend-dev/SKILL.md`（入口文件、文档索引、约定）。
3. 按任务打开 `docs/development/README.md` 中对应章节（如工具 → `07`、API → `05`、构建 → `12`）。
4. 涉及消息模型、路由分层、子进程等跨模块行为时，查 `docs/adr/` 对应 ADR。

## 按层的入口文件

| 层 | 从哪里开始 |
|----|------------|
| 后端 API | `backend/app/api/router.py` → 各 `app/api/*.py` |
| 后端领域 | `backend/app/agent/`、`tool/`、`session/`、`provider/`、`streaming/` |
| 前端路由/UI | `frontend/src/app/`、`frontend/src/components/` |
| 桌面 | `desktop-tauri/src-tauri/src/main.rs`、`tauri.conf.json` |
| 一键构建 | `npm run build:release` 或分项 `build:frontend` / `build:backend` / `build:desktop` |

## 协作原则

- 新 API 路由必须挂到 `api_router`；前端静态导出路径勿破坏 `out/` 生成。
- 改动构建行为时同步检查 `scripts/*.sh` 与根 `package.json`，必要时更新 `docs/development/12-构建与部署.md`。
- Python 依赖与打包问题参考 `backend/requirements.txt`、`openyak.spec` 及现有构建脚本中的环境变量（如 PyInstaller 缓存目录）。

## 可选延伸阅读

- `docs/customizations.md`（若存在）— 项目定制清单。
- `docs/development/10-二次开发实战.md` — 端到端示例。
