# OpenYak API 接口文档

## 概述

OpenYak 后端提供 RESTful API 和 SSE 流式接口。API 基于 FastAPI 构建，自动生成 OpenAPI 文档。

**Base URL**: `http://localhost:8000`

**OpenAPI 文档**: `http://localhost:8000/docs`（Swagger UI）

**认证方式**：
- 本地：Session Token（自动生成，存储在 `data/session_token.txt`）
- 远程：JWT Token（Cloudflare Tunnel + Authorization header）

## 聊天接口

### 开始生成

**POST** `/api/chat/prompt`

开始新的对话生成，返回 stream_id 用于 SSE 订阅。

**请求体**：

```json
{
  "text": "用户输入文本",
  "session_id": "可选，已有会话ID",
  "model": "anthropic/claude-sonnet-4",
  "agent": "build",
  "files": [
    {
      "path": "/path/to/file.txt",
      "content": "文件内容（base64 或文本）"
    }
  ]
}
```

**响应**：

```json
{
  "stream_id": "01JQKDCKS5Z5ZEN0FEDC0Y3ZQ0",
  "session_id": "01JQKDCKR8MZ3N0GJXHPKVAT5W"
}
```

### SSE 流式传输

**GET** `/api/chat/stream/{stream_id}`

订阅 SSE 事件流，接收实时生成内容。

**查询参数**：
- `last_event_id`: 断线重连时使用

**SSE 事件类型**：

| 事件 | 说明 | 数据格式 |
|------|------|----------|
| `step_start` | 步骤开始 | `{"step": 1, "model": "..."}` |
| `text_delta` | 文本增量 | `{"text": "..."}` |
| `reasoning_delta` | 推理增量 | `{"text": "..."}` |
| `tool_start` | 工具开始 | `{"tool": "read", "args": {...}, "call_id": "..."}` |
| `tool_result` | 工具结果 | `{"tool": "read", "output": "...", "call_id": "..."}` |
| `tool_error` | 工具错误 | `{"tool": "read", "error": "...", "call_id": "..."}` |
| `step_finish` | 步骤完成 | `{"step": 1, "tokens_in": 100, "tokens_out": 50, "cost": 0.01}` |
| `permission_request` | 权限请求 | `{"tool": "bash", "args": {...}, "call_id": "..."}` |
| `question` | 问题提示 | `{"question": "...", "options": [...]}` |
| `compaction_start` | 压缩开始 | `{}` |
| `compaction_finish` | 压缩完成 | `{}` |
| `model_loading` | 模型加载中 | `{"model": "..."}` |
| `retry` | 重试 | `{"attempt": 2, "delay": 4}` |
| `agent_error` | Agent 异常 | `{"error": "..."}` |
| `done` | 生成完成 | `{"session_id": "..."}` |
| `error` | 错误 | `{"error": "..."}` |

**示例**：

```bash
curl -N http://localhost:8000/api/chat/stream/01JQKDCKS5Z5ZEN0FEDC0Y3ZQ0
```

### 编辑消息

**POST** `/api/chat/edit`

编辑用户消息，删除后续消息并重新生成。

**请求体**：

```json
{
  "session_id": "会话ID",
  "message_id": "消息ID",
  "new_text": "修改后的文本"
}
```

### 中止生成

**POST** `/api/chat/abort`

中止当前正在进行的生成。

**请求体**：

```json
{
  "stream_id": "流ID"
}
```

### 活跃任务

**GET** `/api/chat/active`

获取当前活跃的生成任务列表。

### 回复交互

**POST** `/api/chat/respond`

回复权限请求或问题提示。

**请求体**：

```json
{
  "stream_id": "流ID",
  "response": "allow",
  "tool_call_id": "工具调用ID（可选）"
}
```

## 会话接口

### 列出会话

**GET** `/api/sessions`

**查询参数**：`limit`, `offset`

### 创建会话

**POST** `/api/sessions`

**请求体**：
```json
{
  "title": "会话标题",
  "model": "anthropic/claude-sonnet-4",
  "agent": "build"
}
```

### 获取会话

**GET** `/api/sessions/{id}`

### 更新会话

**PATCH** `/api/sessions/{id}`

### 删除会话

**DELETE** `/api/sessions/{id}`

### 搜索会话

**GET** `/api/sessions/search?q=关键词`

### 导出 PDF

**GET** `/api/sessions/{id}/export-pdf`

## 消息接口

### 获取消息

**GET** `/api/messages/{session_id}`

**查询参数**：
- `offset`: 分页偏移（-1 为最新页）
- `limit`: 每页数量

**响应**：

```json
{
  "messages": [
    {
      "id": "ulid",
      "role": "user",
      "created_at": "2024-01-01T00:00:00Z",
      "data": {},
      "parts": [
        {
          "id": "ulid",
          "type": "text",
          "data": {"content": "用户消息"},
          "sort_order": 0
        }
      ]
    },
    {
      "id": "ulid",
      "role": "assistant",
      "created_at": "2024-01-01T00:00:00Z",
      "data": {},
      "parts": [
        {
          "id": "ulid",
          "type": "text",
          "data": {"content": "助手回复"},
          "sort_order": 0
        },
        {
          "id": "ulid",
          "type": "tool",
          "data": {
            "tool": "read",
            "input": {"path": "/tmp/test.txt"},
            "output": "file contents...",
            "state": "completed",
            "call_id": "call_abc123"
          },
          "sort_order": 1
        }
      ]
    }
  ],
  "total": 87,
  "next_offset": 50
}
```

## Agent 接口

### 列出 Agent

**GET** `/api/agents`

返回所有可用的 agent（primary + subagent 模式）。

## 模型接口

### 列出模型

**GET** `/api/models`

返回所有已配置提供商的可用模型。

**响应**：

```json
{
  "models": [
    {
      "id": "anthropic/claude-sonnet-4",
      "name": "Claude Sonnet 4",
      "provider": "openrouter",
      "context_window": 200000,
      "capabilities": {
        "vision": true,
        "reasoning": true
      },
      "pricing": {
        "input": 3.0,
        "output": 15.0
      }
    }
  ]
}
```

### Provider 模型

**GET** `/api/models/{provider_id}`

获取特定提供商的模型列表。

## 工具接口

### 列出工具

**GET** `/api/tools`

返回所有已注册的工具。

## 技能接口

### 列出技能

**GET** `/api/skills`

返回所有已启用的技能。

## 文件接口

### 上传文件

**POST** `/api/files/upload`

**请求**：`multipart/form-data`

| 字段 | 类型 | 说明 |
|------|------|------|
| file | File | 文件 |
| session_id | string | 会话ID（可选） |

## 配置接口

### 获取配置

**GET** `/api/config`

### 更新配置

**POST** `/api/config`

## 用量接口

### 获取用量

**GET** `/api/usage`

返回 token 用量和成本统计。

## Ollama 接口

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/ollama/status` | GET | Ollama 运行状态 |
| `/api/ollama/setup` | POST | 下载安装 Ollama |
| `/api/ollama/start` | POST | 启动 Ollama 服务 |
| `/api/ollama/stop` | POST | 停止 Ollama 服务 |
| `/api/ollama/models` | GET | 已安装模型列表 |
| `/api/ollama/models/library` | GET | 模型库浏览 |
| `/api/ollama/models/pull` | POST | 下载模型 |
| `/api/ollama/models/{name}` | DELETE | 删除模型 |
| `/api/ollama/uninstall` | DELETE | 卸载 Ollama |

## 记忆接口

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/memory` | GET | 获取所有记忆 |
| `/api/memory/facts` | POST | 添加事实 |
| `/api/memory/facts` | DELETE | 删除事实 |
| `/api/memory/context` | PUT | 更新上下文 |
| `/api/memory/config` | GET | 获取记忆配置 |
| `/api/memory/config` | PUT | 更新记忆配置 |

## 工作区记忆接口

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/workspace-memory` | GET | 获取工作区记忆 |
| `/api/workspace-memory` | PUT | 更新工作区记忆 |

## 自动化接口

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/automations` | GET | 列出自动化任务 |
| `/api/automations` | POST | 创建自动化 |
| `/api/automations/{id}` | GET | 获取详情 |
| `/api/automations/{id}` | PATCH | 更新 |
| `/api/automations/{id}` | DELETE | 删除 |
| `/api/automations/{id}/trigger` | POST | 手动触发 |
| `/api/automations/templates` | GET | 模板列表 |
| `/api/automations/from-template` | POST | 从模板创建 |

## 连接器接口（MCP）

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/connectors` | GET | 列出连接器 |
| `/api/connectors/{id}` | GET | 获取详情 |
| `/api/connectors/{id}/reconnect` | POST | 重连 |

## 插件接口

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/plugins` | GET | 列出插件 |
| `/api/plugins/{id}/enable` | POST | 启用 |
| `/api/plugins/{id}/disable` | POST | 禁用 |
| `/api/plugins/install` | POST | 安装 |
| `/api/plugins/{id}` | DELETE | 卸载 |

## 通道接口

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/channels` | GET | 列出 IM 通道 |
| `/api/channels/{id}` | GET | 通道详情 |

## 远程访问接口

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/remote/status` | GET | 隧道状态 |
| `/api/remote/start` | POST | 启动隧道 |
| `/api/remote/stop` | POST | 停止隧道 |

## FTS 搜索接口

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/fts/status` | GET | 索引状态 |
| `/api/fts/search` | GET | 全文搜索 |
| `/api/fts/reindex` | POST | 重建索引 |

## Artifact 接口

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/artifacts` | GET | 列出 artifacts |
| `/api/artifacts/{id}` | GET | 获取详情 |

## PDF 接口

**POST** `/api/pdf/generate`

生成 PDF 文件。

## 认证接口

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/openai-auth/url` | GET | ChatGPT OAuth 授权 URL |
| `/api/openai-auth/callback` | GET | OAuth 回调 |
| `/api/google-auth/url` | GET | Google OAuth 授权 URL |
| `/api/google-auth/callback` | GET | OAuth 回调 |

## 健康检查

**GET** `/health`

```json
{
  "status": "healthy",
  "version": "1.1.9"
}
```

## 错误处理

所有 API 在出错时返回：

```json
{
  "error": "错误描述",
  "detail": "详细错误信息"
}
```

**HTTP 状态码**：

| 状态码 | 说明 |
|--------|------|
| 200 | 成功 |
| 400 | 请求参数错误 |
| 401 | 未认证 |
| 403 | 权限不足 |
| 404 | 资源不存在 |
| 500 | 服务器错误 |

## 相关文档

- [后端开发指南](./03-后端开发指南.md)
- [前端开发指南](./04-前端开发指南.md)
- [架构设计](./02-架构设计.md)
