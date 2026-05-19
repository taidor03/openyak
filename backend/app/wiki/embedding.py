"""Embedding generation for wiki vector search.

Supports two backends:
  1. Ollama (local) — uses the /api/embeddings endpoint
  2. OpenAI — uses the /v1/embeddings endpoint

Auto-detects available backend.  If neither is available,
gracefully degrades (returns empty vectors).
"""

from __future__ import annotations

import hashlib
import logging
from typing import Any

import httpx

logger = logging.getLogger(__name__)

# Default embedding model
_OLLAMA_EMBED_MODEL = "nomic-embed-text"
_OPENAI_EMBED_MODEL = "text-embedding-3-small"
_EMBED_DIMENSIONS = 768


def _content_hash(text: str) -> str:
    """Simple hash for caching purposes."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()[:16]


async def get_embedding_ollama(
    text: str,
    base_url: str = "http://localhost:11434",
    model: str = _OLLAMA_EMBED_MODEL,
) -> list[float] | None:
    """Generate embedding using Ollama's /api/embeddings endpoint."""
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{base_url}/api/embeddings",
                json={"model": model, "prompt": text[:8000]},  # Truncate long texts
            )
            resp.raise_for_status()
            data = resp.json()
            return data.get("embedding")
    except Exception as exc:
        logger.debug("Ollama embedding failed: %s", exc)
        return None


async def get_embedding_openai(
    text: str,
    api_key: str,
    base_url: str = "https://api.openai.com/v1",
    model: str = _OPENAI_EMBED_MODEL,
) -> list[float] | None:
    """Generate embedding using OpenAI's /v1/embeddings endpoint."""
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                f"{base_url}/embeddings",
                headers={"Authorization": f"Bearer {api_key}"},
                json={"model": model, "input": text[:8000]},
            )
            resp.raise_for_status()
            data = resp.json()
            return data["data"][0]["embedding"]
    except Exception as exc:
        logger.debug("OpenAI embedding failed: %s", exc)
        return None


async def get_embedding(
    text: str,
    *,
    ollama_base_url: str | None = None,
    openai_api_key: str | None = None,
    openai_base_url: str | None = None,
) -> list[float] | None:
    """Generate embedding, auto-detecting the best available backend.

    Tries Ollama first (local, free), then OpenAI.
    Returns None if no backend is available.
    """
    # Try Ollama first
    if ollama_base_url:
        result = await get_embedding_ollama(text, base_url=ollama_base_url)
        if result:
            return result

    # Try OpenAI
    if openai_api_key:
        result = await get_embedding_openai(
            text,
            api_key=openai_api_key,
            base_url=openai_base_url or "https://api.openai.com/v1",
        )
        if result:
            return result

    logger.warning("No embedding backend available")
    return None
