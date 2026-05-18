"""Wikilink parsing and wiki page path resolution.

Ported from nashsu/llm_wiki ``src/lib/wiki-page-resolver.ts``, simplified
to use pathlib instead of the FileNode tree (which is Tauri-specific).
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class WikilinkInfo:
    """Parsed result of a ``[[target|alias]]`` wikilink."""

    slug: str
    label: str


def unwrap_wikilink(s: str) -> WikilinkInfo:
    """Strip ``[[target|alias]]`` wrapping from a value.

    Returns ``{slug: s, label: s}`` for non-wikilink input.
    """
    s = s.strip()
    if s.startswith("[[") and s.endswith("]]"):
        inner = s[2:-2]
        if "|" in inner:
            target, alias = inner.split("|", 1)
            target = target.strip()
            alias = alias.strip()
            if alias:
                return WikilinkInfo(slug=target, label=alias)
            return WikilinkInfo(slug=target, label=target)
        return WikilinkInfo(slug=inner.strip(), label=inner.strip())
    return WikilinkInfo(slug=s, label=s)


def resolve_wiki_page(wiki_root: str, slug: str) -> str | None:
    """Find a wiki page by slug under the wiki root.

    Searches all category subdirectories for a file whose stem matches
    the slug (after normalising hyphens).  Returns the absolute path
    of the first match, or ``None``.
    """
    root = Path(wiki_root)
    if not root.is_dir():
        return None

    # Try exact filename first (slug.md in any category dir)
    target_name = f"{slug}.md" if not slug.endswith(".md") else slug
    for category_dir in sorted(root.iterdir()):
        if not category_dir.is_dir():
            continue
        candidate = category_dir / target_name
        if candidate.is_file():
            return str(candidate)

    # Try matching by file stem (slug may have different hyphenation
    # from the actual filename which includes a date stamp).
    # Normalize input: spaces → hyphens, lowercase (same as make_query_slug).
    slug_lower = slug.lower().replace(" ", "-").replace("_", "-")
    for category_dir in sorted(root.iterdir()):
        if not category_dir.is_dir():
            continue
        for md_file in sorted(category_dir.glob("*.md")):
            stem = md_file.stem.lower()
            # Strip the trailing "-YYYY-MM-DD-HHMMSS" date pattern
            base = _strip_date_suffix(stem)
            if base == slug_lower:
                return str(md_file)

    return None


def resolve_related_slug(wiki_root: str, ref: str) -> str | None:
    """Resolve a ``related:`` reference to an absolute wiki page path.

    Accepts three shapes:
      1. path-like: ``wiki/entities/dpao.md`` → resolve relative to project root
      2. bare filename: ``dpao.md`` → search wiki/ subdirs
      3. bare slug: ``dpao`` → search wiki/ subdirs
    """
    root = Path(wiki_root)

    # Path-like → resolve relative to project root (parent of wiki/)
    if "/" in ref or os.sep in ref:
        project_root = str(root.parent)
        target = os.path.join(project_root, ref)
        if os.path.isfile(target) and wiki_root in target:
            return target
        return None

    # Bare filename or slug
    filename = ref if ref.endswith(".md") else f"{ref}.md"
    for category_dir in sorted(root.iterdir()):
        if not category_dir.is_dir():
            continue
        candidate = category_dir / filename
        if candidate.is_file():
            return str(candidate)

    return None


# Pattern: slug-YYYY-MM-DD-HHMMSS
_DATE_SUFFIX_RE = re.compile(r"-\d{4}-\d{2}-\d{2}-\d{6}$")


def _strip_date_suffix(stem: str) -> str:
    """Remove the trailing ``-YYYY-MM-DD-HHMMSS`` date pattern from a stem."""
    m = _DATE_SUFFIX_RE.search(stem)
    if m:
        return stem[: m.start()]
    return stem
