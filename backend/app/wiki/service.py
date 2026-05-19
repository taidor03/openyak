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
    merge_frontmatter,
    merge_sections,
    normalize_wiki_ref_key,
    parse_sections,
    strip_deleted_wikilinks,
)
from app.wiki.filename import make_query_filename
from app.wiki.resolver import resolve_wiki_page, unwrap_wikilink
from app.wiki.graph import WikiGraph, build_wiki_graph
from app.wiki.lint import lint_wiki as _lint_wiki
from app.wiki.review import ReviewItem, ReviewStore, generate_review_items_from_lint
from app.wiki.ingest_queue import IngestQueue
from app.wiki.cascade import cascade_delete, find_cascade_targets
from app.wiki.review_sweep import sweep_rules, sweep_semantic
from app.wiki.vector_store import VectorStore, search_with_rrf
from app.wiki.contradiction import find_contradiction_candidates, generate_contradiction_prompt
from app.wiki.dedup import find_duplicates
from app.wiki.watcher import start_watcher, stop_watcher, get_watcher_status, get_all_watcher_statuses
from app.wiki.sanitize import sanitize_wiki_content
from app.wiki.search import SearchResult, invalidate_search_cache, search_wiki

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


from app.wiki.constants import DEFAULT_CATEGORIES

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
            # Sanitize LLM output before writing
            cleaned_content = sanitize_wiki_content(content)
            full_content = frontmatter + cleaned_content
            existing_path.write_text(full_content, encoding="utf-8")

            slug = existing_path.stem
            await WikiService._update_index(wiki_root, title, slug, category)
            await WikiService.append_log(wiki_root, _log_action or "update", title, category)

            invalidate_search_cache(wiki_root)

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

        # Sanitize LLM output before writing
        cleaned_content = sanitize_wiki_content(content)
        full_content = frontmatter + cleaned_content

        # Write the file
        file_path = cat_dir / fn_info.filename
        file_path.write_text(full_content, encoding="utf-8")

        # Update index.md
        await WikiService._update_index(wiki_root, title, fn_info.slug, category)
        await WikiService.append_log(wiki_root, _log_action or "create", title, category)
        invalidate_search_cache(wiki_root)

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
    def _backup_page(wiki_root: str, page_path: Path, page_id: str) -> Path | None:
        """Create a backup of a wiki page before merge.

        Backups are stored in ``<wiki_root>/.history/<page_id>/`` with
        ISO-timestamp filenames.  At most 10 backups are kept per page;
        oldest are pruned automatically.
        """
        history_dir = Path(wiki_root) / ".history" / page_id
        history_dir.mkdir(parents=True, exist_ok=True)

        now = datetime.now(timezone.utc)
        backup_name = f"{now.strftime('%Y%m%dT%H%M%SZ')}.md"
        backup_path = history_dir / backup_name

        try:
            import shutil
            shutil.copy2(page_path, backup_path)
        except OSError as exc:
            logger.warning("Failed to create backup for page %s: %s", page_id, exc)
            return None

        # Prune old backups — keep at most 10
        try:
            backups = sorted(history_dir.glob("*.md"), reverse=True)
            for old_backup in backups[10:]:
                old_backup.unlink(missing_ok=True)
        except OSError:
            pass

        return backup_path

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

        Safety features:
        - Backup: the existing page is backed up to ``.history/<page_id>/``
          before any changes are written.
        - Locked fields: ``title``, ``category``, and ``type`` in frontmatter
          are never overwritten by the incoming data (Layer 3 lock).
        - Body length guard: if the merged body is significantly shorter
          than the original (>= 50% reduction), the merge is aborted to
          prevent accidental content loss.

        If no existing page is found, falls back to ``write_page`` (create).
        """
        existing = await WikiService.find_page_by_title(wiki_root, title, category)
        if existing is None:
            # No existing page — create a new one
            return await WikiService.write_page(
                wiki_root, title, new_sections, category, force=True
            )

        existing_path = Path(existing["path"])

        # Extract body (strip frontmatter)
        existing_body = re.sub(r"^---\n[\s\S]*?---\n", "", existing["content"])

        # Extract existing frontmatter body (between --- markers)
        fm_match = re.match(r"^---\n([\s\S]*?)---\n", existing["content"])
        existing_fm_body = fm_match.group(1) if fm_match else ""

        # Merge sections
        merged_body = merge_sections(existing_body, new_sections)

        # Body length guard — prevent accidental content truncation
        orig_len = len(existing_body.strip())
        merged_len = len(merged_body.strip())
        if orig_len > 100 and merged_len < orig_len * 0.5:
            logger.warning(
                "Merge aborted for '%s': merged body is %.0f%% of original "
                "(%d → %d chars). This may indicate a truncation issue.",
                title, (merged_len / orig_len * 100) if orig_len else 0,
                orig_len, merged_len,
            )
            return {
                "page_id": existing_path.stem,
                "title": title,
                "merged": False,
                "error": (
                    f"Merge aborted: merged body is too short "
                    f"({merged_len} vs {orig_len} chars). "
                    f"Possible content truncation detected."
                ),
            }

        # Merge frontmatter using three-layer strategy
        now = datetime.now(timezone.utc)
        iso_now = now.isoformat()
        new_fm_body = (
            f"title: {title}\n"
            f"category: {category}\n"
            f"updated: {iso_now}\n"
        )
        merged_fm = merge_frontmatter(existing_fm_body, new_fm_body)

        frontmatter = f"---\n{merged_fm}\n---\n\n"
        full_content = frontmatter + merged_body

        # Backup existing page before writing
        backup_path = WikiService._backup_page(wiki_root, existing_path, existing_path.stem)

        # Write merged content
        existing_path.write_text(full_content, encoding="utf-8")

        slug = existing_path.stem
        await WikiService._update_index(wiki_root, title, slug, category)
        await WikiService.append_log(wiki_root, "merge", title, category)
        invalidate_search_cache(wiki_root)

        return {
            "page_id": slug,
            "title": title,
            "filename": existing_path.name,
            "category": category,
            "path": str(existing_path),
            "merged": True,
            "backup": str(backup_path) if backup_path else None,
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

        invalidate_search_cache(wiki_root)
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
        scope: str = "structural",
    ) -> dict[str, Any]:
        """Check the wiki for health issues.

        Supports two scopes:
        - "structural": Pure code checks (orphans, broken links, no-outlinks).
          This is the default and requires no LLM.
        - "full": Structural + semantic checks. Semantic lint requires LLM
          access and is only available when called from the tool layer.
        - "semantic": LLM-driven checks only (contradictions, stale, etc.)

        Returns a dict with issues found, grouped by severity.
        """
        # Delegate to the lint module (no LLM callable by default)
        return await _lint_wiki(wiki_root, scope=scope)

    # ------------------------------------------------------------------
    # Phase 4: Knowledge Graph
    # ------------------------------------------------------------------

    @staticmethod
    async def get_graph(wiki_root: str) -> dict[str, Any]:
        """Build and return the knowledge graph.

        Returns nodes, edges, communities, and insights.
        """
        graph = build_wiki_graph(wiki_root)
        return {
            "nodes": graph.nodes,
            "edges": graph.edges,
            "communities": graph.communities,
            "insights": graph.insights,
            "stats": graph.stats,
        }

    # ------------------------------------------------------------------
    # Phase 5: Review Items
    # ------------------------------------------------------------------

    @staticmethod
    async def get_review_items(wiki_root: str) -> dict[str, Any]:
        """Get review items generated from the latest lint scan.

        Runs a structural lint scan first, then converts the issues into
        actionable Review Items.  Merges with any previously stored items
        (preserving resolved/skipped status).
        """
        store = ReviewStore(wiki_root)

        # Run structural lint to get fresh issues
        lint_result = await _lint_wiki(wiki_root, scope="structural")
        new_items = generate_review_items_from_lint(wiki_root, lint_result)

        # Build a lookup of existing items by (type, title) to avoid duplicates
        existing_lookup: dict[str, ReviewItem] = {}
        for item in store.list_items():
            key = f"{item.type}:{item.title}"
            existing_lookup[key] = item

        # Add new items that don't already exist
        added = 0
        for item in new_items:
            key = f"{item.type}:{item.title}"
            if key not in existing_lookup:
                store.add_item(item)
                added += 1

        # Clean up resolved items older than 7 days
        store.clear_resolved()

        all_items = store.list_items()
        open_items = [i for i in all_items if i.status == "open"]
        resolved_items = [i for i in all_items if i.status in ("resolved", "skipped")]

        return {
            "items": [i.to_dict() for i in all_items],
            "total": len(all_items),
            "open": len(open_items),
            "resolved": len(resolved_items),
            "newly_added": added,
            "warnings": sum(1 for i in open_items if i.severity == "warning"),
        }

    @staticmethod
    async def resolve_review_item(wiki_root: str, item_id: str) -> bool:
        """Mark a review item as resolved."""
        store = ReviewStore(wiki_root)
        return store.resolve_item(item_id)

    # ------------------------------------------------------------------
    # Phase 6: Ingest Queue
    # ------------------------------------------------------------------

    @staticmethod
    async def enqueue_ingest(
        wiki_root: str,
        source_name: str,
        content: str,
        purpose: str = "general",
    ) -> dict[str, Any]:
        """Enqueue an ingest job for asynchronous processing."""
        queue = IngestQueue(wiki_root)
        job = queue.enqueue(source_name, content, purpose=purpose)
        return {"job_id": job.id, "status": job.status, **job.to_dict()}

    @staticmethod
    async def get_ingest_queue(wiki_root: str) -> dict[str, Any]:
        """Get the current ingest queue status."""
        queue = IngestQueue(wiki_root)
        jobs = queue.list_jobs()
        stats = queue.stats
        # Don't include full content in listing (too large)
        job_summaries = []
        for j in jobs:
            d = j.to_dict()
            d.pop("content", None)
            job_summaries.append(d)
        return {
            "jobs": job_summaries,
            "stats": stats,
            "total": len(jobs),
        }

    @staticmethod
    async def process_ingest_queue(wiki_root: str) -> dict[str, Any]:
        """Process all pending jobs in the ingest queue.

        Returns a summary of processed jobs. When the queue is fully drained
        (no pending or processing jobs remain), a "queue_drained" log entry
        is appended and the search cache is invalidated — matching the
        llm_wiki queue-drain callback pattern.
        """
        queue = IngestQueue(wiki_root)
        processed = 0
        failed = 0

        while True:
            job = queue.dequeue()
            if job is None:
                break

            try:
                result = await WikiService.ingest_source(
                    wiki_root, job.source_name, job.content, purpose=job.purpose,
                )
                queue.mark_done(job.id, result=result)
                processed += 1
            except Exception as exc:
                queue.mark_failed(job.id, str(exc))
                failed += 1

        # Queue-drain callback: log + cache invalidation
        if processed > 0 or failed > 0:
            invalidate_search_cache(wiki_root)
            if queue.is_drained():
                await WikiService.append_log(wiki_root, "queue_drained", f"{processed} processed, {failed} failed", "system")
                logger.info("Ingest queue drained: %d processed, %d failed", processed, failed)

        return {"processed": processed, "failed": failed, "drained": queue.is_drained()}

    @staticmethod
    async def retry_ingest_job(wiki_root: str, job_id: str) -> bool:
        """Retry a failed ingest job."""
        queue = IngestQueue(wiki_root)
        return queue.retry_failed(job_id)

    # ------------------------------------------------------------------
    # Phase 7: Cascade Delete + Review Sweep
    # ------------------------------------------------------------------

    @staticmethod
    async def delete_page_cascade(wiki_root: str, page_id: str) -> dict[str, Any]:
        """Delete a page with cascade cleanup of references.

        Returns a detailed report of what was cleaned up.
        """
        result = cascade_delete(wiki_root, page_id)
        invalidate_search_cache(wiki_root)
        return result

    @staticmethod
    async def get_cascade_targets(wiki_root: str, page_id: str) -> dict[str, Any]:
        """Preview what would be affected by cascade deletion (no changes made)."""
        return find_cascade_targets(wiki_root, page_id)

    @staticmethod
    async def run_review_sweep(
        wiki_root: str,
        phase: str = "rules",
        llm_call_fn: Any = None,
    ) -> dict[str, Any]:
        """Run review sweep cleanup.

        phase: "rules" for rule-based only, "semantic" for LLM-driven, "full" for both.
        llm_call_fn: Async callable for LLM inference (required for semantic phase).
        """
        results: dict[str, Any] = {}

        if phase in ("rules", "full"):
            results["rules"] = sweep_rules(wiki_root)

        if phase in ("semantic", "full"):
            results["semantic"] = await sweep_semantic(wiki_root, llm_call_fn=llm_call_fn)

        invalidate_search_cache(wiki_root)
        return results

    # ------------------------------------------------------------------
    # Phase 8: Vector Search + Contradiction Detection + Dedup
    # ------------------------------------------------------------------

    @staticmethod
    async def rebuild_vector_index(
        wiki_root: str,
        *,
        ollama_base_url: str | None = None,
        openai_api_key: str | None = None,
    ) -> dict[str, Any]:
        """Rebuild the vector index for all wiki pages."""
        store = VectorStore(wiki_root)
        root = Path(wiki_root)
        indexed = 0
        failed = 0

        for cat_dir in root.iterdir():
            if not cat_dir.is_dir():
                continue
            for md_file in cat_dir.glob("*.md"):
                try:
                    content = md_file.read_text(encoding="utf-8")
                    success = await store.index_page(
                        md_file.stem, content, cat_dir.name,
                        ollama_base_url=ollama_base_url,
                        openai_api_key=openai_api_key,
                    )
                    if success:
                        indexed += 1
                    else:
                        failed += 1
                except OSError:
                    failed += 1

        return {"indexed": indexed, "failed": failed, "total": store.indexed_count}

    @staticmethod
    async def semantic_search(
        wiki_root: str,
        query: str,
        max_results: int = 20,
        *,
        ollama_base_url: str | None = None,
        openai_api_key: str | None = None,
    ) -> dict[str, Any]:
        """Semantic search using vector similarity."""
        from app.wiki.embedding import get_embedding

        query_embedding = await get_embedding(
            query,
            ollama_base_url=ollama_base_url,
            openai_api_key=openai_api_key,
        )
        if query_embedding is None:
            return {"results": [], "mode": "semantic", "error": "No embedding backend available"}

        store = VectorStore(wiki_root)
        results = store.search_similar(query_embedding, top_k=max_results)
        return {"results": results, "mode": "semantic", "count": len(results)}

    @staticmethod
    async def hybrid_search(
        wiki_root: str,
        query: str,
        max_results: int = 20,
        *,
        ollama_base_url: str | None = None,
        openai_api_key: str | None = None,
    ) -> dict[str, Any]:
        """Hybrid search using RRF fusion of token + vector results."""
        from app.wiki.embedding import get_embedding

        # Token search
        token_results = search_wiki(wiki_root, query, max_results=max_results)
        token_dicts = [
            {"page_id": r.page_id, "title": r.title, "category": r.category, "score": r.score}
            for r in token_results
        ]

        # Vector search
        query_embedding = await get_embedding(
            query,
            ollama_base_url=ollama_base_url,
            openai_api_key=openai_api_key,
        )

        if query_embedding is None:
            # Fallback to token-only
            return {"results": token_dicts, "mode": "token-only", "count": len(token_dicts)}

        store = VectorStore(wiki_root)
        vector_results = store.search_similar(query_embedding, top_k=max_results)

        # RRF fusion
        merged = search_with_rrf(token_dicts, vector_results)
        return {"results": merged[:max_results], "mode": "hybrid", "count": len(merged[:max_results])}

    @staticmethod
    def get_contradiction_candidates(wiki_root: str) -> list[tuple[str, str, float]]:
        """Find page pairs that might contain contradictions."""
        return find_contradiction_candidates(wiki_root)

    @staticmethod
    def get_contradiction_prompt(page_a_id: str, page_b_id: str, wiki_root: str) -> str | None:
        """Generate an LLM prompt for contradiction detection between two pages."""
        root = Path(wiki_root)
        content_a = None
        content_b = None
        title_a = page_a_id
        title_b = page_b_id

        for cat_dir in root.iterdir():
            if not cat_dir.is_dir():
                continue
            for md_file in cat_dir.glob("*.md"):
                if md_file.stem == page_a_id:
                    try:
                        content_a = md_file.read_text(encoding="utf-8")
                        title_a = extract_frontmatter_title(content_a) or page_a_id
                    except OSError:
                        pass
                elif md_file.stem == page_b_id:
                    try:
                        content_b = md_file.read_text(encoding="utf-8")
                        title_b = extract_frontmatter_title(content_b) or page_b_id
                    except OSError:
                        pass

        if content_a is None or content_b is None:
            return None

        return generate_contradiction_prompt(title_a, content_a, title_b, content_b)

    @staticmethod
    def find_duplicate_pages(
        wiki_root: str,
        *,
        include_semantic: bool = False,
    ) -> dict[str, Any]:
        """Find duplicate wiki pages using content hashing, trigram similarity,
        and optionally vector similarity (semantic dedup).

        Args:
            wiki_root: Path to the wiki root directory.
            include_semantic: If True, also run Level 3 semantic dedup.
                Defaults to False (expensive — requires embedding service).
        """
        return find_duplicates(wiki_root, include_semantic=include_semantic)

    # ------------------------------------------------------------------
    # Phase 9: File Watcher
    # ------------------------------------------------------------------

    @staticmethod
    async def start_file_watcher(workspace_dir: str, wiki_root: str | None = None) -> dict[str, Any]:
        """Start a file watcher for automatic wiki ingestion."""
        return await start_watcher(workspace_dir, wiki_root=wiki_root)

    @staticmethod
    async def stop_file_watcher(workspace_dir: str) -> dict[str, Any]:
        """Stop the file watcher for the given workspace."""
        return await stop_watcher(workspace_dir)

    @staticmethod
    def get_file_watcher_status(workspace_dir: str) -> dict[str, Any]:
        """Get the status of the file watcher for the given workspace."""
        return get_watcher_status(workspace_dir)
