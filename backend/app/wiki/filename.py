"""Filename generation for wiki page writes.

Ported from nashsu/llm_wiki ``src/lib/wiki-filename.ts``.

Filename shape: ``{slug}-{YYYY-MM-DD}-{HHMMSS}.md``

Slug rules:
  - Unicode-aware: keeps letters & digits across all scripts
    (Latin, CJK, Cyrillic, Arabic …) plus ASCII hyphens.
  - NFKC-normalized so full-width characters don't drift from
    half-width equivalents.
  - Lowercased (no-op for scripts without case).
  - Whitespace → hyphen.
  - Collapses runs of hyphens, trims leading/trailing hyphens.
  - Truncated to 50 characters.
  - Falls back to ``"query"`` when nothing usable remains.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from datetime import datetime, timezone

# Unicode-aware pattern: keep Unicode letters (\\p{L}), Unicode digits (\\p{N}),
# and ASCII hyphens.  Python's ``\\w`` in UNICODE mode includes underscores
# which the original TS version does NOT keep, so we explicitly exclude them.
_KEEP_RE = re.compile(r"[^\w-]", re.UNICODE)
_UNDERSCORE_RE = re.compile(r"_")
_MULTI_HYPHEN_RE = re.compile(r"-+")
_EDGE_HYPHEN_RE = re.compile(r"^-|-$")
_SLUG_MAX_LEN = 50


def make_query_slug(title: str) -> str:
    """Produce a URL-safe slug from a free-form title.

    Mirrors ``makeQuerySlug`` from the TS source.  CJK titles produce
    meaningful slugs (e.g. "默会知识 概述" → "默会知识-概述") instead of
    collapsing to empty strings.
    """
    slug = unicodedata.normalize("NFKC", title).strip()
    # Whitespace → hyphen first so multi-word joins are preserved
    slug = re.sub(r"\s+", "-", slug)
    # Strip everything that isn't a Unicode letter, digit, or hyphen
    slug = _KEEP_RE.sub("", slug)
    # Remove underscores (Python \w includes them; TS version does not)
    slug = _UNDERSCORE_RE.sub("", slug)
    # Collapse multiple hyphens, trim edges
    slug = _MULTI_HYPHEN_RE.sub("-", slug)
    slug = _EDGE_HYPHEN_RE.sub("", slug)
    slug = slug.lower()
    slug = slug[:_SLUG_MAX_LEN]
    # Trim trailing hyphen that may result from truncation
    slug = slug.rstrip("-")
    return slug if slug else "query"


@dataclass(frozen=True)
class FilenameInfo:
    """Result of filename generation."""

    slug: str
    date: str
    time: str
    filename: str


def make_query_filename(
    title: str,
    now: datetime | None = None,
) -> FilenameInfo:
    """Produce the full wiki filename.

    Accepts an injected ``now`` for deterministic tests — production
    callers should omit it (defaults to UTC now).
    """
    if now is None:
        now = datetime.now(timezone.utc)

    slug = make_query_slug(title)
    # UTC timestamp — avoids DST / timezone-flipping surprises
    iso = now.isoformat()  # e.g. 2026-04-23T14:30:52.123456+00:00
    date = iso[:10]  # 2026-04-23
    time_part = iso[11:19].replace(":", "")  # 143052

    return FilenameInfo(
        slug=slug,
        date=date,
        time=time_part,
        filename=f"{slug}-{date}-{time_part}.md",
    )
