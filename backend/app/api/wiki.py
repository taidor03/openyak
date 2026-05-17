"""Wiki Knowledge Center REST API."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from app.wiki.service import WikiService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/wiki", tags=["wiki"])


class WikiWriteRequest(BaseModel):
    """Request body for writing a wiki page."""

    title: str
    content: str
    category: str = "entities"
    force: bool = False


class WikiMergeRequest(BaseModel):
    """Request body for merging sections into a wiki page."""

    title: str
    content: str
    category: str = "entities"


class WikiSearchRequest(BaseModel):
    """Request body for searching wiki pages."""

    query: str
    max_results: int = 20


class WikiIngestRequest(BaseModel):
    """Request body for ingesting a source document."""

    source_name: str
    source: str
    purpose: str = "general"


def _resolve_root(workspace: str | None) -> str:
    """Resolve wiki_root from workspace, with fallback to global.

    Raises HTTPException 400 if no wiki root can be determined.
    """
    root = WikiService.resolve_wiki_root(workspace)
    if root is None:
        root = WikiService.resolve_wiki_root(None)
    if root is None:
        raise HTTPException(status_code=400, detail="Cannot determine wiki root")
    return root


@router.get("/status")
async def wiki_status(
    workspace: str | None = Query(None, description="Workspace directory"),
) -> dict[str, Any]:
    """Get wiki status (page counts, categories, initialization state)."""
    wiki_root = _resolve_root(workspace)
    return await WikiService.get_status(wiki_root)


@router.post("/initialize")
async def wiki_initialize(
    workspace: str | None = Query(None, description="Workspace directory"),
) -> dict[str, Any]:
    """Initialize the wiki directory structure."""
    wiki_root = _resolve_root(workspace)
    return await WikiService.initialize(wiki_root)


@router.get("/pages")
async def wiki_list_pages(
    workspace: str | None = Query(None, description="Workspace directory"),
    category: str | None = Query(None, description="Filter by category"),
) -> dict[str, Any]:
    """List wiki pages, optionally filtered by category."""
    wiki_root = _resolve_root(workspace)
    pages = await WikiService.list_pages(wiki_root, category=category)
    return {"pages": pages, "count": len(pages)}


@router.get("/pages/{page_id:path}")
async def wiki_read_page(
    page_id: str,
    workspace: str | None = Query(None, description="Workspace directory"),
) -> dict[str, Any]:
    """Read a specific wiki page by ID."""
    wiki_root = _resolve_root(workspace)
    page = await WikiService.read_page(wiki_root, page_id)
    if page is None:
        raise HTTPException(status_code=404, detail=f"Wiki page not found: {page_id}")
    return page


@router.post("/pages")
async def wiki_write_page(
    request: WikiWriteRequest,
    workspace: str | None = Query(None, description="Workspace directory"),
) -> dict[str, Any]:
    """Create or update a wiki page."""
    wiki_root = _resolve_root(workspace)

    # Auto-initialize if needed
    status = await WikiService.get_status(wiki_root)
    if not status.get("initialized"):
        await WikiService.initialize(wiki_root)

    return await WikiService.write_page(
        wiki_root, request.title, request.content, request.category,
        force=request.force,
    )


@router.post("/merge")
async def wiki_merge_page(
    request: WikiMergeRequest,
    workspace: str | None = Query(None, description="Workspace directory"),
) -> dict[str, Any]:
    """Merge new sections into an existing wiki page by heading.

    Sections with matching headings replace the old version; new headings
    are appended. If the page doesn't exist, creates it.
    """
    wiki_root = _resolve_root(workspace)

    # Auto-initialize if needed
    status = await WikiService.get_status(wiki_root)
    if not status.get("initialized"):
        await WikiService.initialize(wiki_root)

    return await WikiService.merge_page(
        wiki_root, request.title, request.content, request.category
    )


@router.post("/ingest")
async def wiki_ingest(
    request: WikiIngestRequest,
    workspace: str | None = Query(None, description="Workspace directory"),
) -> dict[str, Any]:
    """Ingest a source document into the wiki.

    Creates a source summary page and provides guidance for further
    extraction of entities and concepts.
    """
    wiki_root = _resolve_root(workspace)

    # Auto-initialize if needed
    status = await WikiService.get_status(wiki_root)
    if not status.get("initialized"):
        await WikiService.initialize(wiki_root)

    return await WikiService.ingest_source(
        wiki_root, request.source_name, request.source, purpose=request.purpose
    )


@router.get("/lint")
async def wiki_lint(
    workspace: str | None = Query(None, description="Workspace directory"),
) -> dict[str, Any]:
    """Check the wiki for health issues.

    Scans for: orphan pages, broken wikilinks, stale pages, empty categories.
    """
    wiki_root = _resolve_root(workspace)
    return await WikiService.lint_wiki(wiki_root)


@router.delete("/pages/{page_id:path}")
async def wiki_delete_page(
    page_id: str,
    workspace: str | None = Query(None, description="Workspace directory"),
) -> dict[str, Any]:
    """Delete a wiki page."""
    wiki_root = _resolve_root(workspace)
    success = await WikiService.delete_page(wiki_root, page_id)
    if not success:
        raise HTTPException(
            status_code=404,
            detail=f"Wiki page not found or could not be deleted: {page_id}",
        )
    return {"deleted": True, "page_id": page_id}


@router.post("/search")
async def wiki_search(
    request: WikiSearchRequest,
    workspace: str | None = Query(None, description="Workspace directory"),
) -> dict[str, Any]:
    """Search wiki pages."""
    wiki_root = _resolve_root(workspace)

    # Auto-initialize if needed
    status = await WikiService.get_status(wiki_root)
    if not status.get("initialized"):
        await WikiService.initialize(wiki_root)

    results = await WikiService.search(wiki_root, request.query, max_results=request.max_results)
    return {
        "results": [
            {
                "page_id": r.page_id,
                "title": r.title,
                "category": r.category,
                "snippet": r.snippet,
                "title_match": r.title_match,
                "score": r.score,
            }
            for r in results
        ],
        "count": len(results),
        "query": request.query,
    }


@router.get("/duplicates")
async def wiki_duplicates(
    workspace: str | None = Query(None, description="Workspace directory"),
) -> dict[str, Any]:
    """Find wiki pages with duplicate titles in the same category."""
    wiki_root = _resolve_root(workspace)
    dupes = WikiService._find_duplicate_pages(wiki_root)
    return {"duplicates": dupes, "count": len(dupes)}


@router.post("/deduplicate")
async def wiki_deduplicate(
    workspace: str | None = Query(None, description="Workspace directory"),
) -> dict[str, Any]:
    """Remove duplicate wiki pages, keeping only the newest file per title.

    For each group of duplicates (same normalized title in the same category),
    keeps the file with the latest modification time and deletes the rest.
    """
    wiki_root = _resolve_root(workspace)
    dupes = WikiService._find_duplicate_pages(wiki_root)

    removed: list[str] = []
    kept: list[str] = []

    for group in dupes:
        files = group["files"]
        # Sort by modification time (newest first)
        from pathlib import Path as P
        files_sorted = sorted(
            files,
            key=lambda f: P(f).stat().st_mtime,
            reverse=True,
        )
        # Keep the newest, delete the rest
        kept.append(files_sorted[0])
        for f in files_sorted[1:]:
            try:
                P(f).unlink()
                removed.append(f)
            except OSError:
                pass

    return {
        "removed_count": len(removed),
        "removed": removed,
        "kept": kept,
    }
