"""Review Sweep -- two-phase automatic cleanup of wiki issues.

Ported from nashsu/llm_wiki ``src/lib/review-sweep.ts``, adapted for Python.

Phase 1 -- Rule-based cleanup (pure code, no LLM):
  - Remove broken wikilinks from pages
  - Remove empty frontmatter fields
  - Fix duplicate frontmatter fields
  - Sanitize content formatting

Phase 2 -- LLM semantic cleanup (optional):
  - Detect stale content, contradictions, duplicate entities
  - Conservative strategy: flag issues as review items rather than auto-fix
"""

from __future__ import annotations

import json
import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.wiki.cleanup import extract_frontmatter_title, normalize_wiki_ref_key
from app.wiki.sanitize import sanitize_wiki_content

logger = logging.getLogger(__name__)

# ── Semantic sweep prompt ─────────────────────────────────────────────────

_SEMANTIC_SWEEP_PROMPT = """\
You are a wiki quality auditor. Analyze the following wiki pages and identify
semantic issues that require human review.

For each issue found, output a JSON block in this exact format:

```json
{{
  "type": "stale|contradiction|duplicate_entity|orphan",
  "severity": "info|warning|critical",
  "title": "<page title>",
  "message": "<concise description of the issue>",
  "suggestion": "<how to fix it, or null>"
}}
```

Types:
- stale: Content appears outdated or references deprecated information
- contradiction: Page content contradicts another page
- duplicate_entity: Two pages describe essentially the same concept
- orphan: Page has no incoming links and seems disconnected from the wiki

Be CONSERVATIVE — only flag clear issues. When in doubt, skip.
Do NOT output anything outside the JSON blocks.

WIKI PAGES:
{pages}
"""

_SEMANTIC_ISSUE_RE = re.compile(
    r'\{\s*"type"\s*:\s*"(stale|contradiction|duplicate_entity|orphan)"'
    r'[\s\S]*?"message"\s*:\s*"[^"]*"[\s\S]*?\}',
    re.MULTILINE,
)


# ── Helpers ───────────────────────────────────────────────────────────────

def _find_all_existing_slugs(wiki_root: str) -> set[str]:
    root = Path(wiki_root)
    slugs: set[str] = set()
    if not root.is_dir():
        return slugs
    for cat_dir in root.iterdir():
        if not cat_dir.is_dir():
            continue
        for md_file in cat_dir.glob("*.md"):
            slugs.add(md_file.stem)
            try:
                head = md_file.read_text(1024, encoding="utf-8")
                title = extract_frontmatter_title(head)
                if title:
                    slugs.add(normalize_wiki_ref_key(title))
            except OSError:
                pass
    return slugs


def _remove_broken_wikilinks(content: str, valid_slugs: set[str]) -> tuple[str, int]:
    def replace_link(match: re.Match) -> str:
        target = match.group(1)
        actual_target = target.split("|")[0].strip()
        key = normalize_wiki_ref_key(actual_target)
        if key in valid_slugs:
            return match.group(0)
        if "|" in target:
            alias = target.split("|")[1].strip()
            return alias
        return actual_target

    pattern = r"\[\[([^\]]+)\]\]"
    cleaned = re.sub(pattern, replace_link, content)
    removals = len(re.findall(pattern, content)) - len(re.findall(pattern, cleaned))
    return cleaned, max(0, removals)


def _clean_frontmatter(content: str) -> tuple[str, list[str]]:
    fm_match = re.match(r"^(---\n)([\s\S]*?)(---\n)", content)
    if not fm_match:
        return content, []

    fm_prefix = fm_match.group(1)
    fm_body = fm_match.group(2)
    fm_suffix = fm_match.group(3)
    body = content[fm_match.end():]

    fixes: list[str] = []
    lines = fm_body.split("\n")
    seen_fields: dict[str, int] = {}
    cleaned_lines: list[str] = []

    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            cleaned_lines.append(line)
            continue

        colon_idx = stripped.find(":")
        if colon_idx == -1:
            cleaned_lines.append(line)
            continue

        field_name = stripped[:colon_idx].strip()
        field_value = stripped[colon_idx + 1:].strip()

        if field_value in ("[]", "[ ]", "''", '""'):
            fixes.append(f"Removed empty field: {field_name}")
            continue

        if field_name in seen_fields:
            prev_idx = seen_fields[field_name]
            if prev_idx < len(cleaned_lines):
                cleaned_lines[prev_idx] = ""
                fixes.append(f"Removed duplicate field: {field_name}")
            cleaned_lines.append(line)
            seen_fields[field_name] = len(cleaned_lines) - 1
            continue

        seen_fields[field_name] = len(cleaned_lines)
        cleaned_lines.append(line)

    cleaned_fm = "\n".join(line for line in cleaned_lines if line is not None)
    cleaned_content = fm_prefix + cleaned_fm + "\n" + fm_suffix + body
    return cleaned_content, fixes


def _collect_page_summaries(wiki_root: str, max_pages: int = 30, max_chars: int = 800) -> list[str]:
    """Collect truncated page summaries for LLM analysis."""
    root = Path(wiki_root)
    if not root.is_dir():
        return []

    summaries: list[str] = []
    for cat_dir in sorted(root.iterdir()):
        if not cat_dir.is_dir():
            continue
        for md_file in sorted(cat_dir.glob("*.md")):
            if len(summaries) >= max_pages:
                break
            try:
                content = md_file.read_text(encoding="utf-8")
            except OSError:
                continue

            title = extract_frontmatter_title(content) or md_file.stem
            body = re.sub(r"^---\n[\s\S]*?---\n", "", content)
            summary = body[:max_chars].strip()
            if summary:
                summaries.append(f"## {title} ({cat_dir.name})\n{summary}")

    return summaries


def _parse_semantic_issues(response: str) -> list[dict[str, Any]]:
    """Parse LLM response into structured semantic issues."""
    issues: list[dict[str, Any]] = []
    for m in _SEMANTIC_ISSUE_RE.finditer(response):
        try:
            issue = json.loads(m.group(0))
            # Validate required fields
            if "type" in issue and "message" in issue:
                issues.append({
                    "type": issue.get("type", "unknown"),
                    "severity": issue.get("severity", "info"),
                    "title": issue.get("title", ""),
                    "message": issue.get("message", ""),
                    "suggestion": issue.get("suggestion"),
                })
        except json.JSONDecodeError:
            continue
    return issues


# ── Phase 1: Rule-based sweep ────────────────────────────────────────────

def sweep_rules(wiki_root: str) -> dict[str, Any]:
    """Execute Phase 1 rule-based cleanup."""
    root = Path(wiki_root)
    if not root.is_dir():
        return {"pages_cleaned": 0, "fixes": [], "error": "Wiki root not found"}

    valid_slugs = _find_all_existing_slugs(wiki_root)
    all_fixes: list[dict[str, str]] = []
    pages_cleaned = 0

    for cat_dir in root.iterdir():
        if not cat_dir.is_dir():
            continue
        for md_file in cat_dir.glob("*.md"):
            try:
                content = md_file.read_text(encoding="utf-8")
            except OSError:
                continue

            original = content
            page_fixes: list[str] = []

            content, removals = _remove_broken_wikilinks(content, valid_slugs)
            if removals > 0:
                page_fixes.append(f"Removed {removals} broken wikilink(s)")

            content, fm_fixes = _clean_frontmatter(content)
            page_fixes.extend(fm_fixes)

            before_sanitize = content
            content = sanitize_wiki_content(content)
            if content != before_sanitize:
                page_fixes.append("Fixed content formatting")

            if content != original:
                md_file.write_text(content, encoding="utf-8")
                pages_cleaned += 1
                title = extract_frontmatter_title(original) or md_file.stem
                for fix in page_fixes:
                    all_fixes.append({"page": title, "fix": fix})

    return {
        "pages_cleaned": pages_cleaned,
        "total_fixes": len(all_fixes),
        "fixes": all_fixes,
        "phase": "rule-based",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# ── Phase 2: LLM semantic sweep ─────────────────────────────────────────

async def sweep_semantic(
    wiki_root: str,
    llm_call_fn: Any = None,
) -> dict[str, Any]:
    """Phase 2 semantic cleanup — LLM-driven quality audit.

    Uses an async callable ``llm_call_fn`` that accepts a prompt string
    and returns the LLM response text.  Follows the same pattern as
    ``lint.run_semantic_lint``.

    Conservative strategy: issues are flagged as review items for human
    approval rather than being auto-fixed. This prevents LLM hallucinations
    from silently corrupting wiki content.

    Args:
        wiki_root: Path to the wiki root directory.
        llm_call_fn: Async callable for LLM inference. If None, returns
            a stub result indicating the feature requires LLM integration.
    """
    timestamp = datetime.now(timezone.utc).isoformat()

    if llm_call_fn is None:
        return {
            "pages_analyzed": 0,
            "issues_found": 0,
            "issues": [],
            "phase": "semantic",
            "status": "skipped",
            "message": "Semantic sweep requires an LLM call function (llm_call_fn)",
            "timestamp": timestamp,
        }

    root = Path(wiki_root)
    if not root.is_dir():
        return {
            "pages_analyzed": 0,
            "issues_found": 0,
            "issues": [],
            "phase": "semantic",
            "status": "error",
            "message": "Wiki root not found",
            "timestamp": timestamp,
        }

    # Collect page summaries for LLM analysis
    summaries = _collect_page_summaries(wiki_root)
    if not summaries:
        return {
            "pages_analyzed": 0,
            "issues_found": 0,
            "issues": [],
            "phase": "semantic",
            "status": "no_content",
            "message": "No wiki pages found to analyze",
            "timestamp": timestamp,
        }

    # Call LLM
    prompt = _SEMANTIC_SWEEP_PROMPT.format(pages="\n\n".join(summaries))
    try:
        response = await llm_call_fn(prompt)
    except Exception as exc:
        logger.warning("Semantic sweep LLM call failed: %s", exc)
        return {
            "pages_analyzed": len(summaries),
            "issues_found": 0,
            "issues": [],
            "phase": "semantic",
            "status": "llm_error",
            "message": f"LLM call failed: {exc}",
            "timestamp": timestamp,
        }

    if not response:
        return {
            "pages_analyzed": len(summaries),
            "issues_found": 0,
            "issues": [],
            "phase": "semantic",
            "status": "empty_response",
            "message": "LLM returned empty response",
            "timestamp": timestamp,
        }

    # Parse issues from LLM response
    issues = _parse_semantic_issues(response)

    return {
        "pages_analyzed": len(summaries),
        "issues_found": len(issues),
        "issues": issues,
        "phase": "semantic",
        "status": "completed",
        "timestamp": timestamp,
    }
