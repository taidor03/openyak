"""Token-based search for wiki pages.

Ported from nashsu/llm_wiki ``src/lib/search.ts``, with the following
simplifications:
  - No vector/embedding search (requires external LLM)
  - No RRF fusion (only one ranking list)
  - No Tauri IPC / FileNode tree — uses pathlib directly
  - No image extraction from search results

The scoring system and CJK tokenisation are preserved faithfully.

Enhancements over llm_wiki:
  - LRU memory cache with TTL for repeated queries
  - Snippet highlighting of matched terms
"""

from __future__ import annotations

import hashlib
import re
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from pathlib import Path

# ── Scoring weights ────────────────────────────────────────────────────────
# Exact lexical matches dominate everything else.  When a user types
# "attention", the page literally named ``attention.md`` MUST rank first.

FILENAME_EXACT_BONUS = 200
PHRASE_IN_TITLE_BONUS = 50
PHRASE_IN_CONTENT_PER_OCC = 20
MAX_PHRASE_OCC_COUNTED = 10
TITLE_TOKEN_WEIGHT = 5
CONTENT_TOKEN_WEIGHT = 1

MAX_RESULTS = 20
SNIPPET_CONTEXT = 80

# Punctuation pattern for trimming query edges
_TRIM_PUNCT_RE = re.compile(
    r"^[\s,，。！？、；：\u201c\u201d\u2018\u2019（）()\-_/\\·~～…]+"
    r"|[\s,，。！？、；：\u201c\u201d\u2018\u2019（）()\-_/\\·~～…]+$"
)

# CJK Unicode ranges
_CJK_RE = re.compile(r"[\u4e00-\u9fff\u3400-\u4dbf]")

STOP_WORDS: frozenset[str] = frozenset({
    "的", "是", "了", "什么", "在", "有", "和", "与", "对", "从",
    "the", "is", "a", "an", "what", "how", "are", "was", "were",
    "do", "does", "did", "be", "been", "being", "have", "has", "had",
    "it", "its", "in", "on", "at", "to", "for", "of", "with", "by",
    "this", "that", "these", "those",
})


@dataclass
class SearchResult:
    """One search result from the wiki."""

    path: str
    page_id: str
    title: str
    category: str
    snippet: str
    title_match: bool
    score: float
    highlighted_snippet: str = ""


def tokenize_query(query: str) -> list[str]:
    """Tokenize a query string for search scoring.

    Handles both Western and CJK text.  For CJK, produces overlapping
    bigrams plus individual characters for fine-grained matching.
    """
    raw_tokens = re.split(
        r"[\s,，。！？、；：\u201c\u201d\u2018\u2019（）()\-_/\\·~～…]+",
        query.lower(),
    )
    raw_tokens = [t for t in raw_tokens if len(t) > 1 and t not in STOP_WORDS]

    tokens: list[str] = []
    for token in raw_tokens:
        if _CJK_RE.search(token) and len(token) > 2:
            # CJK: add overlapping bigrams + individual chars + original
            chars = list(token)
            for i in range(len(chars) - 1):
                tokens.append(chars[i] + chars[i + 1])
            for ch in chars:
                if ch not in STOP_WORDS:
                    tokens.append(ch)
            tokens.append(token)
        else:
            tokens.append(token)

    # Deduplicate while preserving order
    seen: set[str] = set()
    result: list[str] = []
    for t in tokens:
        if t not in seen:
            seen.add(t)
            result.append(t)
    return result


def _token_match_score(text: str, tokens: list[str]) -> float:
    """Count how many tokens appear in the text (lowercase)."""
    lower = text.lower()
    return sum(1.0 for t in tokens if t in lower)


def _count_occurrences(haystack_lower: str, needle_lower: str) -> int:
    """Count non-overlapping occurrences of needle in haystack."""
    if not needle_lower:
        return 0
    count = 0
    pos = 0
    while True:
        idx = haystack_lower.find(needle_lower, pos)
        if idx == -1:
            break
        count += 1
        pos = idx + len(needle_lower)
    return count


def _extract_title(content: str, filename: str) -> str:
    """Extract a page title from content or filename.

    Tries: YAML frontmatter ``title:`` → first ``# heading`` → filename stem.
    """
    # YAML frontmatter title
    m = re.search(
        r"^---\n[\s\S]*?^title:\s*[\"']?(.+?)[\"']?\s*$",
        content,
        re.MULTILINE,
    )
    if m:
        return m.group(1).strip()

    # First heading
    m = re.search(r"^#\s+(.+)$", content, re.MULTILINE)
    if m:
        return m.group(1).strip()

    # Filename stem
    return Path(filename).stem.replace("-", " ")


def _build_snippet(content: str, query: str) -> str:
    """Build a context snippet around the first query match."""
    lower = content.lower()
    lower_query = query.lower()
    idx = lower.find(lower_query)
    if idx == -1:
        snippet = content[: SNIPPET_CONTEXT * 2].replace("\n", " ")
    else:
        start = max(0, idx - SNIPPET_CONTEXT)
        end = min(len(content), idx + len(query) + SNIPPET_CONTEXT)
        snippet = content[start:end].replace("\n", " ")
        if start > 0:
            snippet = "..." + snippet
        if end < len(content):
            snippet = snippet + "..."
    return snippet


def _highlight_snippet(snippet: str, tokens: list[str], query_phrase: str) -> str:
    """Add ``<mark>`` tags around matched tokens in a snippet for display.

    Uses ``<mark>...</mark>`` tags so the frontend can style them.
    """
    if not tokens and not query_phrase:
        return snippet

    result = snippet

    # Highlight the full phrase first (higher priority)
    if query_phrase:
        pattern = re.compile(re.escape(query_phrase), re.IGNORECASE)
        result = pattern.sub(lambda m: f"<mark>{m.group(0)}</mark>", result)

    # Highlight individual tokens that aren't already inside a <mark> tag
    for token in tokens:
        if len(token) < 2:
            continue
        # Skip tokens that are substrings of the query phrase (already highlighted)
        if query_phrase and token in query_phrase:
            continue
        pattern = re.compile(re.escape(token), re.IGNORECASE)

        def _replace_non_marked(m: re.Match, _text: str = result) -> str:
            # Check if this match is inside an existing <mark> tag
            before = _text[:m.start()]
            open_count = before.count("<mark>")
            close_count = before.count("</mark>")
            if open_count > close_count:
                return m.group(0)  # Already inside a <mark>
            return f"<mark>{m.group(0)}</mark>"

        new_result = pattern.sub(_replace_non_marked, result)
        if new_result != result:
            result = new_result

    return result


# ── Search cache ────────────────────────────────────────────────────────────

class _SearchCache:
    """LRU cache for wiki search results with TTL expiry.

    Keyed by (wiki_root, query, max_results).  Entries older than
    ``ttl_seconds`` are lazily evicted on access.
    """

    def __init__(self, maxsize: int = 128, ttl_seconds: float = 300.0) -> None:
        self._maxsize = maxsize
        self._ttl = ttl_seconds
        self._cache: OrderedDict[str, tuple[float, list[SearchResult]]] = OrderedDict()

    def _make_key(self, wiki_root: str, query: str, max_results: int) -> str:
        raw = f"{wiki_root}|{query}|{max_results}"
        return hashlib.md5(raw.encode()).hexdigest()

    def get(self, wiki_root: str, query: str, max_results: int) -> list[SearchResult] | None:
        key = self._make_key(wiki_root, query, max_results)
        entry = self._cache.get(key)
        if entry is None:
            return None
        ts, results = entry
        if time.monotonic() - ts > self._ttl:
            del self._cache[key]
            return None
        # Move to end (most recently used)
        self._cache.move_to_end(key)
        return results

    def put(self, wiki_root: str, query: str, max_results: int, results: list[SearchResult]) -> None:
        key = self._make_key(wiki_root, query, max_results)
        self._cache[key] = (time.monotonic(), results)
        self._cache.move_to_end(key)
        # Evict oldest entries if over capacity
        while len(self._cache) > self._maxsize:
            self._cache.popitem(last=False)

    def invalidate(self, wiki_root: str) -> None:
        """Invalidate all cache entries for a given wiki root.

        Since we hash the key, we clear the whole cache when any write
        occurs (writes are infrequent compared to reads).
        """
        self._cache.clear()


# Module-level singleton
_search_cache = _SearchCache()


def invalidate_search_cache(wiki_root: str) -> None:
    """Invalidate the search cache for the given wiki root.

    Should be called after any write/merge/delete operation.
    """
    _search_cache.invalidate(wiki_root)


def _score_file(
    file_path: Path,
    content: str,
    tokens: list[str],
    query_phrase: str,
    query: str,
) -> SearchResult | None:
    """Pure scoring pass — no IO."""
    filename = file_path.name
    title = _extract_title(content, filename)
    title_text = f"{title} {filename}"
    title_lower = title_text.lower()
    content_lower = content.lower()
    file_stem = file_path.stem.lower()

    # Exact-match signals (strongest)
    filename_exact = file_stem == query_phrase
    title_has_phrase = bool(query_phrase and query_phrase in title_lower)
    content_phrase_occ = min(
        _count_occurrences(content_lower, query_phrase),
        MAX_PHRASE_OCC_COUNTED,
    )

    # Token-level signals
    title_token_score = _token_match_score(title_text, tokens)
    content_token_score = _token_match_score(content, tokens)

    if (
        not filename_exact
        and not title_has_phrase
        and content_phrase_occ == 0
        and title_token_score == 0
        and content_token_score == 0
    ):
        return None

    score = (
        (FILENAME_EXACT_BONUS if filename_exact else 0)
        + (PHRASE_IN_TITLE_BONUS if title_has_phrase else 0)
        + content_phrase_occ * PHRASE_IN_CONTENT_PER_OCC
        + title_token_score * TITLE_TOKEN_WEIGHT
        + content_token_score * CONTENT_TOKEN_WEIGHT
    )

    is_title_match = title_token_score > 0 or title_has_phrase

    snippet_anchor = (
        query_phrase
        if content_phrase_occ > 0
        else next((t for t in tokens if t in content_lower), query)
    )

    # Extract category from path: <wiki_root>/<category>/<file>.md
    rel_parts = file_path.parts
    category = ""
    if len(rel_parts) >= 2:
        category = rel_parts[-2]

    snippet = _build_snippet(content, snippet_anchor)
    highlighted = _highlight_snippet(snippet, tokens, query_phrase)

    return SearchResult(
        path=str(file_path),
        page_id=file_path.stem,
        title=title,
        category=category,
        snippet=snippet,
        highlighted_snippet=highlighted,
        title_match=is_title_match,
        score=score,
    )


def search_wiki(
    wiki_root: str,
    query: str,
    max_results: int = MAX_RESULTS,
) -> list[SearchResult]:
    """Search wiki pages under ``wiki_root`` for the given query.

    Walks all ``.md`` files in category subdirectories, scores them
    using the token + phrase scoring system, and returns ranked results.
    Results are cached with a 5-minute TTL.
    """
    if not query.strip():
        return []

    root = Path(wiki_root)
    if not root.is_dir():
        return []

    # Check cache first
    cached = _search_cache.get(wiki_root, query, max_results)
    if cached is not None:
        return cached

    tokens = tokenize_query(query)
    # Fallback: if all tokens were filtered, use the trimmed query
    effective_tokens = tokens if tokens else [query.strip().lower()]

    query_phrase = _TRIM_PUNCT_RE.sub("", query.strip().lower())

    results: list[SearchResult] = []

    # Walk all .md files in category subdirectories
    for category_dir in sorted(root.iterdir()):
        if not category_dir.is_dir():
            continue
        for md_file in sorted(category_dir.glob("*.md")):
            try:
                content = md_file.read_text(encoding="utf-8", errors="replace")
            except OSError:
                continue
            result = _score_file(md_file, content, effective_tokens, query_phrase, query)
            if result is not None:
                results.append(result)

    # Sort by score descending; ties broken by alphabetical path
    results.sort(key=lambda r: (-r.score, r.path))
    results = results[:max_results]

    # Store in cache
    _search_cache.put(wiki_root, query, max_results, results)

    return results
