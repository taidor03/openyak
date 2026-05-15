# Superpowers MPC 集成指南

## 📋 概述

本指南详细介绍如何在 OpenYak 中集成 Superpowers MPC 实时协作链接器。

## 🎯 集成方案

### 成熟稳定的三步走方案

1. **下载并准备 Superpowers MPC** - 通过 npm 安装
2. **配置 MCP 连接器** - 通过 API 或配置文件
3. **启用并验证集成** - 使用提供的管理脚本

## 🚀 快速开始

### 方式一：使用自动化脚本（推荐）

```bash
# 1. 克隆脚本
cd /path/to/openyak
chmod +x scripts/install_superpowers_mcp.sh

# 2. 运行安装脚本
./scripts/install_superpowers_mcp.sh

# 3. 配置环境变量
export SUPERPOWERS_API_KEY='your-api-key-here'
export WORKSPACE_DIR='/path/to/workspace'

# 4. 添加连接器
python scripts/add_superpowers_connector.py

# 5. 启用连接器
python scripts/enable_superpowers.py

# 6. 检查状态
python scripts/check_superpowers_status.py
```

### 方式二：手动集成

#### Step 1: 安装 Superpowers MCP Server

```bash
# 创建目录
mkdir -p plugins/superpowers-mcp/bin
cd plugins/superpowers-mcp

# 安装
npm init -y
npm install @superpowers/mcp-server

# 复制可执行文件
cp node_modules/@superpowers/mcp-server/bin/mcp-server.js bin/
```

#### Step 2: 创建配置文件

```json
// plugins/superpowers-mcp/config.json
{
  "name": "superpowers-mcp",
  "version": "1.0.0",
  "description": "Superpowers MPC 实时协作链接器",
  "type": "local",
  "command": ["node", "plugins/superpowers-mcp/bin/mcp-server.js"],
  "environment": {
    "SUPERPOWERS_API_KEY": "${SUPERPOWERS_API_KEY}",
    "WORKSPACE_DIR": "${WORKSPACE_DIR}"
  },
  "timeout": 60
}
```

#### Step 3: 通过 API 添加连接器

```bash
curl -X POST http://localhost:8000/api/connectors \
  -H "Content-Type: application/json" \
  -d '{
    "id": "superpowers-mcp",
    "name": "Superpowers MPC",
    "url": "http://localhost:3001/mcp",
    "description": "Superpowers MPC 实时协作链接器",
    "category": "collaboration",
    "type": "remote"
  }'
```

#### Step 4: 启用连接器

```bash
curl -X POST http://localhost:8000/api/connectors/superpowers-mcp/enable
```

## 📊 管理命令

### 查看状态

```bash
# 使用 Python 脚本
python scripts/check_superpowers_status.py

# 或使用 API
curl http://localhost:8000/api/connectors | jq '.connectors["superpowers-mcp"]'
```

### 启用/禁用

```bash
# 启用
curl -X POST http://localhost:8000/api/connectors/superpowers-mcp/enable

# 禁用
curl -X POST http://localhost:8000/api/connectors/superpowers-mcp/disable
```

### 删除

```bash
curl -X DELETE http://localhost:8000/api/connectors/superpowers-mcp
```

## 🔧 配置说明

### 环境变量

| 变量名 | 说明 | 是否必需 |
|--------|------|---------|
| `SUPERPOWERS_API_KEY` | Superpowers API 密钥 | 是 |
| `WORKSPACE_DIR` | 工作区目录路径 | 否 |

### 配置文件

```json
{
  "name": "superpowers-mcp",           // 连接器名称
  "version": "1.0.0",                  // 版本号
  "description": "Superpowers MPC...", // 描述
  "type": "local",                     // 类型：local 或 remote
  "command": [...],                    // 启动命令（local 类型）
  "environment": {...},                // 环境变量
  "timeout": 60                        // 超时时间（秒）
}
```

## ✅ 验证清单

### 安装验证

- [ ] Superpowers MCP Server 已下载到 `plugins/superpowers-mcp/bin/`
- [ ] 配置文件 `config.json` 已创建
- [ ] 环境变量 `SUPERPOWERS_API_KEY` 已设置

### API 验证

- [ ] 连接器已通过 API 添加
- [ ] 连接器状态为 `enabled: true`

### 运行时验证

- [ ] 连接器状态为 `connected: true`
- [ ] 工具数量 > 0
- [ ] 无错误信息

### 功能验证

- [ ] 可以通过 API 调用 Superpowers 工具
- [ ] 工具参数正确传递
- [ ] 返回结果格式正确

## 🐛 故障排查

### 问题 1: 连接器无法连接

**症状**: `connected: false`

**解决方案**:
```bash
# 1. 检查环境变量
echo $SUPERPOWERS_API_KEY

# 2. 检查 Superpowers MCP Server 是否运行
cd plugins/superpowers-mcp
node bin/mcp-server.js

# 3. 查看 OpenYak 日志
tail -f backend/logs/app.log | grep superpowers
```

### 问题 2: 工具调用失败

**症状**: 工具返回错误

**解决方案**:
```bash
# 1. 检查工具列表
curl http://localhost:8000/api/connectors/superpowers-mcp/tools

# 2. 测试工具调用
curl -X POST http://localhost:8000/api/tools/superpowers-mcp_<tool_name>/test \
  -H "Content-Type: application/json" \
  -d '{"param": "value"}'
```

### 问题 3: 权限错误

**症状**: 工具调用被拒绝

**解决方案**:
```bash
# 1. 检查 Agent 权限
curl http://localhost:8000/api/agents/default

# 2. 添加权限
curl -X PUT http://localhost:8000/api/agents/default \
  -H "Content-Type: application/json" \
  -d '{
    "permissions": [
      {"action": "allow", "permission": "superpowers-mcp_*", "pattern": "*"}
    ]
  }'
```

## 📚 高级用法

### 自定义工具过滤

```python
# scripts/filter_superpowers_tools.py
import asyncio
import httpx

async def filter_tools():
    """过滤 Superpowers 工具"""
    
    async with httpx.AsyncClient() as client:
        # 获取所有工具
        response = await client.get(
            "http://localhost:8000/api/connectors/superpowers-mcp/tools"
        )
        
        tools = response.json().get("tools", [])
        
        # 过滤特定工具
        filtered = [t for t in tools if "collaborate" in t["name"]]
        
        print(f"找到 {len(tools)} 个工具")
        print(f"过滤后：{len(filtered)} 个工具")
        
        for tool in filtered:
            print(f"  - {tool['name']}: {tool['description']}")

asyncio.run(filter_tools())
```

### 批量启用多个连接器

```python
# scripts/batch_enable_connectors.py
import asyncio
import httpx

async def batch_enable():
    """批量启用连接器"""
    
    connectors = ["superpowers-mcp", "google-drive", "github"]
    
    async with httpx.AsyncClient() as client:
        for name in connectors:
            try:
                response = await client.post(
                    f"http://localhost:8000/api/connectors/{name}/enable"
                )
                
                if response.status_code == 200:
                    print(f"✅ {name} 已启用")
                else:
                    print(f"❌ {name} 启用失败：{response.text}")
            except Exception as e:
                print(f"❌ {name} 错误：{e}")

asyncio.run(batch_enable())
```

## 🔒 安全建议

### 1. 使用环境变量管理密钥

```bash
# 在 .env 文件中配置
SUPERPOWERS_API_KEY=your_actual_api_key
WORKSPACE_DIR=/path/to/workspace

# 不要硬编码在代码中
```

### 2. 限制工具访问权限

```python
# 只允许特定 Agent 使用 Superpowers 工具
agent_permissions = {
    "admin-agent": ["superpowers-mcp_*"],
    "default-agent": []  # 默认不启用
}
```

### 3. 启用日志审计

```python
# 记录所有工具调用
import logging

logger = logging.getLogger(__name__)

async def execute_tool(tool_name, args):
    logger.info(f"工具调用：{tool_name}, 参数：{args}")
    result = await call_tool(tool_name, args)
    logger.info(f"工具结果：{result}")
    return result
```

## 📈 性能优化

### 1. 调整超时时间

```json
{
  "timeout": 120  // 增加超时时间到 120 秒
}
```

### 2. 启用连接池

```python
# 在 OpenYak 配置中
httpx.AsyncClient(
    timeout=30.0,
    limits=httpx.Limits(
        max_connections=100,
        max_keepalive_connections=20,
    )
)
```

### 3. 缓存工具列表

```python
# 缓存工具定义，减少 API 调用
from functools import lru_cache

@lru_cache(maxsize=10)
async def get_tools(connector_id):
    async with httpx.AsyncClient() as client:
        response = await client.get(
            f"http://localhost:8000/api/connectors/{connector_id}/tools"
        )
        return response.json()
```

## 🎓 最佳实践

### 1. 使用自动化脚本

优先使用提供的自动化脚本，减少手动配置错误。

### 2. 定期更新

```bash
# 定期检查更新
cd plugins/superpowers-mcp
npm update @superpowers/mcp-server
```

### 3. 监控状态

```bash
# 定期检查状态
watch -n 60 'python scripts/check_superpowers_status.py'
```

### 4. 备份配置

```bash
# 备份配置
cp plugins/superpowers-mcp/config.json plugins/superpowers-mcp/config.json.backup
```

## 📞 获取帮助

### 文档资源

- [OpenYak 开发文档](./开发文档/00-目录.md)
- [MCP 集成指南](./开发文档/04-扩展开发指南.md#35-mcp-集成)
- [API 参考文档](./开发文档/05-API 参考文档.md)

### 常见问题

- [FAQ 常见问题解答](./开发文档/08-FAQ-常见问题解答.md)
- [贡献者指南](./开发文档/14-贡献者指南.md)

### 技术支持

- GitHub Issues: https://github.com/openyak/openyak/issues
- 社区讨论：https://github.com/openyak/openyak/discussions

## 📝 更新日志

- **2024-01-01**: 初始版本，提供完整的集成方案
- **2024-01-15**: 添加自动化安装脚本
- **2024-01-20**: 完善故障排查指南

---

**提示**: 本指南假设您已按照 [OpenYak 快速开始](./开发文档/01-项目概述与快速开始.md) 完成了基础环境搭建。
