"""Wiki content quality checking (Lint).

Ported from nashsu/llm_wiki ``src/lib/lint.ts``, adapted for Python.

Two-layer architecture:
  1. Structural Lint (pure code, no LLM needed):
     - Orphan pages (no incoming links)
     - Broken wikilinks (target page does not exist)
     - No outlinks (page has no [[wikilinks]] to other pages)

  2. Semantic Lint (LLM-driven):
     - Contradictions (conflicting claims across pages)
     - Stale information (outdated content)
     - Missing pages (heavily referenced but no dedicated page)
     - Suggestions (worth adding to wiki)
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.wiki.cleanup import extract_frontmatter_title, normalize_wiki_ref_key
from app.wiki.constants import DEFAULT_CATEGORIES
from app.wiki.contradiction import find_contradiction_candidates

logger = logging.getLogger(__name__)

_WIKILINK_RE = re.compile(r"\[\[([^\]|]+?)(?:\|[^\]]+)?\]\]")

# ── Data types ──────────────────────────────────────────────────────────────

@dataclass
class LintIssue:
    """A single lint issue found in the wiki."""

    type: str
    severity: str  # info | warning
    page_id: str = ""
    title: str = ""
    category: str = ""
    message: str = ""
    detail: dict[str, Any] = field(default_factory=dict)


# ── Structural Lint ─────────────────────────────────────────────────────────

def run_structural_lint(wiki_root: str) -> list[LintIssue]:
    """Run structural lint checks (pure code, no LLM needed).

    Checks:
    - Orphan pages: pages with no incoming links (excluding index.md, log.md)
    - Broken wikilinks: [[wikilink]] targets that don't exist
    - No outlinks: pages that don't link to any other page
    """
    root = Path(wiki_root)
    if not root.is_dir():
        return []

    issues: list[LintIssue] = []

    # Phase 1: collect all pages
    all_pages: dict[str, dict[str, str]] = {}  # normalized_key -> info
    page_outlinks: dict[str, list[str]] = {}  # normalized_key -> [target_keys]
    page_bodies: dict[str, str] = {}  # normalized_key -> body

    for cat in DEFAULT_CATEGORIES:
        cat_dir = root / cat
        if not cat_dir.is_dir():
            continue
        for md_file in cat_dir.glob("*.md"):
            try:
                content = md_file.read_text(encoding="utf-8")
            except OSError:
                continue

            title = extract_frontmatter_title(content)
            if not title:
                title = md_file.stem.replace("-", " ")
            key = normalize_wiki_ref_key(title)
            info = {
                "title": title,
                "category": cat,
                "page_id": md_file.stem,
            }
            all_pages[key] = info

            # Extract body (strip frontmatter)
            body = re.sub(r"^---\n[\s\S]*?---\n", "", content)
            page_bodies[key] = body

            # Extract wikilinks from body
            links = []
            for m in _WIKILINK_RE.finditer(body):
                target = m.group(1).strip()
                target_key = normalize_wiki_ref_key(target)
                links.append(target_key)
            page_outlinks[key] = links

    if not all_pages:
        return []

    # Phase 2: check for broken wikilinks and count incoming links
    incoming: dict[str, int] = {}
    for source_key, targets in page_outlinks.items():
        for target_key in targets:
            incoming[target_key] = incoming.get(target_key, 0) + 1
            # Broken wikilink: target doesn't exist
            if target_key not in all_pages:
                source_info = all_pages[source_key]
                issues.append(LintIssue(
                    type="broken-link",
                    severity="warning",
                    page_id=source_info["page_id"],
                    title=source_info["title"],
                    category=source_info["category"],
                    message=(
                        f"Page '{source_info['title']}' links to "
                        f"'{target_key}' which does not exist"
                    ),
                    detail={"target": target_key},
                ))

    # Phase 3: check for orphans and no-outlinks
    for key, info in all_pages.items():
        # Orphan: no incoming links
        in_count = incoming.get(key, 0)
        if in_count == 0:
            issues.append(LintIssue(
                type="orphan",
                severity="info",
                page_id=info["page_id"],
                title=info["title"],
                category=info["category"],
                message=f"Page '{info['title']}' has no incoming links",
            ))

        # No outlinks: page doesn't link to anything
        out_count = len(page_outlinks.get(key, []))
        if out_count == 0:
            issues.append(LintIssue(
                type="no-outlinks",
                severity="info",
                page_id=info["page_id"],
                title=info["title"],
                category=info["category"],
                message=f"Page '{info['title']}' has no outgoing wikilinks",
            ))

    return issues


# ── Semantic Lint ───────────────────────────────────────────────────────────

_SEMANTIC_LINT_PROMPT = """\
You are a wiki quality analyst. Review the following wiki page summaries and \
identify issues that cannot be detected by automated structural checks alone.

For each issue, output a block in this exact format:

---LINT: type | severity | title---
Description of the issue.
AFFECTED_PAGES: page_title_1, page_title_2
---END LINT---

Valid types:
- contradiction: Two or more pages make conflicting claims
- stale: Information appears outdated or superseded
- missing-page: An important concept is heavily referenced but has no dedicated page
- suggestion: A question or source worth adding to the wiki

Valid severities: warning, info

Rules:
- Only report genuine issues that require human attention
- Be specific about which pages are affected
- Do NOT report issues already detectable by structural checks (orphans, broken links)
- Output at most 10 issues
- If no semantic issues are found, output nothing

Wiki page summaries:
{summaries}
"""

_LINT_BLOCK_RE = re.compile(
    r"---LINT:\s*(\S+)\s*\|\s*(\S+)\s*\|\s*(.+?)---\n"
    r"([\s\S]*?)\n"
    r"AFFECTED_PAGES:\s*(.+?)\n"
    r"---END LINT---",
    re.MULTILINE,
)


async def run_semantic_lint(
    wiki_root: str,
    llm_call_fn: Any = None,
) -> list[LintIssue]:
    """Run semantic lint checks (LLM-driven).

    Requires an async callable ``llm_call_fn`` that accepts a prompt string
    and returns the LLM response text.  If not provided, only runs
    code-based contradiction candidate detection (keyword overlap).

    Checks:
    - Contradictions between pages (code-based + optional LLM)
    - Stale information (LLM)
    - Missing pages (heavily referenced concepts without a page) (LLM)
    - Suggestions for improvement (LLM)
    """
    issues: list[LintIssue] = []

    # ── Code-based contradiction candidates (always available) ──
    try:
        candidates = find_contradiction_candidates(wiki_root)
        for page_a, page_b, similarity in candidates:
            issues.append(LintIssue(
                type="contradiction",
                severity="warning",
                message=(
                    f"Pages '{page_a}' and '{page_b}' share significant keywords "
                    f"(similarity: {similarity:.0%}) — may contain contradictions. "
                    f"Use the contradiction prompt with an LLM to verify."
                ),
                detail={
                    "page_a": page_a,
                    "page_b": page_b,
                    "similarity": round(similarity, 3),
                    "verification": "llm_required",
                },
            ))
    except Exception as exc:
        logger.warning("Contradiction candidate detection failed: %s", exc)

    # ── LLM-driven semantic checks (optional) ──
    if llm_call_fn is None:
        logger.info("Semantic lint: code-based contradiction check done, LLM checks skipped")
        return issues

    root = Path(wiki_root)
    if not root.is_dir():
        return []

    # Phase 1: Collect page summaries
    summaries: list[str] = []
    for cat in DEFAULT_CATEGORIES:
        cat_dir = root / cat
        if not cat_dir.is_dir():
            continue
        for md_file in cat_dir.glob("*.md"):
            try:
                content = md_file.read_text(encoding="utf-8")
            except OSError:
                continue

            title = extract_frontmatter_title(content)
            if not title:
                title = md_file.stem.replace("-", " ")

            # Strip frontmatter and take first 500 chars as summary
            body = re.sub(r"^---\n[\s\S]*?---\n", "", content)
            summary = body[:500].strip()
            if not summary:
                continue

            summaries.append(f"## {title} ({cat})\n{summary}")

    if not summaries:
        return []

    # Phase 2: Call LLM
    prompt = _SEMANTIC_LINT_PROMPT.format(summaries="\n\n".join(summaries))
    try:
        response = await llm_call_fn(prompt)
    except Exception as e:
        logger.warning("Semantic lint LLM call failed: %s", e)
        return []

    if not response:
        return issues

    # Phase 3: Parse LINT blocks
    llm_issues: list[LintIssue] = []
    for m in _LINT_BLOCK_RE.finditer(response):
        raw_type = m.group(1).strip().lower()
        severity = m.group(2).strip().lower()
        title = m.group(3).strip()
        description = m.group(4).strip()
        affected_pages_str = m.group(5).strip()

        # Validate type
        valid_types = {"contradiction", "stale", "missing-page", "suggestion"}
        if raw_type not in valid_types:
            continue

        # Validate severity
        if severity not in {"warning", "info"}:
            severity = "info"

        # Parse affected pages
        affected_pages = [
            p.strip() for p in affected_pages_str.split(",")
            if p.strip()
        ]

        llm_issues.append(LintIssue(
            type="semantic",
            severity=severity,
            message=f"[{raw_type}] {title}: {description}",
            detail={
                "rawType": raw_type,
                "rawTitle": title,
                "description": description,
                "affectedPages": affected_pages,
            },
        ))

    issues.extend(llm_issues)
    return issues


# ── Combined Lint ───────────────────────────────────────────────────────────

async def lint_wiki(
    wiki_root: str,
    scope: str = "full",
    llm_call_fn: Any = None,
) -> dict[str, Any]:
    """Run wiki lint checks.

    Args:
        wiki_root: Path to the wiki root directory.
        scope: "structural" (pure code), "semantic" (LLM), or "full" (both).
        llm_call_fn: Async callable for LLM inference (needed for semantic lint).

    Returns:
        Dict with issues list, summary, and health status.
    """
    all_issues: list[LintIssue] = []

    if scope in ("structural", "full"):
        structural = run_structural_lint(wiki_root)
        all_issues.extend(structural)

    if scope in ("semantic", "full"):
        semantic = await run_semantic_lint(wiki_root, llm_call_fn)
        all_issues.extend(semantic)

    # Count pages checked
    root = Path(wiki_root)
    pages_checked = 0
    for cat in DEFAULT_CATEGORIES:
        cat_dir = root / cat
        if cat_dir.is_dir():
            pages_checked += len(list(cat_dir.glob("*.md")))

    warnings = sum(1 for i in all_issues if i.severity == "warning")
    total = len(all_issues)

    # Build summary
    summary: dict[str, int] = {}
    for issue in all_issues:
        issue_type = issue.type
        if issue_type == "semantic" and issue.detail.get("rawType"):
            issue_type = issue.detail["rawType"]
        summary[issue_type] = summary.get(issue_type, 0) + 1

    return {
        "issues": [
            {
                "type": i.type,
                "severity": i.severity,
                "page_id": i.page_id,
                "title": i.title,
                "category": i.category,
                "message": i.message,
                "detail": i.detail,
            }
            for i in all_issues
        ],
        "total_issues": total,
        "warnings": warnings,
        "healthy": total == 0,
        "pages_checked": pages_checked,
        "scope": scope,
        "summary": summary,
    }
