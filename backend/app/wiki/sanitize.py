"""Content sanitization for LLM-generated wiki pages.

Ported from nashsu/llm_wiki ``src/lib/ingest-sanitize.ts``.

Fixes three classes of common LLM output problems before writing to disk:

1. **Code fence wrapping** (~45% of LLM output): The entire page is
   wrapped in ```yaml ... ``` fences.  We detect and strip them.
2. **Frontmatter prefix**: Some models emit ``frontmatter:`` as a key
   before the ``---`` delimiter.  We remove it.
3. **Non-YAML list syntax**: ``related: [[a]], [[b]]`` is not valid
   YAML; we rewrite it as ``related: ["[[a]]", "[[b]]"]``.
"""

from __future__ import annotations

import re


# Matches a code fence that wraps the entire document:
#   ```yaml\n---\n...frontmatter...\n---\n...body...\n```
# or just ```\n...\n```
_FULL_FENCE_RE = re.compile(
    r"^```[a-zA-Z]*\s*\n"  # opening fence with optional language tag
    r"([\s\S]+?)\n"         # content
    r"```\s*$",             # closing fence
)

# Matches ``frontmatter:`` key before a ``---`` line
_FRONTMATTER_PREFIX_RE = re.compile(r"^frontmatter:\s*\n(---\n)", re.MULTILINE)

# Matches ``related: [[a]], [[b]]`` or ``tags: [[a]], [[b]]``
# which is NOT valid YAML — we rewrite to proper list syntax.
_BARE_WIKILINK_LIST_RE = re.compile(
    r"^(related|tags|sources):\s*((?:\[\[[^\]]+\]\]\s*(?:,\s*)?)+)\s*$",
    re.MULTILINE,
)


def sanitize_wiki_content(content: str) -> str:
    """Clean LLM-generated wiki content before writing to disk.

    Applies three fix-ups in order:
      1. Strip code fences wrapping the entire page
      2. Remove ``frontmatter:`` prefix key
      3. Rewrite bare wikilink lists to YAML array syntax

    Returns the cleaned content.  If the content does not have any
    of these issues, it is returned unchanged.
    """
    result = content

    # ── Fix 1: Strip full-page code fences ────────────────────────
    m = _FULL_FENCE_RE.match(result)
    if m:
        result = m.group(1)

    # ── Fix 2: Remove ``frontmatter:`` prefix ─────────────────────
    result = _FRONTMATTER_PREFIX_RE.sub(r"\1", result)

    # ── Fix 3: Rewrite bare wikilink lists ────────────────────────
    #   related: [[a]], [[b]]  →  related: ["[[a]]", "[[b]]"]
    def _rewrite_wikilink_list(m: re.Match) -> str:
        field = m.group(1)
        raw = m.group(2)
        # Extract individual [[...]] items
        items = re.findall(r"\[\[[^\]]+\]\]", raw)
        if not items:
            return m.group(0)
        items_str = ", ".join(f'"{item}"' for item in items)
        return f"{field}: [{items_str}]"

    result = _BARE_WIKILINK_LIST_RE.sub(_rewrite_wikilink_list, result)

    return result
