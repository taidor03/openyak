"""Vector store for wiki semantic search.

Stores page embeddings as a JSON file. Provides cosine similarity search
and RRF fusion with token search.

Ported from nashsu/llm_wiki ``src/lib/embedding.ts`` and
``src/lib/search-rrf.ts``, adapted for Python.
"""

from __future__ import annotations

import json
import logging
import math
import re
from datetime import datetime
from pathlib import Path
from typing import Any

from app.wiki.cleanup import extract_frontmatter_title
from app.wiki.embedding import get_embedding

logger = logging.getLogger(__name__)


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(x * x for x in b))
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


class VectorStore:
    """JSON-based vector store for wiki pages."""

    def __init__(self, wiki_root: str) -> None:
        self.wiki_root = wiki_root
        self._path = Path(wiki_root) / ".vectors.json"
        self._vectors: dict[str, dict[str, Any]] = {}
        self._load()

    def _load(self) -> None:
        if self._path.exists():
            try:
                data = json.loads(self._path.read_text(encoding="utf-8"))
                self._vectors = data.get("vectors", {})
            except (json.JSONDecodeError, KeyError) as exc:
                logger.warning("Failed to load vector store: %s", exc)
                self._vectors = {}

    def load(self) -> None:
        """Public reload — re-read the vector store from disk."""
        self._load()

    def get_vector(self, page_id: str) -> list[float] | None:
        """Get the embedding vector for a page, or None if not indexed."""
        entry = self._vectors.get(page_id)
        if entry is None:
            return None
        return entry.get("embedding")

    def _save(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        data = {"vectors": self._vectors, "updated_at": datetime.now().isoformat()}
        self._path.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")

    async def index_page(
        self,
        page_id: str,
        content: str,
        category: str = "",
        *,
        ollama_base_url: str | None = None,
        openai_api_key: str | None = None,
    ) -> bool:
        """Generate and store embedding for a page."""
        body = re.sub(r"^---\n[\s\S]*?---\n", "", content)
        title = extract_frontmatter_title(content) or page_id
        embed_text = f"{title}\n\n{body[:2000]}"
        embedding = await get_embedding(embed_text, ollama_base_url=ollama_base_url, openai_api_key=openai_api_key)
        if embedding is None:
            return False
        self._vectors[page_id] = {
            "embedding": embedding,
            "title": title,
            "category": category,
            "updated": datetime.now().isoformat(),
        }
        self._save()
        return True

    def remove_page(self, page_id: str) -> bool:
        if page_id in self._vectors:
            del self._vectors[page_id]
            self._save()
            return True
        return False

    def search_similar(self, query_embedding: list[float], top_k: int = 20) -> list[dict[str, Any]]:
        results = []
        for page_id, data in self._vectors.items():
            embedding = data.get("embedding", [])
            if not embedding:
                continue
            score = _cosine_similarity(query_embedding, embedding)
            results.append({"page_id": page_id, "title": data.get("title", page_id), "category": data.get("category", ""), "score": score})
        results.sort(key=lambda r: r["score"], reverse=True)
        return results[:top_k]

    @property
    def indexed_count(self) -> int:
        return len(self._vectors)


def search_with_rrf(
    token_results: list[dict[str, Any]],
    vector_results: list[dict[str, Any]],
    k: int = 60,
) -> list[dict[str, Any]]:
    """Reciprocal Rank Fusion: merge token and vector search results."""
    rrf_scores: dict[str, float] = {}
    page_data: dict[str, dict[str, Any]] = {}

    for rank, result in enumerate(token_results, 1):
        page_id = result["page_id"]
        rrf_scores[page_id] = rrf_scores.get(page_id, 0.0) + 1.0 / (k + rank)
        if page_id not in page_data:
            page_data[page_id] = dict(result)

    for rank, result in enumerate(vector_results, 1):
        page_id = result["page_id"]
        rrf_scores[page_id] = rrf_scores.get(page_id, 0.0) + 1.0 / (k + rank)
        if page_id not in page_data:
            page_data[page_id] = dict(result)
        else:
            page_data[page_id]["vector_score"] = result.get("score", 0)

    sorted_ids = sorted(rrf_scores.keys(), key=lambda pid: rrf_scores[pid], reverse=True)
    results = []
    for page_id in sorted_ids:
        data = page_data[page_id]
        data["rrf_score"] = rrf_scores[page_id]
        results.append(data)
    return results
