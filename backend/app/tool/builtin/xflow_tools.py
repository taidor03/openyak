"""xflow API integration tools.

Requires OPENYAK_XFLOW_API_URL and OPENYAK_XFLOW_API_TOKEN to be configured.
"""

from __future__ import annotations

import json
import logging
from typing import Any

import httpx

from app.config import get_settings
from app.tool.base import ToolDefinition, ToolResult
from app.tool.context import ToolContext

logger = logging.getLogger(__name__)

_TIMEOUT = 30.0


async def _xflow_request(
    method: str,
    path: str,
    *,
    body: dict[str, Any] | None = None,
) -> dict[str, Any]:
    settings = get_settings()
    url = settings.xflow_api_url
    token = settings.xflow_api_token
    if not url or not token:
        raise ValueError(
            "xflow API 未配置，请在设置中填写 OPENYAK_XFLOW_API_URL 和 OPENYAK_XFLOW_API_TOKEN"
        )
    base = url.rstrip("/")
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        kwargs: dict[str, Any] = {"headers": headers}
        if body is not None:
            kwargs["json"] = body
        response = await getattr(client, method.lower())(f"{base}{path}", **kwargs)
        response.raise_for_status()
        if response.status_code == 204:
            return {}
        return dict(response.json())


class XflowListProductsTool(ToolDefinition):
    @property
    def id(self) -> str:
        return "xflow_list_products"

    @property
    def is_concurrency_safe(self) -> bool:
        return True

    @property
    def description(self) -> str:
        return "列出 xflow 商品，支持分页和关键词搜索"

    def parameters_schema(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "page": {"type": "integer", "description": "页码，从 1 开始", "default": 1},
                "page_size": {"type": "integer", "description": "每页数量", "default": 20},
                "search": {"type": "string", "description": "关键词搜索"},
            },
        }

    async def execute(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        page = args.get("page", 1)
        page_size = args.get("page_size", 20)
        search = args.get("search", "")
        qs = f"/api/products?page={page}&page_size={page_size}"
        if search:
            qs += f"&search={search}"
        try:
            data = await _xflow_request("get", qs)
            return ToolResult(output=json.dumps(data, ensure_ascii=False, indent=2))
        except Exception as e:
            return ToolResult(output=f"Error: {e}", error=str(e))


class XflowGetProductTool(ToolDefinition):
    @property
    def id(self) -> str:
        return "xflow_get_product"

    @property
    def is_concurrency_safe(self) -> bool:
        return True

    @property
    def description(self) -> str:
        return "获取单个 xflow 商品详情"

    def parameters_schema(self) -> dict[str, Any]:
        return {
            "type": "object",
            "required": ["id"],
            "properties": {"id": {"type": "string", "description": "商品 ID"}},
        }

    async def execute(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        try:
            data = await _xflow_request("get", f"/api/products/{args['id']}")
            return ToolResult(output=json.dumps(data, ensure_ascii=False, indent=2))
        except Exception as e:
            return ToolResult(output=f"Error: {e}", error=str(e))


class XflowCreateProductTool(ToolDefinition):
    @property
    def id(self) -> str:
        return "xflow_create_product"

    @property
    def description(self) -> str:
        return "在 xflow 创建新商品"

    def parameters_schema(self) -> dict[str, Any]:
        return {
            "type": "object",
            "required": ["title"],
            "properties": {
                "title": {"type": "string", "description": "商品名称"},
                "description": {"type": "string", "description": "商品描述"},
                "price": {"type": "number", "description": "价格"},
                "category_id": {"type": "string", "description": "分类 ID"},
                "status": {"type": "string", "enum": ["draft", "published"]},
            },
        }

    async def execute(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        try:
            data = await _xflow_request("post", "/api/products", body=args)
            return ToolResult(output=json.dumps(data, ensure_ascii=False, indent=2))
        except Exception as e:
            return ToolResult(output=f"Error: {e}", error=str(e))


class XflowUpdateProductTool(ToolDefinition):
    @property
    def id(self) -> str:
        return "xflow_update_product"

    @property
    def description(self) -> str:
        return "更新 xflow 商品"

    def parameters_schema(self) -> dict[str, Any]:
        return {
            "type": "object",
            "required": ["id"],
            "properties": {
                "id": {"type": "string", "description": "商品 ID"},
                "title": {"type": "string"},
                "description": {"type": "string"},
                "price": {"type": "number"},
                "status": {"type": "string", "enum": ["draft", "published", "archived"]},
            },
        }

    async def execute(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        product_id = args.pop("id")
        try:
            data = await _xflow_request("put", f"/api/products/{product_id}", body=args)
            return ToolResult(output=json.dumps(data, ensure_ascii=False, indent=2))
        except Exception as e:
            return ToolResult(output=f"Error: {e}", error=str(e))


class XflowDeleteProductTool(ToolDefinition):
    @property
    def id(self) -> str:
        return "xflow_delete_product"

    @property
    def description(self) -> str:
        return "删除 xflow 商品"

    def parameters_schema(self) -> dict[str, Any]:
        return {
            "type": "object",
            "required": ["id"],
            "properties": {"id": {"type": "string", "description": "商品 ID"}},
        }

    async def execute(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        try:
            await _xflow_request("delete", f"/api/products/{args['id']}")
            return ToolResult(output=f"已删除商品 {args['id']}")
        except Exception as e:
            return ToolResult(output=f"Error: {e}", error=str(e))


class XflowListBlogsTool(ToolDefinition):
    @property
    def id(self) -> str:
        return "xflow_list_blogs"

    @property
    def is_concurrency_safe(self) -> bool:
        return True

    @property
    def description(self) -> str:
        return "列出 xflow 博文"

    def parameters_schema(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "page": {"type": "integer", "default": 1},
                "page_size": {"type": "integer", "default": 20},
            },
        }

    async def execute(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        page = args.get("page", 1)
        page_size = args.get("page_size", 20)
        try:
            data = await _xflow_request("get", f"/api/blogs?page={page}&page_size={page_size}")
            return ToolResult(output=json.dumps(data, ensure_ascii=False, indent=2))
        except Exception as e:
            return ToolResult(output=f"Error: {e}", error=str(e))


class XflowListCategoriesTool(ToolDefinition):
    @property
    def id(self) -> str:
        return "xflow_list_categories"

    @property
    def is_concurrency_safe(self) -> bool:
        return True

    @property
    def description(self) -> str:
        return "列出 xflow 分类"

    def parameters_schema(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "page": {"type": "integer", "default": 1},
                "page_size": {"type": "integer", "default": 50},
            },
        }

    async def execute(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        page = args.get("page", 1)
        page_size = args.get("page_size", 50)
        try:
            data = await _xflow_request("get", f"/api/categories?page={page}&page_size={page_size}")
            return ToolResult(output=json.dumps(data, ensure_ascii=False, indent=2))
        except Exception as e:
            return ToolResult(output=f"Error: {e}", error=str(e))


class XflowListOutfitsTool(ToolDefinition):
    @property
    def id(self) -> str:
        return "xflow_list_outfits"

    @property
    def is_concurrency_safe(self) -> bool:
        return True

    @property
    def description(self) -> str:
        return "列出 xflow 穿搭"

    def parameters_schema(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "page": {"type": "integer", "default": 1},
                "page_size": {"type": "integer", "default": 20},
            },
        }

    async def execute(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        page = args.get("page", 1)
        page_size = args.get("page_size", 20)
        try:
            data = await _xflow_request("get", f"/api/outfits?page={page}&page_size={page_size}")
            return ToolResult(output=json.dumps(data, ensure_ascii=False, indent=2))
        except Exception as e:
            return ToolResult(output=f"Error: {e}", error=str(e))


class XflowListVideosTool(ToolDefinition):
    @property
    def id(self) -> str:
        return "xflow_list_videos"

    @property
    def is_concurrency_safe(self) -> bool:
        return True

    @property
    def description(self) -> str:
        return "列出 xflow 视频"

    def parameters_schema(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "page": {"type": "integer", "default": 1},
                "page_size": {"type": "integer", "default": 20},
            },
        }

    async def execute(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        page = args.get("page", 1)
        page_size = args.get("page_size", 20)
        try:
            data = await _xflow_request("get", f"/api/videos?page={page}&page_size={page_size}")
            return ToolResult(output=json.dumps(data, ensure_ascii=False, indent=2))
        except Exception as e:
            return ToolResult(output=f"Error: {e}", error=str(e))


class XflowGetDashboardStatsTool(ToolDefinition):
    @property
    def id(self) -> str:
        return "xflow_get_dashboard_stats"

    @property
    def is_concurrency_safe(self) -> bool:
        return True

    @property
    def description(self) -> str:
        return "获取 xflow 看板统计数据（商品/博文/分类/穿搭/视频的总数和发布状态）"

    def parameters_schema(self) -> dict[str, Any]:
        return {"type": "object", "properties": {}}

    async def execute(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        try:
            data = await _xflow_request("get", "/api/dashboard/stats")
            return ToolResult(output=json.dumps(data, ensure_ascii=False, indent=2))
        except Exception as e:
            return ToolResult(output=f"Error: {e}", error=str(e))


class XflowSearchContentTool(ToolDefinition):
    @property
    def id(self) -> str:
        return "xflow_search_content"

    @property
    def is_concurrency_safe(self) -> bool:
        return True

    @property
    def description(self) -> str:
        return "在 xflow 中跨内容类型搜索（同时搜索商品、博文和分类）"

    def parameters_schema(self) -> dict[str, Any]:
        return {
            "type": "object",
            "required": ["query"],
            "properties": {
                "query": {"type": "string", "description": "搜索关键词"},
            },
        }

    async def execute(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        query = args["query"]
        results: dict[str, Any] = {}
        for resource in ("products", "blogs", "categories"):
            try:
                data = await _xflow_request("get", f"/api/{resource}?search={query}&page_size=5")
                results[resource] = data
            except Exception as e:
                results[resource] = {"error": str(e)}
        return ToolResult(output=json.dumps(results, ensure_ascii=False, indent=2))


ALL_XFLOW_TOOLS: list[type[ToolDefinition]] = [
    XflowListProductsTool,
    XflowGetProductTool,
    XflowCreateProductTool,
    XflowUpdateProductTool,
    XflowDeleteProductTool,
    XflowListBlogsTool,
    XflowListCategoriesTool,
    XflowListOutfitsTool,
    XflowListVideosTool,
    XflowGetDashboardStatsTool,
    XflowSearchContentTool,
]
