"""Health check and lifecycle endpoints."""

from __future__ import annotations

import logging
import os
import signal

from fastapi import APIRouter, Request

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/livez")
async def livez() -> dict:
    """Lightweight liveness probe. No external calls."""
    return {"status": "ok"}


@router.get("/health")
async def health(request: Request) -> dict:
    """Health check with provider status."""
    registry = getattr(request.app.state, "provider_registry", None)
    providers = {}
    if registry:
        providers = {
            pid: status.model_dump()
            for pid, status in (await registry.health()).items()
        }
    return {"status": "ok", "providers": providers}


@router.get("/startup-status")
async def startup_status(request: Request) -> dict:
    """Lightweight readiness probe used by the desktop frontend to track startup.

    Returns once the lifespan has completed (i.e. uvicorn is accepting requests),
    so the response always carries ``ready: true``.  The counts give the frontend
    a brief human-readable summary to display before auto-hiding.
    """
    state = request.app.state

    # Provider count
    providers_count = 0
    pr = getattr(state, "provider_registry", None)
    if pr:
        try:
            providers_count = len(pr._providers)  # type: ignore[attr-defined]
        except Exception:
            pass

    # Plugin count
    plugins_count = 0
    pm = getattr(state, "plugin_manager", None)
    if pm:
        try:
            plugins_count = len(pm.status())
        except Exception:
            pass

    # Connected MCP servers
    mcp_connected = 0
    cr = getattr(state, "connector_registry", None)
    if cr:
        try:
            mcp_connected = sum(
                1 for c in cr.status().values() if c.get("connected")
            )
        except Exception:
            pass

    # Tool count
    tools_count = 0
    tr = getattr(state, "tool_registry", None)
    if tr:
        try:
            tools_count = len(tr._tools)  # type: ignore[attr-defined]
        except Exception:
            pass

    return {
        "ready": True,
        "providers": providers_count,
        "plugins": plugins_count,
        "mcp_connected": mcp_connected,
        "tools": tools_count,
    }


@router.post("/shutdown")
async def shutdown() -> dict:
    """Graceful shutdown endpoint for desktop app.

    Sends SIGINT to self, which triggers FastAPI's lifespan shutdown
    (abort active jobs, dispose DB engine, etc.) before exiting.
    On Windows, uses CTRL_BREAK_EVENT as SIGINT equivalent.
    """
    logger.info("Shutdown requested via /shutdown endpoint")
    pid = os.getpid()
    if os.name == "nt":
        # Windows: os.kill with CTRL_BREAK_EVENT triggers KeyboardInterrupt
        os.kill(pid, signal.CTRL_BREAK_EVENT)
    else:
        os.kill(pid, signal.SIGINT)
    return {"status": "shutting_down"}
