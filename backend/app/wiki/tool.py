"""Wiki tool — LLM-callable interface to the Wiki Knowledge Center.

Exposes read, write, merge, search, list, delete, and status actions via a
single ``wiki`` tool.  The wiki root is resolved from the session's
workspace (project-level ``.wiki`` or global ``~/.xflow/wiki``).
"""

from __future__ import annotations

import json
import logging
from typing import Any

from app.tool.base import ToolDefinition, ToolResult
from app.tool.context import ToolContext
from app.wiki.service import WikiService

logger = logging.getLogger(__name__)

_WIKI_CATEGORIES = [
    "entities",
    "concepts",
    "sources",
    "synthesis",
    "comparison",
    "queries",
]

_ACTION_DESCRIPTION = """\
Interact with the Wiki Knowledge Center to store, retrieve, search, \
ingest, lint, and merge structured knowledge pages.

Actions:
- **status**: Get wiki status (page counts, categories, initialization state)
- **search**: Search wiki pages by keyword. Use `query` parameter.
  ALWAYS search before writing to avoid duplicates.
- **list**: List wiki pages, optionally filtered by `category`.
- **read**: Read a specific wiki page by title or slug. Use `page_id`.
- **write**: Create or overwrite a wiki page. Requires `title` and `content`.
  - If the page does NOT exist: creates it.
  - If the page already exists and `force` is false (default): returns the \
existing content and asks you to decide how to proceed.
  - If the page already exists and `force` is true: overwrites the page \
with the new content. Use this ONLY after reviewing the existing content \
and preparing a proper merged version.
- **merge**: Merge new sections into an existing wiki page by heading. \
Requires `title` and `content`. Sections in `content` that share a heading \
with existing sections will replace them; new headings are appended. \
This is the PREFERRED way to update an existing page — it preserves all \
existing knowledge while adding or updating specific sections.
- **ingest**: Ingest a source document into the wiki. Requires `source_name` \
and `source` (the content). Creates a source summary page in the sources \
category, then you should extract key entities and concepts into separate \
pages with [[wikilinks]] cross-references.
- **lint**: Check the wiki for health issues (orphan pages, broken \
wikilinks, stale pages, empty categories). Returns a report you can act on.
- **graph**: Get the knowledge graph — nodes, edges, communities, and insights.
  Useful for understanding how pages are connected and finding knowledge gaps.
- **review**: Get actionable review items from lint results. Returns a list of
  items (broken links, orphan pages, stale pages, etc.) with suggested actions.
  Use this to identify and fix wiki quality issues.
- **contradictions**: Find page pairs that might contain contradictory information.
  Returns candidate pairs with keyword overlap similarity. Use with an LLM
  to verify contradictions.
- **dedup**: Find duplicate wiki pages using content hashing, trigram similarity,
  and optionally vector similarity. Returns exact, near, and semantic duplicate
  pairs that may need merging. Set `include_semantic=true` for vector-based dedup.
- **delete**: Delete a wiki page by `page_id`. Also cleans up references.

The wiki root is determined automatically:
- In a project session: {workspace}/.wiki
- In a global session: ~/.xflow/wiki

Wiki pages use Markdown with YAML frontmatter. Categories organize pages:
entities, concepts, sources, synthesis, comparison, queries.

## WRITE POLICY

- ONLY write when: (a) the user explicitly asks you to save something, \
or (b) you are ingesting a source document into the wiki
- NEVER auto-write conversation summaries — the wiki is a curated \
knowledge base, not a chat log
- ALWAYS search before writing to avoid duplicates
- When updating an existing page, prefer the **merge** action to preserve \
existing knowledge. Use **write** with force=true only when a complete \
rewrite is genuinely needed
- If the write action returns `exists=true`, you MUST either:
  1. Call **merge** with just the new/changed sections, OR
  2. Review the existing content, merge it with your new content, \
then call **write** again with force=true and the complete merged content
- Do NOT simply overwrite with force=true without incorporating the \
existing knowledge — that causes data loss
"""


class WikiTool(ToolDefinition):
    """Wiki Knowledge Center tool — lets the LLM manage knowledge pages."""

    @property
    def id(self) -> str:
        return "wiki"

    @property
    def is_concurrency_safe(self) -> bool:
        return True

    @property
    def description(self) -> str:
        return _ACTION_DESCRIPTION

    def parameters_schema(self) -> dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "enum": [
                        "status", "search", "list", "read",
                        "write", "merge", "ingest", "lint", "graph",
                        "review", "contradictions", "dedup", "delete",
                    ],
                    "description": "Action to perform on the wiki",
                },
                "query": {
                    "type": "string",
                    "description": "Search query (for search action)",
                },
                "title": {
                    "type": "string",
                    "description": "Page title (for write/merge action, or as search key for read)",
                },
                "content": {
                    "type": "string",
                    "description": "Page content in Markdown (for write/merge action)",
                },
                "page_id": {
                    "type": "string",
                    "description": "Page ID/slug (for read/delete action)",
                },
                "category": {
                    "type": "string",
                    "enum": _WIKI_CATEGORIES,
                    "description": "Wiki category (default: entities)",
                },
                "force": {
                    "type": "boolean",
                    "description": (
                        "For write action: if true, overwrite existing page "
                        "without confirmation. Default: false."
                    ),
                    "default": False,
                },
                "max_results": {
                    "type": "integer",
                    "description": "Maximum search results (default: 10)",
                    "default": 10,
                },
                "source_name": {
                    "type": "string",
                    "description": "Name/title for the source document (for ingest action)",
                },
                "source": {
                    "type": "string",
                    "description": "Source document content (for ingest action)",
                },
                "purpose": {
                    "type": "string",
                    "description": "Purpose of ingestion: general, research, reference, tutorial",
                    "enum": ["general", "research", "reference", "tutorial"],
                    "default": "general",
                },
                "scope": {
                    "type": "string",
                    "description": "Lint scope: structural (code-only), semantic (LLM), or full (both)",
                    "enum": ["structural", "semantic", "full"],
                    "default": "structural",
                },
                "include_semantic": {
                    "type": "boolean",
                    "description": "For dedup action: include vector similarity (semantic) dedup. Requires embedding. Default: false.",
                    "default": False,
                },
            },
            "required": ["action"],
        }

    async def execute(self, args: dict[str, Any], ctx: ToolContext) -> ToolResult:
        action = args["action"]
        wiki_root = WikiService.resolve_wiki_root(ctx.workspace)

        if wiki_root is None:
            return ToolResult(
                error="Cannot determine wiki root: no workspace and home directory unavailable"
            )

        # Dispatch
        handler = {
            "status": self._handle_status,
            "search": self._handle_search,
            "list": self._handle_list,
            "read": self._handle_read,
            "write": self._handle_write,
            "merge": self._handle_merge,
            "ingest": self._handle_ingest,
            "lint": self._handle_lint,
            "graph": self._handle_graph,
            "review": self._handle_review,
            "contradictions": self._handle_contradictions,
            "dedup": self._handle_dedup,
            "delete": self._handle_delete,
        }.get(action)

        if handler is None:
            return ToolResult(error=f"Unknown wiki action: {action}")

        return await handler(args, wiki_root)

    # ------------------------------------------------------------------
    # Action handlers
    # ------------------------------------------------------------------

    @staticmethod
    async def _handle_status(args: dict, wiki_root: str) -> ToolResult:
        status = await WikiService.get_status(wiki_root)
        if not status.get("initialized"):
            # Auto-initialize
            status = await WikiService.initialize(wiki_root)

        lines = [
            f"Wiki root: {wiki_root}",
            f"Initialized: {status.get('initialized', False)}",
            f"Total pages: {status.get('total_pages', 0)}",
            "",
            "Categories:",
        ]
        for cat, count in status.get("categories", {}).items():
            lines.append(f"  - {cat}: {count} page(s)")

        return ToolResult(
            output="\n".join(lines),
            title="Wiki Status",
            metadata=status,
        )

    @staticmethod
    async def _handle_search(args: dict, wiki_root: str) -> ToolResult:
        query = args.get("query", "")
        if not query:
            return ToolResult(error="Search requires a 'query' parameter")

        max_results = args.get("max_results", 10)

        # Auto-initialize if needed
        status = await WikiService.get_status(wiki_root)
        if not status.get("initialized"):
            await WikiService.initialize(wiki_root)

        results = await WikiService.search(wiki_root, query, max_results=max_results)

        if not results:
            return ToolResult(
                output="(no results)",
                title=f'No wiki results for "{query}"',
                metadata={"count": 0, "query": query},
            )

        lines = []
        for rank, r in enumerate(results, 1):
            header = f"{rank}. {r.title}"
            if r.title_match:
                header += " [title match]"
            header += f"  [score: {r.score:.0f}]"
            lines.append(header)
            if r.snippet:
                lines.append(f"   {r.snippet[:200]}")
            lines.append("")

        return ToolResult(
            output="\n".join(lines).rstrip(),
            title=f'{len(results)} wiki results for "{query}"',
            metadata={
                "count": len(results),
                "query": query,
                "results": [
                    {
                        "page_id": r.page_id,
                        "title": r.title,
                        "category": r.category,
                        "score": r.score,
                        "title_match": r.title_match,
                    }
                    for r in results
                ],
            },
        )

    @staticmethod
    async def _handle_list(args: dict, wiki_root: str) -> ToolResult:
        category = args.get("category")

        status = await WikiService.get_status(wiki_root)
        if not status.get("initialized"):
            await WikiService.initialize(wiki_root)

        pages = await WikiService.list_pages(wiki_root, category=category)

        if not pages:
            cat_msg = f" in category '{category}'" if category else ""
            return ToolResult(
                output=f"(no pages{cat_msg})",
                title="Wiki: empty",
                metadata={"count": 0},
            )

        lines = []
        current_cat = ""
        for p in pages:
            if p["category"] != current_cat:
                current_cat = p["category"]
                lines.append(f"## {current_cat}")
            lines.append(f"  - [{p['title']}] (id: {p['page_id']})")

        return ToolResult(
            output="\n".join(lines),
            title=f"Wiki: {len(pages)} page(s)",
            metadata={"count": len(pages), "pages": pages},
        )

    @staticmethod
    async def _handle_read(args: dict, wiki_root: str) -> ToolResult:
        page_id = args.get("page_id") or args.get("title", "")
        if not page_id:
            return ToolResult(error="Read requires a 'page_id' or 'title' parameter")

        page = await WikiService.read_page(wiki_root, page_id)
        if page is None:
            return ToolResult(error=f"Wiki page not found: {page_id}")

        # Return content with metadata
        header = f"# {page['title']}\nCategory: {page['category']}\n"
        output = header + "\n" + page["content"]

        return ToolResult(
            output=output,
            title=page["title"],
            metadata={
                "page_id": page["page_id"],
                "title": page["title"],
                "category": page["category"],
                "path": page["path"],
            },
        )

    @staticmethod
    async def _handle_write(args: dict, wiki_root: str) -> ToolResult:
        title = args.get("title", "")
        content = args.get("content", "")
        if not title:
            return ToolResult(error="Write requires a 'title' parameter")

        category = args.get("category", "entities")
        if category not in _WIKI_CATEGORIES:
            return ToolResult(
                error=f"Invalid category '{category}'. Must be one of: {_WIKI_CATEGORIES}"
            )

        force = args.get("force", False)

        # Auto-initialize if needed
        status = await WikiService.get_status(wiki_root)
        if not status.get("initialized"):
            await WikiService.initialize(wiki_root)

        result = await WikiService.write_page(
            wiki_root, title, content, category, force=force
        )

        # Page already exists — return existing content for LLM to review
        if result.get("exists"):
            preview = result.get("existing_content_preview", "")
            return ToolResult(
                output=(
                    f"⚠ Page '{title}' already exists in {category}.\n\n"
                    f"--- Existing content preview ---\n{preview}\n"
                    f"--- End preview ---\n\n"
                    f"To update this page, choose one of:\n"
                    f"1. merge action: supply only the new/changed sections "
                    f"(RECOMMENDED — preserves all existing knowledge)\n"
                    f"2. write action with force=true: supply the FULL merged "
                    f"content (only if a complete rewrite is needed)\n"
                    f"Do NOT overwrite with force=true without incorporating "
                    f"the existing content."
                ),
                title=f"Page exists: {title}",
                metadata=result,
            )

        action_word = "updated" if result.get("updated") else "created"
        return ToolResult(
            output=f"Wiki page {action_word}: {result['title']} ({result['category']}/{result['filename']})",
            title=f"Saved: {result['title']}",
            metadata=result,
        )

    @staticmethod
    async def _handle_merge(args: dict, wiki_root: str) -> ToolResult:
        title = args.get("title", "")
        content = args.get("content", "")
        if not title:
            return ToolResult(error="Merge requires a 'title' parameter")
        if not content:
            return ToolResult(error="Merge requires 'content' with the sections to merge")

        category = args.get("category", "entities")
        if category not in _WIKI_CATEGORIES:
            return ToolResult(
                error=f"Invalid category '{category}'. Must be one of: {_WIKI_CATEGORIES}"
            )

        # Auto-initialize if needed
        status = await WikiService.get_status(wiki_root)
        if not status.get("initialized"):
            await WikiService.initialize(wiki_root)

        result = await WikiService.merge_page(wiki_root, title, content, category)

        if result.get("merged") is False and result.get("error"):
            # Merge was aborted (e.g. body length guard)
            return ToolResult(
                error=f"Merge aborted: {result['error']}",
                title=f"Merge failed: {title}",
                metadata=result,
            )

        if result.get("merged"):
            backup_msg = ""
            if result.get("backup"):
                backup_msg = f" (backup: {result['backup']})"
            return ToolResult(
                output=(
                    f"Wiki page merged: {result['title']} "
                    f"({result['category']}/{result['filename']}) — "
                    f"sections updated/appended, existing knowledge preserved{backup_msg}"
                ),
                title=f"Merged: {result['title']}",
                metadata=result,
            )
        else:
            # No existing page — fell back to create
            return ToolResult(
                output=(
                    f"Wiki page created: {result['title']} "
                    f"({result['category']}/{result['filename']}) — "
                    f"no existing page found, created new"
                ),
                title=f"Created: {result['title']}",
                metadata=result,
            )

    @staticmethod
    async def _handle_delete(args: dict, wiki_root: str) -> ToolResult:
        page_id = args.get("page_id", "")
        if not page_id:
            return ToolResult(error="Delete requires a 'page_id' parameter")

        success = await WikiService.delete_page(wiki_root, page_id)
        if not success:
            return ToolResult(error=f"Wiki page not found or could not be deleted: {page_id}")

        return ToolResult(
            output=f"Wiki page deleted: {page_id}",
            title=f"Deleted: {page_id}",
            metadata={"page_id": page_id, "deleted": True},
        )

    @staticmethod
    async def _handle_ingest(args: dict, wiki_root: str) -> ToolResult:
        source_name = args.get("source_name", "")
        source_content = args.get("source", "")
        if not source_name:
            return ToolResult(error="Ingest requires a 'source_name' parameter")
        if not source_content:
            return ToolResult(error="Ingest requires 'source' (the document content)")

        purpose = args.get("purpose", "general")

        # Auto-initialize if needed
        status = await WikiService.get_status(wiki_root)
        if not status.get("initialized"):
            await WikiService.initialize(wiki_root)

        result = await WikiService.ingest_source(
            wiki_root, source_name, source_content, purpose=purpose
        )

        lines = [
            f"Source '{source_name}' ingested into wiki ({result.get('content_length', 0)} chars).",
            "",
            "Next steps — you should now:",
            "1. Read the source page and extract key entities → create entity pages",
            "2. Extract key concepts → create concept pages",
            "3. Add [[wikilinks]] between related pages",
            "4. Update the source page's 'Key Entities' and 'Key Concepts' sections",
        ]

        return ToolResult(
            output="\n".join(lines),
            title=f"Ingested: {source_name}",
            metadata=result,
        )

    @staticmethod
    async def _handle_lint(args: dict, wiki_root: str) -> ToolResult:
        # Auto-initialize if needed
        status = await WikiService.get_status(wiki_root)
        if not status.get("initialized"):
            await WikiService.initialize(wiki_root)

        scope = args.get("scope", "structural")
        result = await WikiService.lint_wiki(wiki_root, scope=scope)

        if result.get("healthy"):
            return ToolResult(
                output="Wiki is healthy — no issues found.",
                title="Wiki Lint: Healthy",
                metadata=result,
            )

        summary = result.get("summary", {})
        issues = result.get("issues", [])

        lines = [
            f"Wiki lint found {result.get('total_issues', 0)} issue(s) [{scope}]:",
        ]
        for issue_type, count in summary.items():
            lines.append(f"  - {issue_type}: {count}")
        lines.append("")

        for issue in issues[:20]:  # Show top 20 issues
            severity = issue.get("severity", "info")
            icon = "⚠️" if severity == "warning" else "ℹ️"
            lines.append(f"{icon} {issue.get('message', 'Unknown issue')}")

        if len(issues) > 20:
            lines.append(f"... and {len(issues) - 20} more issues")

        lines.append("")
        lines.append("Suggested actions:")
        lines.append("- For orphan pages: add [[wikilinks]] from other pages")
        lines.append("- For broken wikilinks: create the missing page or fix the link")
        lines.append("- For stale pages: review and update with current information")

        return ToolResult(
            output="\n".join(lines),
            title=f"Wiki Lint: {result.get('total_issues', 0)} issue(s)",
            metadata=result,
        )

    @staticmethod
    async def _handle_review(args: dict, wiki_root: str) -> ToolResult:
        # Auto-initialize if needed
        status = await WikiService.get_status(wiki_root)
        if not status.get("initialized"):
            await WikiService.initialize(wiki_root)

        result = await WikiService.get_review_items(wiki_root)

        open_count = result.get("open", 0)
        warnings = result.get("warnings", 0)
        items = result.get("items", [])

        if open_count == 0:
            return ToolResult(
                output="No open review items — wiki is in good shape!",
                title="Wiki Review: Clean",
                metadata=result,
            )

        lines = [
            f"Wiki review: {open_count} open item(s) ({warnings} warning(s))",
            "",
        ]

        for item in items:
            if item["status"] != "open":
                continue
            icon = "⚠️" if item["severity"] == "warning" else "ℹ️"
            lines.append(f"{icon} {item['title']}")
            if item.get("description"):
                lines.append(f"   {item['description'][:150]}")
            action = item.get("suggested_action", "")
            if action:
                lines.append(f"   Suggested: {action}")
            lines.append("")

        return ToolResult(
            output="\n".join(lines).rstrip(),
            title=f"Wiki Review: {open_count} item(s)",
            metadata=result,
        )

    @staticmethod
    async def _handle_contradictions(args: dict, wiki_root: str) -> ToolResult:
        """Find page pairs that might contain contradictions."""
        # Auto-initialize if needed
        status = await WikiService.get_status(wiki_root)
        if not status.get("initialized"):
            await WikiService.initialize(wiki_root)

        candidates = WikiService.get_contradiction_candidates(wiki_root)

        if not candidates:
            return ToolResult(
                output="No contradiction candidates found — all pages appear consistent.",
                title="Contradictions: None",
                metadata={"count": 0},
            )

        lines = [f"Found {len(candidates)} page pair(s) with potential contradictions:", ""]
        for page_a, page_b, similarity in candidates[:20]:
            lines.append(f"  ⚠️ '{page_a}' ↔ '{page_b}' (similarity: {similarity:.0%})")
            # Generate the verification prompt for each pair
            prompt = WikiService.get_contradiction_prompt(page_a, page_b, wiki_root)
            if prompt:
                lines.append(f"     → Use the contradiction prompt to verify with an LLM")

        if len(candidates) > 20:
            lines.append(f"  ... and {len(candidates) - 20} more pairs")

        return ToolResult(
            output="\n".join(lines),
            title=f"Contradictions: {len(candidates)} candidate(s)",
            metadata={
                "count": len(candidates),
                "candidates": [
                    {"page_a": a, "page_b": b, "similarity": round(s, 3)}
                    for a, b, s in candidates
                ],
            },
        )

    @staticmethod
    async def _handle_dedup(args: dict, wiki_root: str) -> ToolResult:
        """Find duplicate wiki pages (exact, near, and optionally semantic)."""
        # Auto-initialize if needed
        status = await WikiService.get_status(wiki_root)
        if not status.get("initialized"):
            await WikiService.initialize(wiki_root)

        include_semantic = args.get("include_semantic", False)
        result = WikiService.find_duplicate_pages(
            wiki_root, include_semantic=include_semantic,
        )

        exact = result.get("exact", [])
        near = result.get("near", [])
        semantic = result.get("semantic", [])
        total = len(exact) + len(near) + len(semantic)

        if total == 0:
            return ToolResult(
                output="No duplicate pages found — all pages are unique.",
                title="Dedup: Clean",
                metadata=result,
            )

        lines = [f"Found {total} duplicate group(s):", ""]

        if exact:
            lines.append("Exact duplicates (identical content):")
            for group in exact:
                page_ids = group.get("page_ids", [])
                titles = group.get("titles", [])
                lines.append(f"  📄 {', '.join(titles)} ({', '.join(page_ids)})")

        if near:
            lines.append("")
            lines.append("Near duplicates (trigram similarity > 0.8):")
            for pair in near:
                titles = pair.get("titles", [])
                similarity = pair.get("similarity", 0)
                lines.append(f"  📄 {titles[0]} ↔ {titles[1]} (similarity: {similarity:.0%})")

        if semantic:
            lines.append("")
            lines.append("Semantic duplicates (vector similarity > 0.9):")
            for pair in semantic:
                titles = pair.get("titles", [])
                similarity = pair.get("similarity", 0)
                lines.append(f"  📄 {titles[0]} ↔ {titles[1]} (similarity: {similarity:.0%})")

        lines.append("")
        lines.append("Suggested action: Use the /wiki/deduplicate endpoint to remove duplicates,")
        lines.append("or manually merge pages with overlapping content.")

        return ToolResult(
            output="\n".join(lines),
            title=f"Dedup: {total} group(s)",
            metadata=result,
        )

    @staticmethod
    async def _handle_graph(args: dict, wiki_root: str) -> ToolResult:
        # Auto-initialize if needed
        status = await WikiService.get_status(wiki_root)
        if not status.get("initialized"):
            await WikiService.initialize(wiki_root)

        result = await WikiService.get_graph(wiki_root)

        stats = result.get("stats", {})
        nodes = result.get("nodes", [])
        insights = result.get("insights", [])

        lines = [
            f"Knowledge Graph: {stats.get('total_nodes', 0)} nodes, "
            f"{stats.get('total_edges', 0)} edges, "
            f"{stats.get('total_communities', 0)} communities",
            f"Orphan nodes: {stats.get('orphan_nodes', 0)}",
            f"Avg links per node: {stats.get('avg_links_per_node', 0)}",
            "",
        ]

        if insights:
            lines.append("Insights:")
            for insight in insights[:10]:
                icon = "🔗" if insight.get("type") == "surprising_connection" else "🕳️"
                lines.append(f"  {icon} {insight.get('title', 'Unknown')}")
            if len(insights) > 10:
                lines.append(f"  ... and {len(insights) - 10} more insights")

        return ToolResult(
            output="\n".join(lines),
            title=f"Wiki Graph: {stats.get('total_nodes', 0)} nodes",
            metadata=result,
        )
