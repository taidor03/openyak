"use client";

import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  X,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Loader2,
  AlertCircle,
  Lightbulb,
} from "lucide-react";
import Graph from "graphology";
import { SigmaContainer, useLoadGraph, useRegisterEvents, useSetSettings, useSigma } from "@react-sigma/core";
import "@react-sigma/core/lib/style.css";
import forceAtlas2 from "graphology-layout-forceatlas2";
import { random } from "graphology-layout";

import { cn } from "@/lib/utils";
import { api } from "@/lib/api";

// ── Types ──────────────────────────────────────────────────────────────────

interface GraphNode {
  id: string;
  title: string;
  category: string;
  type: string;
  linkCount: number;
  community: number;
  key: string;
}

interface GraphEdge {
  source: string;
  target: string;
  type: string;
}

interface GraphInsight {
  type: string;
  severity: string;
  title: string;
  description: string;
  affectedPages: string[];
}

interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  communities: { id: number; size: number; cohesion: number; members: string[] }[];
  insights: GraphInsight[];
  stats: {
    total_nodes: number;
    total_edges: number;
    total_communities: number;
    orphan_nodes: number;
    avg_links_per_node: number;
  };
}

// ── Category colors ────────────────────────────────────────────────────────

const CATEGORY_COLORS: Record<string, string> = {
  entities: "#3b82f6",     // blue
  concepts: "#22c55e",     // green
  sources: "#94a3b8",      // gray
  synthesis: "#a855f7",    // purple
  comparison: "#f59e0b",   // amber
  queries: "#f97316",      // orange
};

const COMMUNITY_COLORS = [
  "#3b82f6", "#22c55e", "#a855f7", "#f59e0b", "#ef4444",
  "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#6366f1",
];

// ── Build graphology Graph from API data ───────────────────────────────────

function buildGraph(data: GraphData): Graph {
  const graph = new Graph();

  // Add nodes
  for (const n of data.nodes) {
    const color = n.community >= 0 && n.community < COMMUNITY_COLORS.length
      ? COMMUNITY_COLORS[n.community % COMMUNITY_COLORS.length]
      : CATEGORY_COLORS[n.category] || "#94a3b8";
    const size = Math.max(6, Math.min(20, 6 + (n.linkCount || 1) * 2));

    graph.addNode(n.key, {
      label: n.title,
      x: 0,
      y: 0,
      size,
      color,
      // Custom attributes for tooltip
      _category: n.category,
      _type: n.type,
      _linkCount: n.linkCount,
      _community: n.community,
      _pageId: n.id,
    });
  }

  // Add edges (only if both endpoints exist)
  for (const e of data.edges) {
    if (graph.hasNode(e.source) && graph.hasNode(e.target)) {
      try {
        graph.addEdge(e.source, e.target, {
          color: "rgba(148, 163, 184, 0.25)",
          size: 1,
        });
      } catch {
        // Skip duplicate edges
      }
    }
  }

  return graph;
}

// ── Inner: Load graph and run ForceAtlas2 layout ───────────────────────────

function GraphLoader({ graph }: { graph: Graph }) {
  const loadGraph = useLoadGraph();

  useEffect(() => {
    // Assign random positions first (required by FA2)
    random.assign(graph);
    // Run ForceAtlas2 synchronously
    const settings = forceAtlas2.inferSettings(graph);
    forceAtlas2.assign(graph, {
      iterations: 100,
      settings: {
        ...settings,
        gravity: 1,
        scalingRatio: 10,
        barnesHutOptimize: true,
      },
    });
    loadGraph(graph);
  }, [graph, loadGraph]);

  return null;
}

// ── Inner: Hover highlight + click handler ─────────────────────────────────

function GraphInteraction({
  onPageClick,
  onHoverChange,
}: {
  onPageClick?: (pageId: string) => void;
  onHoverChange: (key: string | null) => void;
}) {
  const registerEvents = useRegisterEvents();
  const sigma = useSigma();
  const setSettings = useSetSettings();
  const [hoveredNode, setHoveredNode] = useState<string | null>(null);

  useEffect(() => {
    registerEvents({
      enterNode: (e) => {
        setHoveredNode(e.node);
        onHoverChange(e.node);
      },
      leaveNode: () => {
        setHoveredNode(null);
        onHoverChange(null);
      },
      clickNode: (e) => {
        const nodeAttributes = sigma.getGraph().getNodeAttributes(e.node);
        const pageId = nodeAttributes._pageId as string | undefined;
        if (pageId) onPageClick?.(pageId);
      },
      clickStage: () => {},
    });
  }, [registerEvents, sigma, onPageClick, onHoverChange]);

  useEffect(() => {
    setSettings({
      nodeReducer: (node, data) => {
        if (!hoveredNode) return data;

        const graph = sigma.getGraph();
        if (node === hoveredNode) {
          return { ...data, highlighted: true, zIndex: 10 };
        }
        if (graph.neighbors(hoveredNode).includes(node)) {
          return { ...data, highlighted: true };
        }
        return { ...data, color: "#E2E2E2", zIndex: 0 };
      },
      edgeReducer: (edge, data) => {
        const graph = sigma.getGraph();
        if (!hoveredNode) return data;
        if (graph.extremities(edge).includes(hoveredNode)) {
          return { ...data, hidden: false, color: "rgba(148, 163, 184, 0.6)" };
        }
        return { ...data, hidden: true };
      },
    });
  }, [hoveredNode, setSettings, sigma]);

  return null;
}

// ── Inner: Tooltip for hovered node ────────────────────────────────────────

function HoverTooltip({ nodeKey }: { nodeKey: string | null }) {
  const sigma = useSigma();
  const { t } = useTranslation("common");

  if (!nodeKey) return null;

  const graph = sigma.getGraph();
  if (!graph.hasNode(nodeKey)) return null;

  const attrs = graph.getNodeAttributes(nodeKey);
  const displayColor = attrs.color as string;

  return (
    <div
      className="absolute pointer-events-none z-10 px-2.5 py-1.5 text-xs bg-[var(--surface-primary)] border border-[var(--border-primary)] rounded-lg shadow-lg max-w-48"
      style={{ top: 8, right: 8 }}
    >
      <div className="flex items-center gap-1.5 mb-0.5">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: displayColor }} />
        <p className="font-medium truncate">{attrs.label as string}</p>
      </div>
      <p className="text-[var(--text-tertiary)]">
        {attrs._category as string} · {attrs._linkCount as number} {t("links", "links")}
      </p>
    </div>
  );
}

// ── Main GraphView Component ───────────────────────────────────────────────

interface GraphViewProps {
  wikiUrl: (path: string) => string;
  onPageClick?: (pageId: string) => void;
}

export function GraphView({ wikiUrl, onPageClick }: GraphViewProps) {
  const { t } = useTranslation("common");
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [selectedInsight, setSelectedInsight] = useState<GraphInsight | null>(null);
  const [showInsights, setShowInsights] = useState(false);
  const [hoveredNodeKey, setHoveredNodeKey] = useState<string | null>(null);

  // Fetch graph data
  useEffect(() => {
    (async () => {
      setIsLoading(true);
      setError("");
      try {
        const data = await api.get<GraphData>(wikiUrl("/graph"));
        setGraphData(data);
      } catch (err) {
        setError(String(err));
      } finally {
        setIsLoading(false);
      }
    })();
  }, [wikiUrl]);

  // Build graphology graph from API data
  const graph = useMemo(() => {
    if (!graphData || graphData.nodes.length === 0) return null;
    return buildGraph(graphData);
  }, [graphData]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--text-secondary)]" />
        <span className="ml-2 text-sm text-[var(--text-secondary)]">
          {t("loadingGraph", "Loading graph...")}
        </span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <AlertCircle className="h-8 w-8 text-red-400" />
        <p className="text-sm text-red-400">{t("graphLoadError", "Failed to load graph")}</p>
      </div>
    );
  }

  if (!graphData || graphData.nodes.length === 0 || !graph) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <p className="text-sm text-[var(--text-tertiary)]">
          {t("noGraphData", "No pages to visualize. Create some wiki pages first.")}
        </p>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full overflow-hidden">
      {/* Sigma container with WebGL rendering */}
      <SigmaContainer
        style={{ height: "100%", width: "100%" }}
        settings={{
          allowInvalidContainer: true,
          defaultEdgeType: "arrow",
          labelRenderedSizeThreshold: 8,
          labelDensity: 0.07,
          labelColor: { color: "var(--text-primary)" },
          labelSize: 12,
          renderLabels: true,
          renderEdgeLabels: false,
          minCameraRatio: 0.1,
          maxCameraRatio: 10,
        }}
      >
        <GraphLoader graph={graph} />
        <GraphInteraction
          onPageClick={onPageClick}
          onHoverChange={setHoveredNodeKey}
        />

        {/* Tooltip overlay inside Sigma context to access graph data */}
        <HoverTooltip nodeKey={hoveredNodeKey} />
      </SigmaContainer>

      {/* Controls */}
      <div className="absolute bottom-4 right-4 flex flex-col gap-1 z-10">
        <ZoomInControl />
        <ZoomOutControl />
        <FitControl />
      </div>

      {/* Stats overlay */}
      <div className="absolute top-3 left-3 px-3 py-2 bg-[var(--surface-primary)]/90 border border-[var(--border-primary)] rounded-lg text-xs z-10">
        <p className="font-medium">
          {graphData.stats.total_nodes} pages · {graphData.stats.total_edges} links · {graphData.stats.total_communities} communities
        </p>
      </div>

      {/* Insights toggle */}
      {graphData.insights.length > 0 && (
        <div className="absolute top-3 right-3 z-10">
          <button
            onClick={() => setShowInsights(!showInsights)}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-lg transition-colors",
              showInsights
                ? "bg-[var(--brand-primary)] text-[var(--brand-primary-text)]"
                : "bg-[var(--surface-primary)] border border-[var(--border-primary)] hover:bg-[var(--surface-secondary)]",
            )}
          >
            <Lightbulb className="h-3.5 w-3.5" />
            {graphData.insights.length} {t("insights", "insights")}
          </button>
        </div>
      )}

      {/* Insights panel */}
      {showInsights && graphData.insights.length > 0 && (
        <div className="absolute top-11 right-3 z-10 w-72 max-h-80 overflow-y-auto bg-[var(--surface-primary)] border border-[var(--border-primary)] rounded-lg shadow-lg">
          <div className="p-2 border-b border-[var(--border-primary)] flex items-center justify-between">
            <span className="text-xs font-semibold">{t("graphInsights", "Graph Insights")}</span>
            <button onClick={() => setShowInsights(false)} className="p-0.5 hover:bg-[var(--surface-secondary)] rounded">
              <X className="h-3 w-3" />
            </button>
          </div>
          <div className="p-2 space-y-1.5">
            {graphData.insights.map((insight, i) => (
              <button
                key={i}
                onClick={() => setSelectedInsight(selectedInsight === insight ? null : insight)}
                className={cn(
                  "w-full text-left p-2 rounded text-[11px] transition-colors",
                  selectedInsight === insight
                    ? "bg-[var(--surface-secondary)]"
                    : "hover:bg-[var(--surface-secondary)]",
                )}
              >
                <div className="flex items-center gap-1.5">
                  <span>{insight.type === "surprising_connection" ? "🔗" : "🕳️"}</span>
                  <span className="font-medium truncate">{insight.title}</span>
                </div>
                {selectedInsight === insight && (
                  <p className="mt-1 text-[var(--text-tertiary)] leading-relaxed">
                    {insight.description}
                  </p>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="absolute bottom-4 left-3 px-3 py-2 bg-[var(--surface-primary)]/90 border border-[var(--border-primary)] rounded-lg text-[10px] z-10">
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {Object.entries(CATEGORY_COLORS).map(([cat, color]) => (
            <div key={cat} className="flex items-center gap-1">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: color }} />
              <span className="text-[var(--text-tertiary)]">{cat}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Helper: Zoom controls using Sigma's API ────────────────────────────────

function ZoomInControl() {
  const sigma = useSigma();
  return (
    <button
      onClick={() => {
        const camera = sigma.getCamera();
        camera.animatedZoom({ duration: 200 });
      }}
      className="p-1.5 bg-[var(--surface-primary)] border border-[var(--border-primary)] rounded hover:bg-[var(--surface-secondary)] transition-colors"
    >
      <ZoomIn className="h-4 w-4" />
    </button>
  );
}

function ZoomOutControl() {
  const sigma = useSigma();
  return (
    <button
      onClick={() => {
        const camera = sigma.getCamera();
        camera.animatedUnzoom({ duration: 200 });
      }}
      className="p-1.5 bg-[var(--surface-primary)] border border-[var(--border-primary)] rounded hover:bg-[var(--surface-secondary)] transition-colors"
    >
      <ZoomOut className="h-4 w-4" />
    </button>
  );
}

function FitControl() {
  const sigma = useSigma();
  return (
    <button
      onClick={() => {
        const camera = sigma.getCamera();
        camera.animatedReset({ duration: 300 });
      }}
      className="p-1.5 bg-[var(--surface-primary)] border border-[var(--border-primary)] rounded hover:bg-[var(--surface-secondary)] transition-colors"
    >
      <Maximize2 className="h-4 w-4" />
    </button>
  );
}
