"""Wiki Knowledge Center REST API."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Query, UploadFile, File
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
    mode: str = "keyword"  # keyword, semantic, hybrid


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
    scope: str = Query("structural", description="Lint scope: structural, semantic, or full"),
) -> dict[str, Any]:
    """Check the wiki for health issues.

    Scopes:
    - structural: Pure code checks (orphans, broken links, no-outlinks)
    - semantic: LLM-driven checks (contradictions, stale, missing pages)
    - full: Both structural and semantic checks
    """
    wiki_root = _resolve_root(workspace)
    return await WikiService.lint_wiki(wiki_root, scope=scope)


@router.get("/graph")
async def wiki_graph(
    workspace: str | None = Query(None, description="Workspace directory"),
) -> dict[str, Any]:
    """Get the knowledge graph (nodes, edges, communities, insights).

    Builds the graph from all wiki pages and their wikilink connections.
    """
    wiki_root = _resolve_root(workspace)
    return await WikiService.get_graph(wiki_root)


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
    """Search wiki pages.

    Supports three modes:
    - keyword: Token-based search (default)
    - semantic: Vector similarity search (requires embedding backend)
    - hybrid: RRF fusion of keyword + vector search
    """
    wiki_root = _resolve_root(workspace)

    # Auto-initialize if needed
    status = await WikiService.get_status(wiki_root)
    if not status.get("initialized"):
        await WikiService.initialize(wiki_root)

    mode = request.mode

    if mode == "semantic":
        return await WikiService.semantic_search(
            wiki_root, request.query, max_results=request.max_results,
        )
    elif mode == "hybrid":
        return await WikiService.hybrid_search(
            wiki_root, request.query, max_results=request.max_results,
        )
    else:
        # Default: keyword search
        results = await WikiService.search(wiki_root, request.query, max_results=request.max_results)
        return {
            "results": [
                {
                    "page_id": r.page_id,
                    "title": r.title,
                    "category": r.category,
                    "snippet": r.snippet,
                    "highlighted_snippet": r.highlighted_snippet,
                    "title_match": r.title_match,
                    "score": r.score,
                }
                for r in results
            ],
            "count": len(results),
            "query": request.query,
            "mode": "keyword",
        }


@router.post("/rebuild-vectors")
async def wiki_rebuild_vectors(
    workspace: str | None = Query(None, description="Workspace directory"),
) -> dict[str, Any]:
    """Rebuild the vector index for all wiki pages.

    Requires an embedding backend (Ollama or OpenAI) to be available.
    """
    wiki_root = _resolve_root(workspace)
    return await WikiService.rebuild_vector_index(wiki_root)


@router.get("/contradictions")
async def wiki_contradictions(
    workspace: str | None = Query(None, description="Workspace directory"),
) -> dict[str, Any]:
    """Find page pairs that might contain contradictions.

    Returns candidate pairs with their keyword overlap similarity.
    Use the contradiction prompt with an LLM to verify.
    """
    wiki_root = _resolve_root(workspace)
    candidates = WikiService.get_contradiction_candidates(wiki_root)
    return {
        "candidates": [
            {"page_a": a, "page_b": b, "similarity": round(s, 3)}
            for a, b, s in candidates
        ],
        "count": len(candidates),
    }


@router.post("/ingest-file")
async def wiki_ingest_file(
    file: UploadFile = File(..., description="File to ingest into the wiki"),
    workspace: str | None = Query(None, description="Workspace directory"),
    purpose: str = Query("general", description="Purpose of ingestion"),
) -> dict[str, Any]:
    """Ingest an uploaded file into the wiki.

    Reads the file content and creates a source summary page.
    Supported formats: .md, .txt, .json, .csv, .yaml, .yml, .toml.
    """
    wiki_root = _resolve_root(workspace)

    # Validate file type
    filename = file.filename or "unknown"
    supported_extensions = {".md", ".txt", ".json", ".csv", ".yaml", ".yml", ".toml"}
    from pathlib import Path as P
    ext = P(filename).suffix.lower()
    if ext not in supported_extensions:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{ext}'. Supported: {', '.join(sorted(supported_extensions))}",
        )

    # Read file content
    try:
        raw_bytes = await file.read()
        content = raw_bytes.decode("utf-8", errors="replace")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to read file: {e}")

    # Limit file size (10 MB)
    if len(raw_bytes) > 10 * 1024 * 1024:
        raise HTTPException(status_code=400, detail="File too large (max 10 MB)")

    # Auto-initialize if needed
    status = await WikiService.get_status(wiki_root)
    if not status.get("initialized"):
        await WikiService.initialize(wiki_root)

    # Use filename (without extension) as source name
    source_name = P(filename).stem

    return await WikiService.ingest_source(
        wiki_root, source_name, content, purpose=purpose
    )


@router.get("/review")
async def wiki_review(
    workspace: str | None = Query(None, description="Workspace directory"),
) -> dict[str, Any]:
    """Get review items generated from lint results.

    Returns actionable review items that users can approve, skip,
    or resolve through the UI.
    """
    wiki_root = _resolve_root(workspace)
    return await WikiService.get_review_items(wiki_root)


@router.post("/review/{item_id}/resolve")
async def wiki_review_resolve(
    item_id: str,
    workspace: str | None = Query(None, description="Workspace directory"),
) -> dict[str, Any]:
    """Mark a review item as resolved."""
    wiki_root = _resolve_root(workspace)
    success = await WikiService.resolve_review_item(wiki_root, item_id)
    if not success:
        raise HTTPException(status_code=404, detail=f"Review item not found: {item_id}")
    return {"resolved": True, "item_id": item_id}


@router.get("/ingest-queue")
async def wiki_ingest_queue(
    workspace: str | None = Query(None, description="Workspace directory"),
) -> dict[str, Any]:
    """Get the current ingest queue status."""
    wiki_root = _resolve_root(workspace)
    return await WikiService.get_ingest_queue(wiki_root)


@router.post("/ingest-queue/process")
async def wiki_ingest_queue_process(
    workspace: str | None = Query(None, description="Workspace directory"),
) -> dict[str, Any]:
    """Process all pending jobs in the ingest queue."""
    wiki_root = _resolve_root(workspace)
    return await WikiService.process_ingest_queue(wiki_root)


@router.post("/ingest-queue/{job_id}/retry")
async def wiki_ingest_queue_retry(
    job_id: str,
    workspace: str | None = Query(None, description="Workspace directory"),
) -> dict[str, Any]:
    """Retry a failed ingest job."""
    wiki_root = _resolve_root(workspace)
    success = await WikiService.retry_ingest_job(wiki_root, job_id)
    if not success:
        raise HTTPException(status_code=404, detail=f"Ingest job not found or not failed: {job_id}")
    return {"retried": True, "job_id": job_id}


@router.get("/pages/{page_id:path}/cascade")
async def wiki_cascade_preview(
    page_id: str,
    workspace: str | None = Query(None, description="Workspace directory"),
) -> dict[str, Any]:
    """Preview what would be affected by cascade deletion (no changes made)."""
    wiki_root = _resolve_root(workspace)
    return await WikiService.get_cascade_targets(wiki_root, page_id)


@router.delete("/pages/{page_id:path}/cascade")
async def wiki_cascade_delete(
    page_id: str,
    workspace: str | None = Query(None, description="Workspace directory"),
) -> dict[str, Any]:
    """Delete a wiki page with cascade cleanup of all references."""
    wiki_root = _resolve_root(workspace)
    result = await WikiService.delete_page_cascade(wiki_root, page_id)
    if not result.get("deleted"):
        raise HTTPException(status_code=404, detail=f"Page not found: {page_id}")
    return result


@router.post("/review-sweep")
async def wiki_review_sweep(
    workspace: str | None = Query(None, description="Workspace directory"),
    phase: str = Query("rules", description="Sweep phase: rules, semantic, or full"),
) -> dict[str, Any]:
    """Run review sweep cleanup (rule-based or semantic)."""
    wiki_root = _resolve_root(workspace)
    return await WikiService.run_review_sweep(wiki_root, phase=phase)


@router.get("/duplicates")
async def wiki_duplicates(
    workspace: str | None = Query(None, description="Workspace directory"),
    include_semantic: bool = Query(False, description="Include semantic dedup (requires embedding)"),
) -> dict[str, Any]:
    """Find duplicate wiki pages using content hashing, trigram similarity,
    and optionally vector similarity.

    Returns three levels:
    - exact: Pages with identical content hash
    - near: Pages with trigram similarity > 0.8
    - semantic: Pages with vector similarity > 0.9 (if include_semantic=True)
    """
    wiki_root = _resolve_root(workspace)
    return WikiService.find_duplicate_pages(
        wiki_root, include_semantic=include_semantic,
    )


@router.post("/watcher/start")
async def wiki_watcher_start(
    workspace: str = Query(..., description="Workspace directory to watch"),
) -> dict[str, Any]:
    """Start a file watcher for automatic wiki ingestion.

    Monitors the workspace directory for new/modified/deleted files
    and automatically triggers wiki ingestion or cleanup.
    Requires watchfiles package for efficient watching (falls back to polling).
    """
    wiki_root = WikiService.resolve_wiki_root(workspace)
    return await WikiService.start_file_watcher(workspace, wiki_root=wiki_root)


@router.post("/watcher/stop")
async def wiki_watcher_stop(
    workspace: str = Query(..., description="Workspace directory"),
) -> dict[str, Any]:
    """Stop the file watcher for the given workspace."""
    return await WikiService.stop_file_watcher(workspace)


@router.get("/watcher/status")
async def wiki_watcher_status(
    workspace: str | None = Query(None, description="Workspace directory"),
) -> dict[str, Any]:
    """Get the status of the file watcher."""
    if workspace:
        return WikiService.get_file_watcher_status(workspace)
    # Return all watcher statuses
    from app.wiki.watcher import get_all_watcher_statuses
    return {"watchers": get_all_watcher_statuses()}


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
