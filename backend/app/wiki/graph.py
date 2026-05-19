"""Knowledge graph construction for wiki pages.

Ported from nashsu/llm_wiki ``src/lib/wiki-graph.ts`` and
``src/lib/graph-insights.ts``, adapted for Python/backend.

Builds a graph from wiki pages and their wikilink connections,
detects communities via connected components, and generates
insights (surprising connections, knowledge gaps).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from app.wiki.cleanup import extract_frontmatter_title, normalize_wiki_ref_key
from app.wiki.constants import DEFAULT_CATEGORIES

# Matches [[wikilink]] and [[wikilink|alias]]
_WIKILINK_RE = re.compile(r"\[\[([^\]|]+?)(?:\|[^\]]+)?\]\]")


# ── Data types ──────────────────────────────────────────────────────────────

@dataclass
class GraphNode:
    """A node in the knowledge graph (one wiki page)."""

    id: str
    title: str
    category: str
    type: str = ""
    link_count: int = 0
    community: int = -1


@dataclass
class GraphEdge:
    """An edge in the knowledge graph (a wikilink connection)."""

    source: str
    target: str
    edge_type: str = "wikilink"  # wikilink | tag


@dataclass
class GraphInsight:
    """An insight about the knowledge graph."""

    insight_type: str  # surprising_connection | knowledge_gap
    severity: str = "info"  # info | warning
    title: str = ""
    description: str = ""
    affected_pages: list[str] = field(default_factory=list)


@dataclass
class WikiGraph:
    """Complete knowledge graph data."""

    nodes: list[dict[str, Any]] = field(default_factory=list)
    edges: list[dict[str, Any]] = field(default_factory=list)
    communities: list[dict[str, Any]] = field(default_factory=list)
    insights: list[dict[str, Any]] = field(default_factory=list)
    stats: dict[str, Any] = field(default_factory=dict)


# ── Graph construction ──────────────────────────────────────────────────────

def _extract_frontmatter_field(content: str, field_name: str) -> str:
    """Extract a single field value from YAML frontmatter."""
    in_fm = False
    for line in content.splitlines():
        stripped = line.strip()
        if stripped == "---":
            if not in_fm:
                in_fm = True
                continue
            else:
                break
        if in_fm and stripped.startswith(f"{field_name}:"):
            return stripped[len(field_name) + 1:].strip().strip('"').strip("'")
    return ""


def build_wiki_graph(wiki_root: str) -> WikiGraph:
    """Build the complete knowledge graph from wiki pages.

    Algorithm:
    1. Walk all .md files → extract frontmatter title/type/category
    2. Scan [[wikilink]] → build edges (source → target)
    3. Compute link counts (in + out) per node
    4. Detect communities (connected components via Union-Find)
    5. Generate insights (surprising connections + knowledge gaps)
    """
    root = Path(wiki_root)
    if not root.is_dir():
        return WikiGraph()

    # ── Phase 1: Collect all pages ──────────────────────────────────
    # page_key (normalized) → GraphNode
    nodes: dict[str, GraphNode] = {}
    # page_key → list of outgoing wikilink targets (normalized)
    outlinks: dict[str, list[str]] = {}
    # page_key → raw content (for insight generation)
    page_contents: dict[str, str] = {}
    # page_key → set of tag slugs (for tag edges)
    page_tags: dict[str, set[str]] = {}

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

            page_type = _extract_frontmatter_field(content, "type") or cat.rstrip("s")
            page_id = md_file.stem
            key = normalize_wiki_ref_key(title)

            nodes[key] = GraphNode(
                id=page_id,
                title=title,
                category=cat,
                type=page_type,
            )
            page_contents[key] = content

            # Extract wikilinks from body (not frontmatter)
            body = re.sub(r"^---\n[\s\S]*?---\n", "", content)
            links = []
            for m in _WIKILINK_RE.finditer(body):
                target = m.group(1).strip()
                target_key = normalize_wiki_ref_key(target)
                links.append(target_key)
            outlinks[key] = links

            # Extract tags from frontmatter
            tags_str = _extract_frontmatter_field(content, "tags")
            if tags_str and tags_str != "[]":
                tag_set = set()
                for tag in re.findall(r'[\w-]+', tags_str):
                    tag_set.add(normalize_wiki_ref_key(tag))
                page_tags[key] = tag_set

    if not nodes:
        return WikiGraph()

    # ── Phase 2: Build edges ────────────────────────────────────────
    edges: list[GraphEdge] = []
    # Track incoming links per node
    incoming: dict[str, int] = {}

    for source_key, targets in outlinks.items():
        for target_key in targets:
            edges.append(GraphEdge(
                source=source_key,
                target=target_key,
                edge_type="wikilink",
            ))
            incoming[target_key] = incoming.get(target_key, 0) + 1

    # Add tag edges (page → tag)
    for source_key, tags in page_tags.items():
        for tag_key in tags:
            # Only create tag edge if the tag matches an existing page
            if tag_key in nodes:
                edges.append(GraphEdge(
                    source=source_key,
                    target=tag_key,
                    edge_type="tag",
                ))

    # ── Phase 3: Compute link counts ────────────────────────────────
    for key, node in nodes.items():
        out_count = len(outlinks.get(key, []))
        in_count = incoming.get(key, 0)
        node.link_count = out_count + in_count

    # ── Phase 4: Community detection (Union-Find) ───────────────────
    parent: dict[str, str] = {key: key for key in nodes}

    def find(x: str) -> str:
        while parent[x] != x:
            parent[x] = parent[parent[x]]  # path compression
            x = parent[x]
        return x

    def union(a: str, b: str) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    for edge in edges:
        if edge.source in nodes and edge.target in nodes:
            union(edge.source, edge.target)

    # Build community map: root_key → set of member keys
    communities_raw: dict[str, set[str]] = {}
    for key in nodes:
        root = find(key)
        communities_raw.setdefault(root, set()).add(key)

    # Assign community IDs
    community_id = 0
    community_map: dict[str, int] = {}
    community_list: list[dict[str, Any]] = []
    for root_key, members in communities_raw.items():
        for member in members:
            community_map[member] = community_id
        # Compute cohesion (internal edges / total possible edges)
        member_list = list(members)
        internal_edges = sum(
            1 for e in edges
            if e.source in members and e.target in members
        )
        n = len(members)
        max_possible = n * (n - 1)  # directed graph
        cohesion = internal_edges / max_possible if max_possible > 0 else 0.0

        community_list.append({
            "id": community_id,
            "size": n,
            "cohesion": round(cohesion, 3),
            "members": [nodes[k].id for k in member_list],
        })
        community_id += 1

    # Assign community to nodes
    for key, node in nodes.items():
        node.community = community_map.get(key, -1)

    # ── Phase 5: Generate insights ──────────────────────────────────
    insights = _generate_insights(nodes, edges, communities_raw, community_map, page_contents)

    # ── Build result ────────────────────────────────────────────────
    graph = WikiGraph(
        nodes=[
            {
                "id": node.id,
                "title": node.title,
                "category": node.category,
                "type": node.type,
                "linkCount": node.link_count,
                "community": node.community,
                "key": key,
            }
            for key, node in nodes.items()
        ],
        edges=[
            {
                "source": edge.source,
                "target": edge.target,
                "type": edge.edge_type,
            }
            for edge in edges
            if edge.source in nodes and edge.target in nodes
        ],
        communities=community_list,
        insights=[_insight_to_dict(i) for i in insights],
        stats={
            "total_nodes": len(nodes),
            "total_edges": len(edges),
            "total_communities": len(community_list),
            "orphan_nodes": sum(1 for n in nodes.values() if n.link_count == 0),
            "avg_links_per_node": round(
                sum(n.link_count for n in nodes.values()) / len(nodes), 2
            ) if nodes else 0,
        },
    )

    return graph


# ── Insight generation ──────────────────────────────────────────────────────

def _generate_insights(
    nodes: dict[str, GraphNode],
    edges: list[GraphEdge],
    communities_raw: dict[str, set[str]],
    community_map: dict[str, int],
    page_contents: dict[str, str],
) -> list[GraphInsight]:
    """Generate insights about the knowledge graph."""
    insights: list[GraphInsight] = []

    # ── Surprising connections ──────────────────────────────────────
    for edge in edges:
        if edge.source not in nodes or edge.target not in nodes:
            continue
        if edge.edge_type != "wikilink":
            continue

        src_community = community_map.get(edge.source, -1)
        tgt_community = community_map.get(edge.target, -1)

        # Cross-community connection
        if src_community != tgt_community and src_community >= 0 and tgt_community >= 0:
            src_node = nodes[edge.source]
            tgt_node = nodes[edge.target]
            insights.append(GraphInsight(
                insight_type="surprising_connection",
                severity="info",
                title=f"Cross-community link: {src_node.title} → {tgt_node.title}",
                description=(
                    f"'{src_node.title}' ({src_node.category}) links to "
                    f"'{tgt_node.title}' ({tgt_node.category}), crossing "
                    f"community boundaries. This may reveal a non-obvious "
                    f"connection worth exploring."
                ),
                affected_pages=[src_node.id, tgt_node.id],
            ))

    # ── Knowledge gaps ──────────────────────────────────────────────
    # 1. Isolated nodes (degree ≤ 1)
    for key, node in nodes.items():
        if node.link_count <= 1:
            insights.append(GraphInsight(
                insight_type="knowledge_gap",
                severity="info",
                title=f"Isolated page: {node.title}",
                description=(
                    f"'{node.title}' has {node.link_count} connection(s). "
                    f"Consider adding [[wikilinks]] to connect it with "
                    f"related pages."
                ),
                affected_pages=[node.id],
            ))

    # 2. Sparse communities (cohesion < 0.15, ≥3 nodes)
    for root_key, members in communities_raw.items():
        n = len(members)
        if n < 3:
            continue
        internal = sum(
            1 for e in edges
            if e.source in members and e.target in members
        )
        max_possible = n * (n - 1)
        cohesion = internal / max_possible if max_possible > 0 else 0.0
        if cohesion < 0.15:
            member_names = [nodes[k].title for k in members if k in nodes]
            insights.append(GraphInsight(
                insight_type="knowledge_gap",
                severity="info",
                title=f"Sparse community ({n} pages)",
                description=(
                    f"A community of {n} pages ({', '.join(member_names[:5])}"
                    f"{'...' if len(member_names) > 5 else ''}) has low "
                    f"cohesion ({cohesion:.1%}). Consider adding more "
                    f"cross-references within this group."
                ),
                affected_pages=[nodes[k].id for k in members if k in nodes],
            ))

    # 3. Bridge nodes (connect ≥3 communities)
    community_connections: dict[str, set[int]] = {}
    for edge in edges:
        if edge.source not in nodes or edge.target not in nodes:
            continue
        src_c = community_map.get(edge.source, -1)
        tgt_c = community_map.get(edge.target, -1)
        if src_c != tgt_c and src_c >= 0 and tgt_c >= 0:
            community_connections.setdefault(edge.source, set()).add(tgt_c)
            community_connections.setdefault(edge.target, set()).add(src_c)

    for key, connected_communities in community_connections.items():
        if len(connected_communities) >= 3 and key in nodes:
            node = nodes[key]
            insights.append(GraphInsight(
                insight_type="surprising_connection",
                severity="info",
                title=f"Bridge node: {node.title}",
                description=(
                    f"'{node.title}' connects {len(connected_communities)} "
                    f"different communities, acting as a knowledge bridge. "
                    f"This page is critical for cross-domain navigation."
                ),
                affected_pages=[node.id],
            ))

    return insights


def _insight_to_dict(insight: GraphInsight) -> dict[str, Any]:
    """Convert a GraphInsight to a dict for API serialization."""
    return {
        "type": insight.insight_type,
        "severity": insight.severity,
        "title": insight.title,
        "description": insight.description,
        "affectedPages": insight.affected_pages,
    }
