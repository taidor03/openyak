"""Pure string-level helpers for cleaning up wiki files.

Ported from nashsu/llm_wiki ``src/lib/wiki-cleanup.ts``.

Fixes two classes of real bugs the previous inline logic had:

  Bug A (silent false NEGATIVE — stale refs left behind):
    The index cleanup matched page slugs against ``index.md`` lines via
    ``line.toLowerCase().includes(slug)``, so a wikilink written with
    the human title form — ``[[KV Cache]]`` — never matched the
    underlying file slug ``kv-cache``.

  Bug B (silent false POSITIVE — innocent siblings wiped):
    Substring ``includes`` matching meant a deleted slug that happened
    to appear as a fragment of any other wikilink took that wikilink
    down with it.  Deleting ``ai.md`` would wipe ``[[OpenAI]]``.

The fix: structural wikilink parsing + normalized-string comparison,
with title AND slug collected for every deleted page.
"""

from __future__ import annotations

import re
from dataclasses import dataclass


@dataclass(frozen=True)
class DeletedPageInfo:
    """Info about a page that was actually deleted."""

    slug: str
    title: str = ""


# Matches a markdown list item whose first wikilink is the logical
# "subject" of the line.  ``- [[Target]] description`` / ``* [[T|D]]``.
_INDEX_ENTRY_RE = re.compile(r"^\s*[-*]\s*\[\[([^\]|]+?)(?:\|[^\]]+)?\]\]")

# Matches ``[[target]]`` or ``[[target|alias]]`` wikilinks.
_WIKILINK_RE = re.compile(r"\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]")


def normalize_wiki_ref_key(s: str) -> str:
    """Canonicalise a label so lookups are insensitive to case, and
    the space/hyphen/underscore boundary between "display title" and
    "file slug".

    All three of these collapse to the same key::

        "KV Cache"   → "kvcache"
        "kv-cache"   → "kvcache"
        "kv_cache"   → "kvcache"
        "wiki/concepts/kv-cache.md" → "kvcache"

    Strips path prefixes and a trailing ``.md`` because wiki refs may
    be written as bare slugs, filenames, or paths.
    """
    normalized = s.strip().replace("\\", "/")
    leaf = normalized.split("/")[-1] if "/" in normalized else normalized
    without_md = leaf[:-3] if leaf.lower().endswith(".md") else leaf
    return re.sub(r"[\s\-_]+", "", without_md.lower())


def build_deleted_keys(infos: list[DeletedPageInfo]) -> set[str]:
    """Build the lookup set of normalized keys for a batch of deletions.

    The set contains BOTH the slug-form and title-form of each page,
    so a wikilink written either way will match.
    """
    keys: set[str] = set()
    for info in infos:
        if info.slug:
            keys.add(normalize_wiki_ref_key(info.slug))
        if info.title:
            keys.add(normalize_wiki_ref_key(info.title))
    return keys


def extract_frontmatter_title(content: str) -> str:
    """Extract the ``title:`` value from YAML-ish markdown frontmatter.

    Returns empty string when no title line is found.

    Tolerates::

        title: KV Cache
        title: "KV Cache"
        title: 'KV Cache'
        title:   KV Cache
    """
    m = re.search(r"^title:\s*[\"']?(.+?)[\"']?\s*$", content, re.MULTILINE)
    return m.group(1).strip() if m else ""


def clean_index_listing(text: str, deleted_keys: set[str]) -> str:
    """Drop list-item lines from an index-style file when their primary
    wikilink targets a deleted page.

    Every other line (headers, prose, frontmatter, blank lines, list
    items with non-deleted primaries) is preserved verbatim.

    This is anchored to the wikilink structure, not fuzzy substring
    matching, so ``[[OpenAI]]`` is untouched when "ai" is a deleted slug.
    """
    if not deleted_keys:
        return text

    lines = text.split("\n")
    filtered = []
    for line in lines:
        m = _INDEX_ENTRY_RE.match(line)
        if m and normalize_wiki_ref_key(m.group(1).strip()) in deleted_keys:
            continue
        filtered.append(line)
    return "\n".join(filtered)


def strip_deleted_wikilinks(text: str, deleted_keys: set[str]) -> str:
    """Replace wikilinks pointing to deleted pages with plain text,
    leaving wikilinks to surviving pages alone.

    ``[[deleted]]``         → ``deleted``
    ``[[deleted|display]]`` → ``display``
    ``[[kept]]``            → ``[[kept]]``  (unchanged)
    """

    def _replacer(m: re.Match) -> str:
        target = m.group(1).strip()
        display = m.group(2)
        key = normalize_wiki_ref_key(target)
        if key not in deleted_keys:
            return m.group(0)  # keep original wikilink
        return display if display else target

    if not deleted_keys:
        return text
    return _WIKILINK_RE.sub(_replacer, text)


# ── Section-level merge helpers ──────────────────────────────────────────


def parse_sections(body: str) -> list[tuple[str | None, str, int]]:
    """Parse a markdown body into a list of (heading, content, level) tuples.

    Heading is ``None`` and level is ``0`` for the preamble (content before
    the first ``##``).  Only ``##`` (h2) headings and deeper are treated as
    section boundaries; ``#`` (h1) is treated as regular content because
    wiki pages already have a top-level title in the frontmatter.

    The *level* is the number of ``#`` characters (2–6), preserved so that
    :func:`merge_sections` can emit the correct heading prefix instead of
    hard-coding ``##``.

    Returns a non-empty list — if the body is empty, returns
    ``[(None, "", 0)]``.
    """
    sections: list[tuple[str | None, str, int]] = []
    current_heading: str | None = None
    current_level: int = 0
    current_lines: list[str] = []

    for line in body.split("\n"):
        h_match = re.match(r"^(#{2,6})\s+(.+)$", line)
        if h_match:
            # Flush previous section
            if current_lines:
                sections.append((current_heading, "\n".join(current_lines), current_level))
                current_lines = []
            current_heading = h_match.group(2).strip()
            current_level = len(h_match.group(1))
        else:
            current_lines.append(line)

    # Flush last section
    if current_lines:
        sections.append((current_heading, "\n".join(current_lines), current_level))

    # If body was empty or only whitespace
    if not sections:
        sections.append((None, "", 0))

    return sections


def merge_sections(
    existing_body: str,
    new_sections_text: str,
) -> str:
    """Merge new sections into an existing page body by heading match.

    Rules:
    - Preamble (content before first ``##``) from **existing** is always preserved.
    - New sections with a heading that matches an existing heading **replace**
      the existing section (case-insensitive match after normalizing spaces).
      The heading level (number of ``#``) is preserved from the existing
      page so that ``### Sub`` does not get collapsed to ``## Sub``.
    - New sections without a match are **appended** at the end using their
      own heading level.
    - Section order from the existing body is preserved; replaced sections
      stay in their original position.

    This is a pure algorithmic merge — no LLM call required.
    """
    existing = parse_sections(existing_body)
    incoming = parse_sections(new_sections_text)

    # Build a lookup for incoming sections by normalized heading
    incoming_by_heading: dict[str, tuple[str | None, str, int]] = {}
    append_order: list[str] = []  # headings in the order they appear in new
    for heading, content, level in incoming:
        if heading is None:
            continue  # skip preamble from incoming
        key = normalize_wiki_ref_key(heading)
        incoming_by_heading[key] = (heading, content, level)
        append_order.append(key)

    # Track which incoming headings were matched
    matched_keys: set[str] = set()

    # Build result: preserve existing order, replace matching headings
    result_parts: list[str] = []
    for heading, content, level in existing:
        if heading is not None:
            key = normalize_wiki_ref_key(heading)
            if key in incoming_by_heading:
                # Replace with incoming content, but keep the ORIGINAL
                # heading level so the document structure is preserved.
                _, new_content, _ = incoming_by_heading[key]
                prefix = "#" * level
                result_parts.append(f"{prefix} {heading}\n{new_content}")
                matched_keys.add(key)
                continue
        # Keep existing section as-is
        if heading is not None:
            prefix = "#" * level
            result_parts.append(f"{prefix} {heading}\n{content}")
        else:
            result_parts.append(content)

    # Append any incoming sections that didn't match
    for key in append_order:
        if key not in matched_keys:
            new_heading, new_content, new_level = incoming_by_heading[key]
            prefix = "#" * new_level
            result_parts.append(f"\n{prefix} {new_heading}\n{new_content}")

    return "\n".join(result_parts)
