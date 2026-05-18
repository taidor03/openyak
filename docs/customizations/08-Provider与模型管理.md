# 08 - Provider 与模型管理

> **定制编号**: XFLOW-007, XFLOW-012  
> **涉及范围**: 自定义端点 model_ids + Provider/Model 本地缓存 + Provider 自动检测

---

## 一、功能概述

1. **自定义端点 model_ids 支持**（XFLOW-007）：手动指定模型列表，跳过 API 自动发现
2. **Provider 与模型本地缓存**（XFLOW-012）：localStorage 版本化缓存加速首屏渲染
3. **Provider 自动检测优化**：use-auto-detect-provider hook 调整

---

## 二、自定义端点 model_ids 支持（XFLOW-007）

### 2.1 需求背景

默认行为下，OpenYak 通过调用 Provider API 的 `/models` 端点自动发现可用模型。但部分场景下：
- Provider 不支持 `/models` 端点（如某些兼容 API）
- 用户只想使用特定几个模型
- 自动发现返回过多无关模型

因此新增 `model_ids` 字段，允许用户手动指定模型列表。

### 2.2 后端变更

#### schemas/provider.py

新增 `model_ids` 字段：

```python
class ProviderEndpoint:
    # ... 原有字段
    model_ids: list[str] | None = None  # 手动指定的模型 ID 列表

class ProviderEndpointUpdate:
    # ... 原有字段
    model_ids: list[str] | None = None

class ProviderInfo:
    # ... 原有字段
    model_ids: list[str] = []  # pinned model IDs for custom endpoints; empty = auto-discover
```

#### provider/generic_openai.py

`GenericOpenAIProvider` 新增 `pinned_model_ids` 构造参数和逻辑：

```python
class GenericOpenAIProvider(OpenAICompatProvider):
    def __init__(
        self,
        provider_id: str,
        # ...
        model_ids: list[str] = [],
    ):
        self._pinned_model_ids = model_ids

    async def list_models(self) -> list[ModelInfo]:
        # When explicit model IDs are pinned, return synthetic entries without any API calls.
        if self._pinned_model_ids:
            return [ModelInfo(id=mid, ...) for mid in self._pinned_model_ids]
        # ... 原有自动发现逻辑
```

#### provider/factory.py

```python
def create_desktop_provider(
    provider_id: str,
    pdef: ProviderInfo,
    # ...
    model_ids: list[str] | None = None,
) -> BaseProvider:
    # ...
    return GenericOpenAIProvider(
        provider_id=provider_id,
        # ...
        model_ids=model_ids or [],
    )
```

### 2.3 行为规则

- `model_ids = []` 或 `None`：正常自动发现（调用 `/models` API）
- `model_ids = ["model-a", "model-b"]`：跳过 API 调用，直接返回合成的 `ModelInfo` 列表

---

## 三、Provider 与模型本地缓存（XFLOW-012）

### 3.1 缓存模块

**新增文件**：`frontend/src/lib/provider-cache.ts`（56 行）

版本化 localStorage 缓存，与 TanStack Query 持久化独立：

```typescript
const PROVIDERS_KEY = "xflow:providers_v1";
const MODELS_KEY = "xflow:models_v1";

interface CacheEntry<T> {
  data: T;
  updatedAt: number; // epoch ms
}

function readCache<T>(key: string): CacheEntry<T> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as CacheEntry<T>;
  } catch {
    return null;
  }
}

function writeCache<T>(key: string, data: T): void {
  if (typeof window === "undefined") return;
  try {
    const entry: CacheEntry<T> = { data, updatedAt: Date.now() };
    localStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // storage quota exceeded or private-browsing restrictions — ignore silently
  }
}

export function readProvidersCache(): CacheEntry<ProviderInfo[]> | null {
  return readCache<ProviderInfo[]>(PROVIDERS_KEY);
}

export function writeProvidersCache(data: ProviderInfo[]): void {
  writeCache(PROVIDERS_KEY, data);
}

export function readModelsCache(): CacheEntry<ModelInfo[]> | null {
  return readCache<ModelInfo[]>(MODELS_KEY);
}

export function writeModelsCache(data: ModelInfo[]): void {
  writeCache(MODELS_KEY, data);
}
```

### 3.2 Hook 集成

**`frontend/src/hooks/use-providers.ts`**：

- `useProviders` 注入 `initialData`（缓存数据），实现即显
- Provider 列表获取成功后写入缓存
- Model 列表同理

### 3.3 缓存架构

Provider/Model 缓存使用独立的 `provider-cache.ts`，与通用 `query-persister.ts` 分离。两者共存：

- `provider-cache.ts`：Providers/Models（简单 key-value 缓存）
- `query-persister.ts`：agents/connectors/mcpConfig/plugins/skills（TanStack Query 持久化）

详见 [05-数据持久化与缓存策略.md](./05-数据持久化与缓存策略.md)

---

## 四、Provider 自动检测优化

**`frontend/src/hooks/use-auto-detect-provider.ts`**：

调整自动检测逻辑，配合 `model_ids` 的新行为。

---

## 五、配置常量表

| 常量 | 值 | 文件 |
|------|-----|------|
| `PROVIDERS_KEY` | `"xflow:providers_v1"` | `frontend/src/lib/provider-cache.ts` |
| `MODELS_KEY` | `"xflow:models_v1"` | `frontend/src/lib/provider-cache.ts` |

---

## 六、涉及文件清单

| 文件路径 | 变更类型 | 说明 |
|---------|---------|------|
| `backend/app/schemas/provider.py` | 修改 | model_ids 字段 |
| `backend/app/provider/generic_openai.py` | 修改 | pinned_model_ids 逻辑 |
| `backend/app/provider/factory.py` | 修改 | model_ids 参数传递 |
| `frontend/src/lib/provider-cache.ts` | 新增 | Provider/Model localStorage 缓存 |
| `frontend/src/hooks/use-providers.ts` | 修改 | 缓存集成 |
| `frontend/src/hooks/use-auto-detect-provider.ts` | 修改 | 自动检测优化 |

---

## 七、重新实现检查清单

- [ ] `ProviderEndpoint.model_ids: list[str] | None` 字段
- [ ] `ProviderEndpointUpdate.model_ids: list[str] | None` 字段
- [ ] `ProviderInfo.model_ids: list[str]` 字段（空 = 自动发现）
- [ ] `GenericOpenAIProvider._pinned_model_ids` 构造参数
- [ ] `list_models()` 中 `pinned_model_ids` 优先返回合成条目
- [ ] `factory.py` 传递 `model_ids` 参数
- [ ] `provider-cache.ts`（PROVIDERS_KEY=`xflow:providers_v1`, MODELS_KEY=`xflow:models_v1`）
- [ ] `useProviders` 注入缓存 initialData + 获取成功后写缓存
- [ ] `use-auto-detect-provider` 配合 model_ids 调整
