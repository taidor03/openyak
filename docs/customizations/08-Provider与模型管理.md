# 08 - Provider 与模型管理

> **定制编号**: XFLOW-007, XFLOW-012  
> **涉及提交**: `5e82ad0`  
> **涉及范围**: 自定义端点 model_ids + Provider/Model 本地缓存 + Provider 自动检测

---

## 一、功能概述

本模块涵盖 Provider（模型提供商）与模型管理相关的所有定制增强：

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
    model_ids: list[str] | None = None  # 新增：手动指定的模型 ID 列表
```

#### provider/generic_openai.py

`GenericOpenAIProvider` 新增 `model_ids` 构造参数和 `pinned_model_ids` 逻辑：

```python
class GenericOpenAIProvider(OpenAICompatProvider):
    def __init__(
        self,
        provider_id: str,
        api_key: str,
        base_url: str,
        kind: str = "openai_compat",
        default_headers: dict[str, str] | None = None,
        model_ids: list[str] | None = None,  # 新增
    ):
        # ...
        self._pinned_model_ids: list[str] = model_ids or []

    @property
    def models(self) -> list[ModelInfo]:
        if self._models_cache is not None:
            return self._models_cache

        # 当 explicit model IDs 已固定时，返回合成条目，不调用任何 API
        if self._pinned_model_ids:
            models = [
                ModelInfo(
                    id=mid,
                    name=mid,
                    provider_id=self._provider_id,
                    capabilities=ModelCapabilities(function_calling=True),
                )
                for mid in self._pinned_model_ids
            ]
            self._models_cache = models
            return models

        # 原有自动发现逻辑...
```

**关键行为**：
- `_pinned_model_ids` 非空时，**完全跳过** API 自动发现
- 合成的 `ModelInfo` 默认启用 `function_calling` 能力
- 模型 ID 直接作为 `name` 显示

#### provider/factory.py

`create_provider` 新增 `model_ids` 参数，传递到具体 Provider：

```python
def create_provider(
    provider_id: str,
    api_key: str,
    *,
    base_url: str | None = None,
    model_ids: list[str] | None = None,  # 新增
) -> BaseProvider:
    # ...
    return GenericOpenAIProvider(
        # ...
        model_ids=model_ids or [],  # 传递
    )
```

#### main.py

在 lifespan 中传递 `model_ids`：

```python
provider = create_desktop_provider(
    pid,
    ce.get("api_key", ""),
    base_url=ce.get("base_url"),
    model_ids=ce.get("model_ids") or [],  # 新增
)
```

#### api/config.py

Provider 配置的读取和持久化需传递 `model_ids` 字段。

### 2.3 前端变更

#### providers-tab.tsx

- 新增 **Model IDs 输入框**（逗号分隔输入）
- 端点卡片展示**已指定/已发现模型数量**
- 保存时将 `model_ids` 作为字符串数组传给后端

### 2.4 数据流

```
用户在设置页输入 model_ids（逗号分隔）
    ↓
前端 POST/PUT /api/config → 保存到 endpoints 配置
    ↓
后端 lifespan 读取 ce.get("model_ids") → create_provider(model_ids=...)
    ↓
GenericOpenAIProvider._pinned_model_ids 非空
    ↓
跳过 /models API 调用 → 返回合成 ModelInfo 列表
```

---

## 三、Provider 与模型本地缓存（XFLOW-012）

### 3.1 缓存机制

**新增文件**：`frontend/src/lib/provider-cache.ts`

基于 localStorage 的版本化缓存，用于加速模型/提供商列表的首屏渲染：

```typescript
const PROVIDERS_KEY = "xflow:providers_v1";
const MODELS_KEY = "xflow:models_v1";

interface CacheEntry<T> {
  data: T;
  updatedAt: number; // epoch ms
}

// 内部读写工具
function readCache<T>(key: string): CacheEntry<T> | null
function writeCache<T>(key: string, data: T): void

// Provider 缓存
export function readProvidersCache(): CacheEntry<ProviderInfo[]> | null
export function writeProvidersCache(data: ProviderInfo[]): void

// Models 缓存
export function readModelsCache(): CacheEntry<ModelInfo[]> | null
export function writeModelsCache(data: ModelInfo[]): void
```

缓存 key 包含版本号（`_v1`），当应用版本更新时可切换版本号使缓存自动失效。

### 3.2 Hook 集成

#### use-providers.ts（新增）

```typescript
export function useProviders(): UseQueryResult<Provider[]> {
  return useQuery({
    queryKey: ["providers"],
    queryFn: fetchProviders,
    initialData: () => {
      // 从 localStorage 缓存读取，实现即显
      const cached = readProvidersCache();
      return cached?.data ?? undefined;
    },
    staleTime: 0,  // 即显即刷：缓存先展示，后台立即刷新
  });
}
```

#### use-models.ts（修改）

- 新增 `initialData` 从本地缓存加载
- `staleTime: 0` 确保后台刷新最新数据

### 3.3 数据流

```
首次渲染: localStorage 缓存 → 即时显示
后台请求: API → 更新缓存 + 刷新 UI
后续渲染: 缓存仍在，但 staleTime=0 触发后台刷新
```

### 3.4 与 TanStack Query 持久化的关系

Provider/Model 缓存使用了**独立的** `provider-cache.ts` 而非 TanStack Query 持久化层（`query-persister.ts`）。原因是：
- Provider/Model 缓存需要更细粒度的版本控制
- `provider-cache.ts` 在 XFLOW-012 中先于 TanStack Query 持久化实现
- 两者共存：`provider-cache.ts` 负责 Providers/Models，`query-persister.ts` 负责 agents/connectors/mcpConfig/plugins/skills

详见 [05-数据持久化与缓存策略.md](./05-数据持久化与缓存策略.md)。

---

## 四、Provider 自动检测优化

**`frontend/src/hooks/use-auto-detect-provider.ts`**：修改，适配 model_ids 和缓存集成。

---

## 五、涉及文件清单

| 文件路径 | 变更类型 | 说明 |
|---------|---------|------|
| `frontend/src/lib/provider-cache.ts` | 新增 | Provider/Model localStorage 版本化缓存 |
| `frontend/src/hooks/use-providers.ts` | 新增 | Provider 列表 Hook（缓存集成） |
| `backend/app/schemas/provider.py` | 修改 | 新增 `model_ids` 字段 |
| `backend/app/provider/generic_openai.py` | 修改 | `pinned_model_ids` 跳过自动发现 |
| `backend/app/provider/factory.py` | 修改 | `model_ids` 参数传递 |
| `backend/app/main.py` | 修改 | lifespan 传递 `model_ids` |
| `backend/app/api/config.py` | 修改 | `model_ids` 持久化 |
| `frontend/src/components/settings/providers-tab.tsx` | 修改 | Model IDs 输入框 + 显示 |
| `frontend/src/hooks/use-models.ts` | 修改 | 缓存集成（initialData + staleTime:0） |
| `frontend/src/hooks/use-auto-detect-provider.ts` | 修改 | 适配优化 |

---

## 六、重新实现检查清单

- [ ] `schemas/provider.py` 新增 `model_ids: list[str] | None` 字段
- [ ] `GenericOpenAIProvider.__init__` 新增 `model_ids` 参数 → `_pinned_model_ids`
- [ ] `_pinned_model_ids` 非空时跳过 `/models` API，返回合成 `ModelInfo`（含 `function_calling=True`）
- [ ] `factory.create_provider` 新增 `model_ids` 参数传递
- [ ] `main.py` lifespan 读取 `ce.get("model_ids")` 并传递
- [ ] `api/config.py` 传递并持久化 `model_ids`
- [ ] `providers-tab.tsx` 新增 Model IDs 输入框（逗号分隔）+ 已指定/已发现模型数量显示
- [ ] `provider-cache.ts`：版本化 localStorage 缓存（`xflow:providers_v1` / `xflow:models_v1`）
- [ ] `use-providers.ts`：新增 Hook，`initialData` 从缓存读取 + `staleTime: 0`
- [ ] `use-models.ts`：缓存集成（`initialData` + `staleTime: 0`）
- [ ] `use-auto-detect-provider.ts`：适配优化
