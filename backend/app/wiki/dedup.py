"""Content deduplication — detect and merge duplicate wiki pages.

Three levels of detection:
  1. Exact: content hash is identical
  2. Near: trigram similarity > 0.8
  3. Semantic: vector similarity > 0.9 (requires embedding)

Ported from nashsu/llm_wiki ``src/lib/dedup*.ts``, adapted for Python.
"""

from __future__ import annotations

import hashlib
import logging
import re
from collections import Counter
from pathlib import Path
from typing import Any

from app.wiki.cleanup import extract_frontmatter_title

logger = logging.getLogger(__name__)


def _content_hash(content: str) -> str:
    """Hash page body (excluding frontmatter) for exact dedup."""
    body = re.sub(r"^---\n[\s\S]*?---\n", "", content)
    # Normalize whitespace for hashing
    normalized = re.sub(r"\s+", " ", body.strip())
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:32]


def _trigrams(text: str) -> Counter:
    """Extract character trigrams from text."""
    text = re.sub(r"\s+", " ", text.lower().strip())
    trigrams: Counter = Counter()
    for i in range(len(text) - 2):
        trigrams[text[i:i + 3]] += 1
    return trigrams


def _trigram_similarity(text_a: str, text_b: str) -> float:
    """Compute trigram similarity between two texts."""
    tri_a = _trigrams(text_a)
    tri_b = _trigrams(text_b)

    if not tri_a or not tri_b:
        return 0.0

    # Jaccard-like similarity on trigrams
    intersection = sum((tri_a & tri_b).values())
    union = sum((tri_a | tri_b).values())

    return intersection / union if union > 0 else 0.0


def _cosine_similarity(vec_a: list[float], vec_b: list[float]) -> float:
    """Compute cosine similarity between two vectors."""
    if not vec_a or not vec_b or len(vec_a) != len(vec_b):
        return 0.0
    dot = sum(a * b for a, b in zip(vec_a, vec_b))
    norm_a = sum(a * a for a in vec_a) ** 0.5
    norm_b = sum(b * b for b in vec_b) ** 0.5
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return dot / (norm_a * norm_b)


async def _get_embeddings_for_pages(
    pages: dict[str, dict[str, str]],
    wiki_root: str,
) -> dict[str, list[float]]:
    """Retrieve or generate vector embeddings for all pages.

    Tries to load from the existing vector store first; falls back to
    generating embeddings on the fly via the embedding module.
    """
    embeddings: dict[str, list[float]] = {}
    if not pages:
        return embeddings

    # Try loading from the vector store
    try:
        from app.wiki.vector_store import VectorStore
        store = VectorStore(wiki_root)
        store.load()
        for page_id in pages:
            vec = store.get_vector(page_id)
            if vec:
                embeddings[page_id] = vec
        if len(embeddings) == len(pages):
            return embeddings
    except Exception:
        logger.debug("Vector store not available for dedup, generating embeddings")

    # Generate missing embeddings on the fly
    missing_ids = [pid for pid in pages if pid not in embeddings]
    if missing_ids:
        try:
            from app.wiki.embedding import generate_embedding
            for page_id in missing_ids:
                body = pages[page_id]["body"]
                # Truncate to avoid excessive token usage
                text = body[:2000] if len(body) > 2000 else body
                vec = await generate_embedding(text)
                if vec:
                    embeddings[page_id] = vec
        except Exception as exc:
            logger.warning("Failed to generate embeddings for semantic dedup: %s", exc)

    return embeddings


def find_duplicates(
    wiki_root: str,
    *,
    include_semantic: bool = False,
) -> dict[str, Any]:
    """Find duplicate wiki pages at three levels.

    Args:
        wiki_root: Path to the wiki root directory.
        include_semantic: If True, also run Level 3 semantic dedup
            (requires embedding service).  Defaults to False because
            embedding generation is expensive.

    Returns dict with:
      - exact: list of groups of pages with identical content
      - near: list of pairs with trigram similarity > 0.8
      - semantic: list of pairs with vector similarity > 0.9 (if enabled)
      - total_pages: number of pages checked
    """
    root = Path(wiki_root)
    if not root.is_dir():
        return {"exact": [], "near": [], "semantic": [], "total_pages": 0}

    # Collect all page content
    pages: dict[str, dict[str, str]] = {}  # page_id -> {content, body, hash, title, category}

    for cat_dir in root.iterdir():
        if not cat_dir.is_dir():
            continue
        for md_file in cat_dir.glob("*.md"):
            try:
                content = md_file.read_text(encoding="utf-8")
                body = re.sub(r"^---\n[\s\S]*?---\n", "", content)
                title = extract_frontmatter_title(content) or md_file.stem
                pages[md_file.stem] = {
                    "content": content,
                    "body": body,
                    "hash": _content_hash(content),
                    "title": title,
                    "category": cat_dir.name,
                }
            except OSError:
                continue

    # 1. Exact duplicates (by content hash)
    hash_groups: dict[str, list[str]] = {}
    for page_id, data in pages.items():
        hash_groups.setdefault(data["hash"], []).append(page_id)

    exact = [
        {
            "type": "exact",
            "page_ids": group,
            "titles": [pages[pid]["title"] for pid in group],
        }
        for group in hash_groups.values()
        if len(group) > 1
    ]

    # Build a set of exact-duplicate pairs to skip in near/semantic
    exact_pairs: set[tuple[str, str]] = set()
    for group in hash_groups.values():
        if len(group) > 1:
            for i in range(len(group)):
                for j in range(i + 1, len(group)):
                    exact_pairs.add((group[i], group[j]))

    # 2. Near duplicates (trigram similarity > 0.8)
    near: list[dict[str, Any]] = []
    page_ids = list(pages.keys())

    for i in range(len(page_ids)):
        for j in range(i + 1, len(page_ids)):
            pid_a = page_ids[i]
            pid_b = page_ids[j]

            # Skip exact duplicates
            if (pid_a, pid_b) in exact_pairs:
                continue

            sim = _trigram_similarity(pages[pid_a]["body"], pages[pid_b]["body"])
            if sim > 0.8:
                near.append({
                    "type": "near",
                    "similarity": round(sim, 3),
                    "page_ids": [pid_a, pid_b],
                    "titles": [pages[pid_a]["title"], pages[pid_b]["title"]],
                })

    near.sort(key=lambda x: x["similarity"], reverse=True)

    # 3. Semantic duplicates (vector similarity > 0.9) — opt-in
    semantic: list[dict[str, Any]] = []
    if include_semantic:
        semantic = _find_semantic_duplicates_sync(pages, wiki_root)

    return {
        "exact": exact,
        "near": near[:20],  # Cap at 20 near-duplicate pairs
        "semantic": semantic[:20],  # Cap at 20 semantic-duplicate pairs
        "total_pages": len(pages),
    }


def _find_semantic_duplicates_sync(
    pages: dict[str, dict[str, str]],
    wiki_root: str,
) -> list[dict[str, Any]]:
    """Synchronous wrapper that logs a warning if embeddings unavailable.

    Semantic dedup is inherently async (embedding generation may call
    external APIs), so callers should prefer ``find_duplicates_async``
    when possible.
    """
    import asyncio
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        loop = None

    if loop and loop.is_running():
        # We're inside an already-running event loop — can't await.
        logger.warning(
            "find_duplicates called with include_semantic=True from a running "
            "event loop; semantic dedup requires async. Use find_duplicates_async."
        )
        return []

    try:
        return asyncio.run(_find_semantic_duplicates_async(pages, wiki_root))
    except Exception as exc:
        logger.warning("Semantic dedup failed: %s", exc)
        return []


async def find_duplicates_async(
    wiki_root: str,
    *,
    include_semantic: bool = True,
) -> dict[str, Any]:
    """Async version of find_duplicates that supports semantic dedup.

    Prefer this when calling from an async context (e.g. FastAPI handler).
    """
    root = Path(wiki_root)
    if not root.is_dir():
        return {"exact": [], "near": [], "semantic": [], "total_pages": 0}

    # Collect all page content
    pages: dict[str, dict[str, str]] = {}
    for cat_dir in root.iterdir():
        if not cat_dir.is_dir():
            continue
        for md_file in cat_dir.glob("*.md"):
            try:
                content = md_file.read_text(encoding="utf-8")
                body = re.sub(r"^---\n[\s\S]*?---\n", "", content)
                title = extract_frontmatter_title(content) or md_file.stem
                pages[md_file.stem] = {
                    "content": content,
                    "body": body,
                    "hash": _content_hash(content),
                    "title": title,
                    "category": cat_dir.name,
                }
            except OSError:
                continue

    # 1. Exact duplicates
    hash_groups: dict[str, list[str]] = {}
    for page_id, data in pages.items():
        hash_groups.setdefault(data["hash"], []).append(page_id)

    exact = [
        {
            "type": "exact",
            "page_ids": group,
            "titles": [pages[pid]["title"] for pid in group],
        }
        for group in hash_groups.values()
        if len(group) > 1
    ]

    exact_pairs: set[tuple[str, str]] = set()
    for group in hash_groups.values():
        if len(group) > 1:
            for i in range(len(group)):
                for j in range(i + 1, len(group)):
                    exact_pairs.add((group[i], group[j]))

    # 2. Near duplicates
    near: list[dict[str, Any]] = []
    page_ids = list(pages.keys())
    for i in range(len(page_ids)):
        for j in range(i + 1, len(page_ids)):
            pid_a, pid_b = page_ids[i], page_ids[j]
            if (pid_a, pid_b) in exact_pairs:
                continue
            sim = _trigram_similarity(pages[pid_a]["body"], pages[pid_b]["body"])
            if sim > 0.8:
                near.append({
                    "type": "near",
                    "similarity": round(sim, 3),
                    "page_ids": [pid_a, pid_b],
                    "titles": [pages[pid_a]["title"], pages[pid_b]["title"]],
                })
    near.sort(key=lambda x: x["similarity"], reverse=True)

    # 3. Semantic duplicates
    semantic: list[dict[str, Any]] = []
    if include_semantic:
        semantic = await _find_semantic_duplicates_async(pages, wiki_root)

    return {
        "exact": exact,
        "near": near[:20],
        "semantic": semantic[:20],
        "total_pages": len(pages),
    }


async def _find_semantic_duplicates_async(
    pages: dict[str, dict[str, str]],
    wiki_root: str,
) -> list[dict[str, Any]]:
    """Find semantically similar pages using vector embeddings."""
    embeddings = await _get_embeddings_for_pages(pages, wiki_root)
    if len(embeddings) < 2:
        return []

    page_ids = list(embeddings.keys())
    semantic: list[dict[str, Any]] = []

    for i in range(len(page_ids)):
        for j in range(i + 1, len(page_ids)):
            pid_a, pid_b = page_ids[i], page_ids[j]
            sim = _cosine_similarity(embeddings[pid_a], embeddings[pid_b])
            if sim > 0.9:
                semantic.append({
                    "type": "semantic",
                    "similarity": round(sim, 3),
                    "page_ids": [pid_a, pid_b],
                    "titles": [
                        pages.get(pid_a, {}).get("title", pid_a),
                        pages.get(pid_b, {}).get("title", pid_b),
                    ],
                })

    semantic.sort(key=lambda x: x["similarity"], reverse=True)
    return semantic
