"""Contradiction detection — find contradictory facts across wiki pages.

Uses LLM to compare page summaries and detect contradictions.
Optimized to only compare pages with shared keywords/tags.

Ported from nashsu/llm_wiki ``src/lib/lint.ts`` contradiction detection.
"""

from __future__ import annotations

import logging
import re
from pathlib import Path
from typing import Any

from app.wiki.cleanup import extract_frontmatter_title, normalize_wiki_ref_key

logger = logging.getLogger(__name__)


def _extract_keywords(content: str, max_keywords: int = 10) -> set[str]:
    """Extract significant keywords from page content for comparison."""
    # Strip frontmatter
    body = re.sub(r"^---\n[\s\S]*?---\n", "", content)
    # Simple keyword extraction: lowercase, split, filter stop words
    words = re.findall(r"\b[a-z]{3,}\b", body.lower())
    stop_words = {
        "the", "and", "for", "are", "but", "not", "you", "all", "can",
        "had", "her", "was", "one", "our", "out", "has", "have", "been",
        "from", "this", "that", "with", "they", "will", "each", "which",
        "their", "about", "would", "there", "could", "other", "into",
        "more", "some", "than", "its", "over", "such", "after", "also",
    }
    filtered = [w for w in words if w not in stop_words]
    # Count and take top keywords
    from collections import Counter
    counts = Counter(filtered)
    return {word for word, _ in counts.most_common(max_keywords)}


def find_contradiction_candidates(wiki_root: str) -> list[tuple[str, str, float]]:
    """Find page pairs that might contain contradictions.

    Only compares pages with shared keywords (Jaccard similarity > 0.2).
    Returns list of (page_id_1, page_id_2, similarity) tuples.
    """
    root = Path(wiki_root)
    if not root.is_dir():
        return []

    # Collect page keywords
    page_keywords: dict[str, set[str]] = {}
    page_titles: dict[str, str] = {}

    for cat_dir in root.iterdir():
        if not cat_dir.is_dir():
            continue
        for md_file in cat_dir.glob("*.md"):
            try:
                content = md_file.read_text(encoding="utf-8")
                keywords = _extract_keywords(content)
                page_keywords[md_file.stem] = keywords
                page_titles[md_file.stem] = extract_frontmatter_title(content) or md_file.stem
            except OSError:
                continue

    # Compare pairs with shared keywords
    candidates = []
    page_ids = list(page_keywords.keys())

    for i in range(len(page_ids)):
        for j in range(i + 1, len(page_ids)):
            kw_a = page_keywords[page_ids[i]]
            kw_b = page_keywords[page_ids[j]]
            if not kw_a or not kw_b:
                continue

            # Jaccard similarity
            intersection = len(kw_a & kw_b)
            union = len(kw_a | kw_b)
            if union == 0:
                continue
            similarity = intersection / union

            if similarity > 0.2:
                candidates.append((page_ids[i], page_ids[j], similarity))

    # Sort by similarity (most similar first)
    candidates.sort(key=lambda x: x[2], reverse=True)
    return candidates


def generate_contradiction_prompt(
    page_a_title: str,
    page_a_content: str,
    page_b_title: str,
    page_b_content: str,
) -> str:
    """Generate a prompt for LLM to check for contradictions between two pages."""
    # Truncate content for prompt
    body_a = re.sub(r"^---\n[\s\S]*?---\n", "", page_a_content)[:1500]
    body_b = re.sub(r"^---\n[\s\S]*?---\n", "", page_b_content)[:1500]

    return (
        "You are a knowledge base auditor. Compare the following two wiki pages "
        "and determine if they contain any contradictory facts or claims.\n\n"
        f"PAGE A: {page_a_title}\n{body_a}\n\n"
        f"PAGE B: {page_b_title}\n{body_b}\n\n"
        "If you find a contradiction, respond with:\n"
        "CONTRADICTION: <brief description of the contradiction>\n"
        "DETAILS: <which facts contradict each other>\n\n"
        "If no contradiction is found, respond with:\n"
        "NO CONTRADICTION\n\n"
        "Be conservative — only flag clear factual contradictions, not "
        "differences in perspective or incomplete information."
    )
