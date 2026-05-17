"""WikiService — high-level API for Wiki Knowledge Center operations.

Each method accepts an explicit ``wiki_root`` parameter, enabling
dynamic path switching per session (project-level vs global).
"""

from __future__ import annotations

import logging
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.wiki.cleanup import (
    DeletedPageInfo,
    build_deleted_keys,
    clean_index_listing,
    extract_frontmatter_title,
    merge_sections,
    normalize_wiki_ref_key,
    parse_sections,
    strip_deleted_wikilinks,
)
from app.wiki.filename import make_query_filename
from app.wiki.resolver import resolve_wiki_page, unwrap_wikilink
from app.wiki.search import SearchResult, search_wiki

logger = logging.getLogger(__name__)


def _extract_frontmatter_field(text: str, field: str) -> str | None:
    """Extract a single field value from YAML frontmatter.

    Returns ``None`` if the field is not found or the text has no frontmatter.
    Only reads the first 1 KB–worth of lines for efficiency.
    """
    in_fm = False
    for line in text.splitlines():
        stripped = line.strip()
        if stripped == "---":
            if not in_fm:
                in_fm = True
                continue
            else:
                break  # End of frontmatter
        if in_fm and stripped.startswith(f"{field}:"):
            return stripped[len(field) + 1:].strip() or None
    return None


# Default category subdirectories created on init
DEFAULT_CATEGORIES = [
    "entities",
    "concepts",
    "sources",
    "synthesis",
    "comparison",
    "queries",
]

# Default index.md content
_DEFAULT_INDEX = """# Knowledge Index

Welcome to the Wiki Knowledge Center. Pages are organized by category:

- **entities/** — People, organizations, projects, and other named entities
- **concepts/** — Key concepts, terms, and definitions
- **sources/** — Summaries of reference documents and materials
- **synthesis/** — Synthesized insights combining multiple sources
- **comparison/** — Comparisons and analyses
- **queries/** — Saved queries and research notes

<!-- Wiki pages will be indexed here automatically -->
"""


class WikiService:
    """Stateless service for Wiki operations.

    All methods take ``wiki_root`` as a parameter — no instance state
    is tied to a specific wiki root, making it safe to share across
    sessions with different workspaces.
    """

    @staticmethod
    def resolve_wiki_root(workspace: str | None) -> str | None:
        """Determine the wiki root directory.

        - Has workspace → ``{workspace}/.wiki``
        - No workspace → ``~/.xflow/wiki``

        Returns ``None`` only if the home directory cannot be determined.
        """
        if workspace and workspace != ".":
            return os.path.join(workspace, ".wiki")
        # Global wiki
        home = os.path.expanduser("~")
        if home == "~":
            return None  # Cannot determine home directory
        return os.path.join(home, ".xflow", "wiki")

    @staticmethod
    async def initialize(wiki_root: str) -> dict[str, Any]:
        """Initialize the wiki directory structure.

        Creates category subdirectories and a starter ``index.md``
        if they don't exist.  Idempotent — safe to call repeatedly.
        """
        root = Path(wiki_root)
        created_dirs: list[str] = []
        created_files: list[str] = []

        # Create root
        if not root.exists():
            root.mkdir(parents=True, exist_ok=True)
            created_dirs.append(str(root))

        # Create category subdirectories
        for cat in DEFAULT_CATEGORIES:
            cat_dir = root / cat
            if not cat_dir.exists():
                cat_dir.mkdir(parents=True, exist_ok=True)
                created_dirs.append(str(cat_dir))

        # Create index.md if missing
        index_path = root / "index.md"
        if not index_path.exists():
            index_path.write_text(_DEFAULT_INDEX, encoding="utf-8")
            created_files.append(str(index_path))

        return {
            "wiki_root": wiki_root,
            "initialized": True,
            "created_dirs": created_dirs,
            "created_files": created_files,
        }

    @staticmethod
    async def read_page(wiki_root: str, page_id: str) -> dict[str, Any] | None:
        """Read a wiki page by ID (slug or filename).

        Returns ``None`` if the page is not found.
        """
        # Try to resolve the page path
        page_path = resolve_wiki_page(wiki_root, page_id)
        if page_path is None:
            # Also try direct path (for index.md, etc.)
            direct = Path(wiki_root) / page_id
            if direct.is_file():
                page_path = str(direct)
            else:
                return None

        try:
            content = Path(page_path).read_text(encoding="utf-8")
        except OSError:
            return None

        title = extract_frontmatter_title(content)
        if not title:
            # Fallback to filename stem
            title = Path(page_path).stem.replace("-", " ")

        # Extract category from path
        rel_path = os.path.relpath(page_path, wiki_root)
        category = rel_path.split(os.sep)[0] if os.sep in rel_path else ""

        return {
            "page_id": Path(page_path).stem,
            "title": title,
            "content": content,
            "category": category,
            "path": page_path,
        }

    @staticmethod
    async def find_page_by_title(
        wiki_root: str,
        title: str,
        category: str,
    ) -> dict[str, Any] | None:
        """Find an existing page by normalized title within a category.

        Returns the page dict (same shape as read_page) or None.
        """
        cat_dir = Path(wiki_root) / category
        if not cat_dir.is_dir():
            return None

        title_key = normalize_wiki_ref_key(title)
        for md_file in cat_dir.glob("*.md"):
            try:
                with md_file.open("r", encoding="utf-8", errors="replace") as f:
                    head = f.read(1024)
            except OSError:
                continue
            file_title = extract_frontmatter_title(head)
            if file_title and normalize_wiki_ref_key(file_title) == title_key:
                content = md_file.read_text(encoding="utf-8")
                return {
                    "page_id": md_file.stem,
                    "title": file_title,
                    "content": content,
                    "category": category,
                    "path": str(md_file),
                }
        return None

    @staticmethod
    async def write_page(
        wiki_root: str,
        title: str,
        content: str,
        category: str = "entities",
        *,
        force: bool = False,
        _log_action: str | None = None,
    ) -> dict[str, Any]:
        """Write a wiki page.  Auto-generates filename and updates index.

        If a page with the same normalized title already exists in the same
        category and ``force`` is False, returns a dict with ``exists=True``
        and a preview of the existing content so the caller can decide
        whether to merge or replace.  Set ``force=True`` to overwrite
        unconditionally (used when the caller has already seen the existing
        content and has prepared a merged version).

        When no match is found, a new file is always created.

        ``_log_action`` overrides the action string written to ``log.md``
        (default is ``"create"`` for new pages, ``"update"`` for updates).
        Internal callers like :meth:`ingest_source` use this to record a
        more specific action (e.g. ``"ingest"``).
        """
        root = Path(wiki_root)

        # Ensure directory exists
        cat_dir = root / category
        if not cat_dir.exists():
            cat_dir.mkdir(parents=True, exist_ok=True)

        # ── Check for an existing page with the same title ──────────
        existing_path: Path | None = None
        existing_created: str | None = None
        existing_content: str | None = None
        title_key = normalize_wiki_ref_key(title)

        if cat_dir.is_dir():
            for md_file in cat_dir.glob("*.md"):
                try:
                    with md_file.open("r", encoding="utf-8", errors="replace") as f:
                        head = f.read(1024)
                except OSError:
                    continue
                file_title = extract_frontmatter_title(head)
                if file_title and normalize_wiki_ref_key(file_title) == title_key:
                    existing_path = md_file
                    existing_created = _extract_frontmatter_field(head, "created")
                    try:
                        existing_content = md_file.read_text(encoding="utf-8")
                    except OSError:
                        pass
                    break

        now = datetime.now(timezone.utc)
        iso_now = now.isoformat()

        if existing_path is not None and not force:
            # ── Return existing page info for LLM to merge ───────
            # The LLM should read this, decide how to merge, and
            # call write_page again with force=True and the full
            # merged content — or call merge_page for section-level
            # merging.
            body = existing_content or ""
            # Strip frontmatter from body preview
            body_preview = re.sub(r"^---\n[\s\S]*?---\n", "", body)
            return {
                "exists": True,
                "page_id": existing_path.stem,
                "title": title,
                "category": category,
                "filename": existing_path.name,
                "existing_content_preview": body_preview[:2000],
                "message": (
                    f"Page '{title}' already exists in {category}. "
                    "Call write again with force=true to overwrite, "
                    "or use merge action to merge sections."
                ),
            }

        if existing_path is not None and force:
            # ── Update existing page in-place ──────────────────────
            # Preserve existing frontmatter fields that the caller
            # doesn't supply (related, sources) to avoid data loss.
            existing_related = _extract_frontmatter_field(existing_content or "", "related") or "[]"
            existing_sources = _extract_frontmatter_field(existing_content or "", "sources") or "[]"
            created_line = (
                f"created: {existing_created}\n" if existing_created
                else f"created: {iso_now}\n"
            )
            frontmatter = (
                "---\n"
                f"title: {title}\n"
                f"category: {category}\n"
                + created_line
                + f"updated: {iso_now}\n"
                f"related: {existing_related}\n"
                f"sources: {existing_sources}\n"
                "---\n\n"
            )
            full_content = frontmatter + content
            existing_path.write_text(full_content, encoding="utf-8")

            slug = existing_path.stem
            await WikiService._update_index(wiki_root, title, slug, category)
            await WikiService.append_log(wiki_root, _log_action or "update", title, category)

            return {
                "page_id": slug,
                "title": title,
                "filename": existing_path.name,
                "category": category,
                "path": str(existing_path),
                "updated": True,
            }

        # ── Create a new page ──────────────────────────────────────
        fn_info = make_query_filename(title, now=now)

        frontmatter = (
            "---\n"
            f"title: {title}\n"
            f"category: {category}\n"
            f"created: {iso_now}\n"
            f"updated: {iso_now}\n"
            "related: []\n"
            "sources: []\n"
            "---\n\n"
        )

        full_content = frontmatter + content

        # Write the file
        file_path = cat_dir / fn_info.filename
        file_path.write_text(full_content, encoding="utf-8")

        # Update index.md
        await WikiService._update_index(wiki_root, title, fn_info.slug, category)
        await WikiService.append_log(wiki_root, _log_action or "create", title, category)

        return {
            "page_id": fn_info.slug,
            "title": title,
            "filename": fn_info.filename,
            "category": category,
            "path": str(file_path),
            "date": fn_info.date,
            "time": fn_info.time,
        }

    @staticmethod
    async def merge_page(
        wiki_root: str,
        title: str,
        new_sections: str,
        category: str = "entities",
    ) -> dict[str, Any]:
        """Merge new sections into an existing wiki page by heading.

        Sections with matching headings replace the old version; sections
        without a match are appended.  The preamble (content before the
        first ``##``) is always preserved from the existing page.

        If no existing page is found, falls back to ``write_page`` (create).
        """
        existing = await WikiService.find_page_by_title(wiki_root, title, category)
        if existing is None:
            # No existing page — create a new one
            return await WikiService.write_page(
                wiki_root, title, new_sections, category, force=True
            )

        # Extract body (strip frontmatter)
        existing_body = re.sub(r"^---\n[\s\S]*?---\n", "", existing["content"])

        # Merge sections
        merged_body = merge_sections(existing_body, new_sections)

        # Rebuild the full page with preserved frontmatter
        existing_path = Path(existing["path"])
        existing_created = _extract_frontmatter_field(existing["content"], "created")
        existing_related = _extract_frontmatter_field(existing["content"], "related") or "[]"
        existing_sources = _extract_frontmatter_field(existing["content"], "sources") or "[]"
        now = datetime.now(timezone.utc)
        iso_now = now.isoformat()

        created_line = (
            f"created: {existing_created}\n" if existing_created
            else f"created: {iso_now}\n"
        )
        frontmatter = (
            "---\n"
            f"title: {title}\n"
            f"category: {category}\n"
            + created_line
            + f"updated: {iso_now}\n"
            f"related: {existing_related}\n"
            f"sources: {existing_sources}\n"
            "---\n\n"
        )

        full_content = frontmatter + merged_body
        existing_path.write_text(full_content, encoding="utf-8")

        slug = existing_path.stem
        await WikiService._update_index(wiki_root, title, slug, category)
        await WikiService.append_log(wiki_root, "merge", title, category)

        return {
            "page_id": slug,
            "title": title,
            "filename": existing_path.name,
            "category": category,
            "path": str(existing_path),
            "merged": True,
        }

    @staticmethod
    async def append_log(
        wiki_root: str,
        action: str,
        title: str,
        category: str,
    ) -> None:
        """Append an entry to the wiki's ``log.md``.

        The log is a chronological record of all wiki mutations.
        If the file does not exist, it is created with a header.
        """
        log_path = Path(wiki_root) / "log.md"
        now = datetime.now(timezone.utc)
        date_str = now.strftime("%Y-%m-%d")

        entry = f"## [{date_str}] {action} | {title}\n- Category: {category}\n\n"

        if log_path.exists():
            try:
                content = log_path.read_text(encoding="utf-8")
                content = content.rstrip("\n") + "\n" + entry
                log_path.write_text(content, encoding="utf-8")
            except OSError:
                logger.warning("Failed to append to log.md")
        else:
            header = "# Wiki Log\n\nA chronological record of wiki mutations.\n\n"
            log_path.write_text(header + entry, encoding="utf-8")

    @staticmethod
    async def delete_page(wiki_root: str, page_id: str) -> bool:
        """Delete a wiki page and clean up references.

        Removes the file and cleans up index.md entries and wikilinks
        in other pages that reference the deleted page.
        """
        page_path = resolve_wiki_page(wiki_root, page_id)
        if page_path is None:
            return False

        # Extract info before deleting
        try:
            content = Path(page_path).read_text(encoding="utf-8")
        except OSError:
            return False

        title = extract_frontmatter_title(content)
        slug = Path(page_path).stem

        # Delete the file
        try:
            Path(page_path).unlink()
        except OSError:
            return False

        # Clean up references
        deleted_info = [DeletedPageInfo(slug=slug, title=title)]
        deleted_keys = build_deleted_keys(deleted_info)

        # Clean index.md
        index_path = Path(wiki_root) / "index.md"
        if index_path.exists():
            try:
                index_content = index_path.read_text(encoding="utf-8")
                cleaned = clean_index_listing(index_content, deleted_keys)
                cleaned = strip_deleted_wikilinks(cleaned, deleted_keys)
                if cleaned != index_content:
                    index_path.write_text(cleaned, encoding="utf-8")
            except OSError:
                logger.warning("Failed to clean index.md after page deletion")

        # Clean other wiki pages that reference the deleted page
        root = Path(wiki_root)
        for category_dir in root.iterdir():
            if not category_dir.is_dir():
                continue
            for md_file in category_dir.glob("*.md"):
                try:
                    page_content = md_file.read_text(encoding="utf-8")
                    cleaned = strip_deleted_wikilinks(page_content, deleted_keys)
                    if cleaned != page_content:
                        md_file.write_text(cleaned, encoding="utf-8")
                except OSError:
                    continue

        return True

    @staticmethod
    async def list_pages(
        wiki_root: str,
        category: str | None = None,
    ) -> list[dict[str, Any]]:
        """List wiki pages, optionally filtered by category."""
        root = Path(wiki_root)
        if not root.is_dir():
            return []

        pages: list[dict[str, Any]] = []
        dirs_to_scan = [root / category] if category else [
            root / c for c in DEFAULT_CATEGORIES if (root / c).is_dir()
        ]

        for cat_dir in dirs_to_scan:
            if not cat_dir.is_dir():
                continue
            cat_name = cat_dir.name
            for md_file in sorted(cat_dir.glob("*.md")):
                try:
                    # Only read the first 1 KB to extract the frontmatter title —
                    # avoids reading potentially large page bodies just for listing.
                    with md_file.open("r", encoding="utf-8", errors="replace") as f:
                        head = f.read(1024)
                except OSError:
                    continue
                title = extract_frontmatter_title(head)
                if not title:
                    title = md_file.stem.replace("-", " ")

                pages.append({
                    "page_id": md_file.stem,
                    "title": title,
                    "category": cat_name,
                    "path": str(md_file),
                })

        return pages

    @staticmethod
    async def search(
        wiki_root: str,
        query: str,
        max_results: int = 20,
    ) -> list[SearchResult]:
        """Search wiki pages for the given query."""
        return search_wiki(wiki_root, query, max_results=max_results)

    @staticmethod
    async def get_status(wiki_root: str) -> dict[str, Any]:
        """Get wiki status: page counts, categories, etc."""
        root = Path(wiki_root)
        if not root.is_dir():
            return {
                "initialized": False,
                "wiki_root": wiki_root,
                "total_pages": 0,
                "categories": {},
            }

        categories: dict[str, int] = {}
        total = 0
        for cat in DEFAULT_CATEGORIES:
            cat_dir = root / cat
            if cat_dir.is_dir():
                count = len(list(cat_dir.glob("*.md")))
                categories[cat] = count
                total += count
            else:
                categories[cat] = 0

        return {
            "initialized": True,
            "wiki_root": wiki_root,
            "total_pages": total,
            "categories": categories,
            "has_index": (root / "index.md").exists(),
        }

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _find_duplicate_pages(wiki_root: str) -> list[dict[str, Any]]:
        """Find pages with duplicate normalized titles within the same category.

        Returns a list of dicts with keys: title, category, files (list of paths).
        """
        root = Path(wiki_root)
        if not root.is_dir():
            return []

        # Group files by (category, normalized_title)
        groups: dict[tuple[str, str], list[str]] = {}
        for cat in DEFAULT_CATEGORIES:
            cat_dir = root / cat
            if not cat_dir.is_dir():
                continue
            for md_file in cat_dir.glob("*.md"):
                try:
                    with md_file.open("r", encoding="utf-8", errors="replace") as f:
                        head = f.read(1024)
                except OSError:
                    continue
                file_title = extract_frontmatter_title(head)
                if not file_title:
                    file_title = md_file.stem.replace("-", " ")
                key = (cat, normalize_wiki_ref_key(file_title))
                groups.setdefault(key, []).append(str(md_file))

        return [
            {"title": key[1], "category": key[0], "files": paths}
            for key, paths in groups.items()
            if len(paths) > 1
        ]

    @staticmethod
    async def _update_index(
        wiki_root: str,
        title: str,
        slug: str,
        category: str,
    ) -> None:
        """Append a new page entry to ``index.md``."""
        index_path = Path(wiki_root) / "index.md"
        if not index_path.exists():
            return

        try:
            content = index_path.read_text(encoding="utf-8")
        except OSError:
            return

        # Check if already indexed (by slug or title)
        slug_key = normalize_wiki_ref_key(slug)
        title_key = normalize_wiki_ref_key(title)
        search_keys = {slug_key, title_key}

        for line in content.split("\n"):
            stripped = line.strip()
            if not (stripped.startswith("- [[") or stripped.startswith("* [[")):
                continue
            # Extract the wikilink target(s) from this index entry
            wikilink_section = stripped.split("]]")[0]
            inner = wikilink_section.split("[[")[-1]
            # inner may be "Target" or "Target|Alias"
            parts = inner.split("|")
            # Normalize all parts and check for match
            for part in parts:
                if normalize_wiki_ref_key(part.strip()) in search_keys:
                    return  # Already indexed

        # Append entry
        entry = f"- [[{title}]] ({category})\n"
        content = content.rstrip("\n") + "\n" + entry
        index_path.write_text(content, encoding="utf-8")

    # ------------------------------------------------------------------
    # Phase 2: Ingest
    # ------------------------------------------------------------------

    @staticmethod
    async def ingest_source(
        wiki_root: str,
        source_name: str,
        source_content: str,
        *,
        purpose: str = "general",
    ) -> dict[str, Any]:
        """Ingest a source document into the wiki.

        Creates a source summary page and returns metadata about what
        was ingested.  The actual extraction of entities/concepts and
        cross-linking is done by the LLM (not here) — this method
        just stores the raw source page and provides the LLM with
        structured context for further processing.

        Returns a dict with the created page info and the source text
        (truncated) so the LLM can decide what to extract.
        """
        # Auto-initialize if needed
        root = Path(wiki_root)
        if not root.is_dir():
            await WikiService.initialize(wiki_root)

        # Create the source summary page
        now = datetime.now(timezone.utc)
        iso_now = now.isoformat()

        # Build the source page content with structured sections
        page_content = (
            f"## Source\n\n"
            f"**Name:** {source_name}\n"
            f"**Purpose:** {purpose}\n"
            f"**Ingested:** {iso_now}\n\n"
            f"## Content\n\n{source_content}\n\n"
            f"## Key Entities\n\n"
            f"*(To be extracted)*\n\n"
            f"## Key Concepts\n\n"
            f"*(To be extracted)*\n\n"
            f"## Related Pages\n\n"
            f"*(Cross-references to be added)*\n"
        )

        result = await WikiService.write_page(
            wiki_root, source_name, page_content, "sources", force=True,
            _log_action="ingest",
        )

        # Note: write_page already appended a log entry (action="ingest"
        # via _log_action).  We do NOT call append_log again here — that
        # would create a duplicate.

        return {
            **result,
            "source_name": source_name,
            "purpose": purpose,
            "content_length": len(source_content),
            "message": (
                f"Source '{source_name}' ingested into wiki. "
                f"Use the wiki tool to create/update entity and concept pages "
                f"based on the content, and add [[wikilinks]] between pages."
            ),
        }

    # ------------------------------------------------------------------
    # Phase 3: Lint
    # ------------------------------------------------------------------

    @staticmethod
    async def lint_wiki(
        wiki_root: str,
        scope: str = "full",
    ) -> dict[str, Any]:
        """Check the wiki for health issues.

        Scans for: orphans (no incoming links), broken wikilinks
        (referenced but no page exists), stale pages (not updated
        in N days), and empty categories.

        Returns a dict with issues found, grouped by severity.
        """
        root = Path(wiki_root)
        if not root.is_dir():
            return {"issues": [], "total_issues": 0, "healthy": True}

        issues: list[dict[str, Any]] = []
        broken_links: list[dict[str, str]] = []

        _WIKILINK_RE = re.compile(r"\[\[([^\]|]+?)(?:\|[^\]]+)?\]\]")
        stale_threshold_days = 30
        now = datetime.now(timezone.utc)

        # ── Phase 1: collect all pages + their content in one pass ────
        # We store the content so Phase 2 can scan wikilinks without
        # re-reading files.
        all_pages: dict[str, dict[str, str]] = {}  # normalized_key -> info
        page_contents: list[tuple[dict[str, str], str]] = []  # [(info, content)]

        for cat in DEFAULT_CATEGORIES:
            cat_dir = root / cat
            if not cat_dir.is_dir():
                continue

            cat_files = list(cat_dir.glob("*.md"))
            if not cat_files:
                issues.append({
                    "type": "empty_category",
                    "severity": "info",
                    "category": cat,
                    "message": f"Category '{cat}' is empty",
                })
                continue

            for md_file in cat_files:
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
                page_contents.append((info, content))

        # ── Phase 2: scan wikilinks + staleness in one pass over cache ──
        incoming: dict[str, int] = {}

        for info, content in page_contents:
            # Scan wikilinks
            for m in _WIKILINK_RE.finditer(content):
                target = m.group(1).strip()
                target_key = normalize_wiki_ref_key(target)
                incoming[target_key] = incoming.get(target_key, 0) + 1
                if target_key not in all_pages:
                    broken_links.append({
                        "source": info["title"],
                        "target": target,
                        "type": "broken_wikilink",
                        "severity": "warning",
                        "message": f"Page '{info['title']}' links to '{target}' which does not exist",
                    })

            # Check staleness
            updated_str = _extract_frontmatter_field(content, "updated")
            if updated_str:
                try:
                    updated_dt = datetime.fromisoformat(updated_str.replace("Z", "+00:00"))
                    days_old = (now - updated_dt).days
                    if days_old > stale_threshold_days:
                        issues.append({
                            "type": "stale",
                            "severity": "info",
                            "page_id": info["page_id"],
                            "title": info["title"],
                            "category": info["category"],
                            "days_old": days_old,
                            "message": f"Page '{info['title']}' not updated in {days_old} days",
                        })
                except (ValueError, TypeError):
                    pass

        # Find orphans (pages with no incoming links)
        for key, info in all_pages.items():
            link_count = incoming.get(key, 0)
            if link_count == 0:
                issues.append({
                    "type": "orphan",
                    "severity": "info",
                    "page_id": info["page_id"],
                    "title": info["title"],
                    "category": info["category"],
                    "message": f"Page '{info['title']}' has no incoming links",
                })

        # Combine all issues
        all_issues = issues + broken_links
        total = len(all_issues)
        warnings = sum(1 for i in all_issues if i.get("severity") == "warning")

        return {
            "issues": all_issues,
            "total_issues": total,
            "warnings": warnings,
            "healthy": total == 0,
            "pages_checked": len(all_pages),
            "summary": {
                "orphans": sum(1 for i in issues if i.get("type") == "orphan"),
                "broken_links": len(broken_links),
                "stale": sum(1 for i in issues if i.get("type") == "stale"),
                "empty_categories": sum(1 for i in issues if i.get("type") == "empty_category"),
            },
        }
