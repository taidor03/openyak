"""Cascade deletion — find and clean up dependent resources when a page is deleted.

Ported from nashsu/llm_wiki ``src/lib/wiki-page-delete.ts``, adapted for
Python backend.

Handles:
  - Wiki page file deletion
  - Index.md reference cleanup
  - Wikilink cleanup in other pages
  - Vector embedding removal from vector store
  - Media directory cleanup (orphaned assets)
"""

from __future__ import annotations

import logging
import re
import shutil
from pathlib import Path
from typing import Any

from app.wiki.cleanup import (
    DeletedPageInfo,
    build_deleted_keys,
    clean_index_listing,
    extract_frontmatter_title,
    normalize_wiki_ref_key,
    strip_deleted_wikilinks,
)

logger = logging.getLogger(__name__)


def _remove_vector_embedding(wiki_root: str, page_id: str) -> bool:
    """Remove a page's vector embedding from the vector store.

    Returns True if the embedding was found and removed.
    """
    try:
        from app.wiki.vector_store import VectorStore
        store = VectorStore(wiki_root)
        return store.remove_page(page_id)
    except Exception as exc:
        logger.warning("Failed to remove vector embedding for %s: %s", page_id, exc)
        return False


def _find_media_references(content: str) -> list[str]:
    """Extract media file references (images, etc.) from wiki content."""
    refs: list[str] = []
    # Standard markdown images: ![alt](path)
    for m in re.finditer(r"!\[([^\]]*)\]\(([^)]+)\)", content):
        refs.append(m.group(2))
    # Wikilink-style images: ![[image.png]]
    for m in re.finditer(r"!\[\[([^\]]+)\]\]", content):
        refs.append(m.group(1))
    return refs


def _clean_media_directory(
    wiki_root: str,
    page_id: str,
    page_content: str,
) -> dict[str, Any]:
    """Clean up media assets that were only referenced by the deleted page.

    Scans the wiki's media directory for files referenced only by the
    deleted page and removes them. A media file is only removed if no
    other page references it.
    """
    root = Path(wiki_root)
    media_dir = root / "media"
    if not media_dir.is_dir():
        return {"removed_files": [], "kept_files": []}

    # Extract media references from the deleted page
    deleted_refs = _find_media_references(page_content)
    if not deleted_refs:
        return {"removed_files": [], "kept_files": []}

    # Normalize deleted refs to just filenames
    deleted_media_names: set[str] = set()
    for ref in deleted_refs:
        # Extract just the filename part
        name = Path(ref).name
        deleted_media_names.add(name)

    if not deleted_media_names:
        return {"removed_files": [], "kept_files": []}

    # Collect media references from ALL remaining pages
    remaining_refs: set[str] = set()
    for cat_dir in root.iterdir():
        if not cat_dir.is_dir() or cat_dir.name == "media":
            continue
        for md_file in cat_dir.glob("*.md"):
            try:
                other_content = md_file.read_text(encoding="utf-8")
                for ref in _find_media_references(other_content):
                    remaining_refs.add(Path(ref).name)
            except OSError:
                continue

    # Remove files only referenced by the deleted page
    removed: list[str] = []
    kept: list[str] = []

    for media_name in deleted_media_names:
        # Only remove if no other page references this file
        if media_name not in remaining_refs:
            media_path = media_dir / media_name
            if media_path.exists() and media_path.is_file():
                try:
                    media_path.unlink()
                    removed.append(media_name)
                    logger.debug("Removed orphaned media file: %s", media_name)
                except OSError as exc:
                    logger.warning("Failed to remove media file %s: %s", media_name, exc)
                    kept.append(media_name)
            else:
                # File doesn't exist, nothing to do
                pass
        else:
            kept.append(media_name)

    # Remove empty media subdirectories (but not the media dir itself)
    if removed and media_dir.is_dir():
        for subdir in media_dir.iterdir():
            if subdir.is_dir() and not any(subdir.iterdir()):
                try:
                    subdir.rmdir()
                except OSError:
                    pass

    return {"removed_files": removed, "kept_files": kept}


def find_cascade_targets(wiki_root: str, page_id: str) -> dict[str, Any]:
    """Find all resources that would be affected by deleting a page.

    Returns a report of:
    - pages_with_links: other pages that link to this page
    - index_entries: index.md entries referencing this page
    - dependent_pages: entity/concept pages that only have this source
    - has_embedding: whether the page has a vector embedding
    - media_files: media files referenced by this page
    """
    root = Path(wiki_root)
    if not root.is_dir():
        return {
            "pages_with_links": [],
            "index_entries": [],
            "dependent_pages": [],
            "has_embedding": False,
            "media_files": [],
        }

    # First, find the page to get its title
    page_title: str | None = None
    page_category: str | None = None
    page_path: Path | None = None
    page_content: str | None = None

    for cat_dir in root.iterdir():
        if not cat_dir.is_dir():
            continue
        for md_file in cat_dir.glob("*.md"):
            if md_file.stem == page_id:
                try:
                    page_content = md_file.read_text(encoding="utf-8")
                    page_title = extract_frontmatter_title(page_content)
                    page_category = cat_dir.name
                    page_path = md_file
                except OSError:
                    pass
                break

    if page_title is None:
        return {
            "pages_with_links": [],
            "index_entries": [],
            "dependent_pages": [],
            "has_embedding": False,
            "media_files": [],
        }

    # Build the keys to search for
    title_key = normalize_wiki_ref_key(page_title)
    search_keys = {title_key, normalize_wiki_ref_key(page_id)}

    pages_with_links: list[dict[str, str]] = []
    index_entries: list[str] = []
    dependent_pages: list[dict[str, str]] = []

    # Scan all pages for references
    for cat_dir in root.iterdir():
        if not cat_dir.is_dir():
            continue
        for md_file in cat_dir.glob("*.md"):
            if md_file == page_path:
                continue
            try:
                content = md_file.read_text(encoding="utf-8")
            except OSError:
                continue

            # Check for wikilinks to the target page
            for key in search_keys:
                if f"[[{key}" in content.lower().replace(" ", "-") or \
                   f"[[{page_title}" in content or \
                   f"[[{page_id}" in content:
                    ref_title = extract_frontmatter_title(content) or md_file.stem
                    pages_with_links.append({
                        "page_id": md_file.stem,
                        "title": ref_title,
                        "category": cat_dir.name,
                    })
                    break

            # Check if this page's sources field references the target
            if page_category == "sources":
                # Look for source references in frontmatter
                fm_match = re.match(r"^---\n([\s\S]*?)---\n", content)
                if fm_match:
                    fm = fm_match.group(1)
                    if f"[[{page_title}]]" in fm or f"[[{page_id}]]" in fm:
                        ref_title = extract_frontmatter_title(content) or md_file.stem
                        # Check if this is the only source
                        sources_match = re.search(r"sources:\s*\[(.*?)\]", fm)
                        if sources_match:
                            sources = sources_match.group(1)
                            source_count = sources.count("[[")
                            if source_count <= 1:
                                dependent_pages.append({
                                    "page_id": md_file.stem,
                                    "title": ref_title,
                                    "category": cat_dir.name,
                                    "reason": "only_source",
                                })

    # Check index.md
    index_path = root / "index.md"
    if index_path.exists():
        try:
            index_content = index_path.read_text(encoding="utf-8")
            for line in index_content.split("\n"):
                stripped = line.strip()
                if not (stripped.startswith("- [[") or stripped.startswith("* [[")):
                    continue
                for key in search_keys:
                    if key in normalize_wiki_ref_key(stripped):
                        index_entries.append(stripped)
                        break
        except OSError:
            pass

    # Check vector store for embedding
    has_embedding = False
    try:
        from app.wiki.vector_store import VectorStore
        store = VectorStore(wiki_root)
        has_embedding = page_id in store._vectors
    except Exception:
        pass

    # Check media references
    media_files: list[str] = []
    if page_content:
        for ref in _find_media_references(page_content):
            media_files.append(Path(ref).name)

    return {
        "pages_with_links": pages_with_links,
        "index_entries": index_entries,
        "dependent_pages": dependent_pages,
        "page_title": page_title,
        "page_category": page_category,
        "has_embedding": has_embedding,
        "media_files": media_files,
    }


def cascade_delete(wiki_root: str, page_id: str) -> dict[str, Any]:
    """Execute cascade deletion for a page.

    Cleans up:
    1. The page file itself
    2. References in index.md
    3. Wikilinks in other pages
    4. Vector embeddings
    5. Orphaned media files

    Returns a report of what was cleaned up.
    """
    # First, find the page details
    root = Path(wiki_root)
    page_path: Path | None = None
    page_title: str | None = None
    page_content: str | None = None

    for cat_dir in root.iterdir():
        if not cat_dir.is_dir():
            continue
        for md_file in cat_dir.glob("*.md"):
            if md_file.stem == page_id:
                page_path = md_file
                try:
                    page_content = md_file.read_text(encoding="utf-8")
                    page_title = extract_frontmatter_title(page_content)
                except OSError:
                    pass
                break

    if page_path is None or page_title is None:
        return {"deleted": False, "error": f"Page not found: {page_id}"}

    # Delete the page file
    try:
        page_path.unlink()
    except OSError as exc:
        return {"deleted": False, "error": str(exc)}

    # Clean up references in other pages
    deleted_info = [DeletedPageInfo(slug=page_id, title=page_title)]
    deleted_keys = build_deleted_keys(deleted_info)

    cleaned_links: list[str] = []
    cleaned_index = False

    # Clean index.md
    index_path = root / "index.md"
    if index_path.exists():
        try:
            index_content = index_path.read_text(encoding="utf-8")
            cleaned = clean_index_listing(index_content, deleted_keys)
            cleaned = strip_deleted_wikilinks(cleaned, deleted_keys)
            if cleaned != index_content:
                index_path.write_text(cleaned, encoding="utf-8")
                cleaned_index = True
        except OSError:
            logger.warning("Failed to clean index.md after cascade deletion")

    # Clean other wiki pages
    for cat_dir in root.iterdir():
        if not cat_dir.is_dir():
            continue
        for md_file in cat_dir.glob("*.md"):
            try:
                page_content_other = md_file.read_text(encoding="utf-8")
                cleaned = strip_deleted_wikilinks(page_content_other, deleted_keys)
                if cleaned != page_content_other:
                    md_file.write_text(cleaned, encoding="utf-8")
                    cleaned_links.append(md_file.stem)
            except OSError:
                continue

    # Remove vector embedding
    embedding_removed = _remove_vector_embedding(wiki_root, page_id)

    # Clean orphaned media files
    media_result: dict[str, Any] = {"removed_files": [], "kept_files": []}
    if page_content:
        try:
            media_result = _clean_media_directory(wiki_root, page_id, page_content)
        except Exception as exc:
            logger.warning("Media cleanup failed for page %s: %s", page_id, exc)

    return {
        "deleted": True,
        "page_id": page_id,
        "page_title": page_title,
        "cleaned_links": cleaned_links,
        "cleaned_index": cleaned_index,
        "embedding_removed": embedding_removed,
        "media_removed": media_result.get("removed_files", []),
        "media_kept": media_result.get("kept_files", []),
    }
