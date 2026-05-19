"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
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

// ── Force-directed layout (simple simulation) ──────────────────────────────

interface SimNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  title: string;
  category: string;
  type: string;
  linkCount: number;
  community: number;
  key: string;
  radius: number;
  color: string;
}

interface SimEdge {
  source: string;
  target: string;
}

function runForceLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  width: number,
  height: number,
  iterations: number = 120,
): SimNode[] {
  if (nodes.length === 0) return [];

  const nodeMap = new Map<string, SimNode>();

  // Initialize nodes in a circle
  nodes.forEach((n, i) => {
    const angle = (2 * Math.PI * i) / nodes.length;
    const r = Math.min(width, height) * 0.35;
    const linkCount = n.linkCount || 1;
    const radius = Math.max(4, Math.min(16, 4 + linkCount * 1.5));
    const color = n.community >= 0 && n.community < COMMUNITY_COLORS.length
      ? COMMUNITY_COLORS[n.community % COMMUNITY_COLORS.length]
      : CATEGORY_COLORS[n.category] || "#94a3b8";

    nodeMap.set(n.key, {
      id: n.id,
      key: n.key,
      x: width / 2 + r * Math.cos(angle) + (Math.random() - 0.5) * 50,
      y: height / 2 + r * Math.sin(angle) + (Math.random() - 0.5) * 50,
      vx: 0,
      vy: 0,
      title: n.title,
      category: n.category,
      type: n.type,
      linkCount: n.linkCount,
      community: n.community,
      radius,
      color,
    });
  });

  const simEdges: SimEdge[] = edges
    .filter((e) => nodeMap.has(e.source) && nodeMap.has(e.target))
    .map((e) => ({ source: e.source, target: e.target }));

  // Simple force simulation
  const repulsionStrength = 2000;
  const attractionStrength = 0.005;
  const centerStrength = 0.01;
  const damping = 0.9;

  for (let iter = 0; iter < iterations; iter++) {
    const alpha = 1 - iter / iterations;

    // Repulsion between all pairs
    const nodeList = Array.from(nodeMap.values());
    for (let i = 0; i < nodeList.length; i++) {
      for (let j = i + 1; j < nodeList.length; j++) {
        const a = nodeList[i];
        const b = nodeList[j];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = (repulsionStrength * alpha) / (dist * dist);
        const fx = (dx / dist) * force;
        const fy = (dy / dist) * force;
        a.vx -= fx;
        a.vy -= fy;
        b.vx += fx;
        b.vy += fy;
      }
    }

    // Attraction along edges
    for (const edge of simEdges) {
      const a = nodeMap.get(edge.source)!;
      const b = nodeMap.get(edge.target)!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = dist * attractionStrength * alpha;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }

    // Center gravity
    for (const node of nodeList) {
      node.vx += (width / 2 - node.x) * centerStrength * alpha;
      node.vy += (height / 2 - node.y) * centerStrength * alpha;
    }

    // Apply velocity
    for (const node of nodeList) {
      node.vx *= damping;
      node.vy *= damping;
      node.x += node.vx;
      node.y += node.vy;
    }
  }

  return Array.from(nodeMap.values());
}

// ── Graph View Component ───────────────────────────────────────────────────

interface GraphViewProps {
  wikiUrl: (path: string) => string;
  onPageClick?: (pageId: string) => void;
}

export function GraphView({ wikiUrl, onPageClick }: GraphViewProps) {
  const { t } = useTranslation("common");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>("");
  const [simNodes, setSimNodes] = useState<SimNode[]>([]);
  const [hoveredNode, setHoveredNode] = useState<SimNode | null>(null);
  const [selectedInsight, setSelectedInsight] = useState<GraphInsight | null>(null);
  const [showInsights, setShowInsights] = useState(false);

  // Pan / zoom state
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const isDragging = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const lastTransform = useRef({ x: 0, y: 0 });

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

  // Run layout when data changes
  useEffect(() => {
    if (!graphData || graphData.nodes.length === 0) return;

    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const w = rect.width || 800;
    const h = rect.height || 600;

    const nodes = runForceLayout(graphData.nodes, graphData.edges, w, h, 150);
    setSimNodes(nodes);

    // Center the graph
    if (nodes.length > 0) {
      const avgX = nodes.reduce((s, n) => s + n.x, 0) / nodes.length;
      const avgY = nodes.reduce((s, n) => s + n.y, 0) / nodes.length;
      setTransform({
        x: w / 2 - avgX,
        y: h / 2 - avgY,
        scale: 1,
      });
    }
  }, [graphData]);

  // Draw canvas
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || simNodes.length === 0) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    canvas.width = rect.width * window.devicePixelRatio;
    canvas.height = rect.height * window.devicePixelRatio;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

    const w = rect.width;
    const h = rect.height;

    // Clear
    ctx.fillStyle = "transparent";
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(transform.x, transform.y);
    ctx.scale(transform.scale, transform.scale);

    // Draw edges
    if (graphData) {
      const nodeByKey = new Map(simNodes.map((n) => [n.key, n]));
      ctx.strokeStyle = "rgba(148, 163, 184, 0.15)";
      ctx.lineWidth = 1 / transform.scale;
      for (const edge of graphData.edges) {
        const src = nodeByKey.get(edge.source);
        const tgt = nodeByKey.get(edge.target);
        if (!src || !tgt) continue;
        ctx.beginPath();
        ctx.moveTo(src.x, src.y);
        ctx.lineTo(tgt.x, tgt.y);
        ctx.stroke();
      }
    }

    // Draw nodes
    for (const node of simNodes) {
      const isHovered = hoveredNode?.key === node.key;
      const r = isHovered ? node.radius * 1.5 : node.radius;

      // Glow
      if (isHovered) {
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 4 / transform.scale, 0, Math.PI * 2);
        ctx.fillStyle = node.color + "33";
        ctx.fill();
      }

      // Node circle
      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, Math.PI * 2);
      ctx.fillStyle = node.color;
      ctx.fill();
      ctx.strokeStyle = isHovered ? "#fff" : "rgba(255,255,255,0.3)";
      ctx.lineWidth = (isHovered ? 2 : 1) / transform.scale;
      ctx.stroke();
    }

    ctx.restore();
  }, [simNodes, transform, hoveredNode, graphData]);

  // ── Mouse handlers ──────────────────────────────────────────────
  const findNodeAt = useCallback(
    (clientX: number, clientY: number): SimNode | null => {
      const rect = containerRef.current?.getBoundingClientRect();
      if (!rect) return null;
      const mx = (clientX - rect.left - transform.x) / transform.scale;
      const my = (clientY - rect.top - transform.y) / transform.scale;

      for (let i = simNodes.length - 1; i >= 0; i--) {
        const n = simNodes[i];
        const dx = mx - n.x;
        const dy = my - n.y;
        if (dx * dx + dy * dy < (n.radius + 4) * (n.radius + 4)) {
          return n;
        }
      }
      return null;
    },
    [simNodes, transform],
  );

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      isDragging.current = true;
      dragStart.current = { x: e.clientX, y: e.clientY };
      lastTransform.current = { x: transform.x, y: transform.y };
    },
    [transform],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (isDragging.current) {
        setTransform((prev) => ({
          ...prev,
          x: lastTransform.current.x + (e.clientX - dragStart.current.x),
          y: lastTransform.current.y + (e.clientY - dragStart.current.y),
        }));
      } else {
        const node = findNodeAt(e.clientX, e.clientY);
        setHoveredNode(node);
        if (canvasRef.current) {
          canvasRef.current.style.cursor = node ? "pointer" : "grab";
        }
      }
    },
    [findNodeAt],
  );

  const handleMouseUp = useCallback(() => {
    isDragging.current = false;
  }, []);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      const node = findNodeAt(e.clientX, e.clientY);
      if (node) {
        onPageClick?.(node.id);
      }
    },
    [findNodeAt, onPageClick],
  );

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setTransform((prev) => {
      const newScale = Math.max(0.1, Math.min(5, prev.scale * delta));
      return { ...prev, scale: newScale };
    });
  }, []);

  const handleZoomIn = useCallback(() => {
    setTransform((prev) => ({ ...prev, scale: Math.min(5, prev.scale * 1.2) }));
  }, []);

  const handleZoomOut = useCallback(() => {
    setTransform((prev) => ({ ...prev, scale: Math.max(0.1, prev.scale * 0.8) }));
  }, []);

  const handleFit = useCallback(() => {
    if (simNodes.length === 0) return;
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();

    const minX = Math.min(...simNodes.map((n) => n.x));
    const maxX = Math.max(...simNodes.map((n) => n.x));
    const minY = Math.min(...simNodes.map((n) => n.y));
    const maxY = Math.max(...simNodes.map((n) => n.y));

    const graphW = maxX - minX + 100;
    const graphH = maxY - minY + 100;
    const scale = Math.min(rect.width / graphW, rect.height / graphH, 2);
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;

    setTransform({
      x: rect.width / 2 - cx * scale,
      y: rect.height / 2 - cy * scale,
      scale,
    });
  }, [simNodes]);

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

  if (!graphData || graphData.nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3">
        <p className="text-sm text-[var(--text-tertiary)]">
          {t("noGraphData", "No pages to visualize. Create some wiki pages first.")}
        </p>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden">
      <canvas
        ref={canvasRef}
        className="absolute inset-0"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onClick={handleClick}
        onWheel={handleWheel}
      />

      {/* Tooltip */}
      {hoveredNode && (
        <div
          className="absolute pointer-events-none z-10 px-2.5 py-1.5 text-xs bg-[var(--surface-primary)] border border-[var(--border-primary)] rounded-lg shadow-lg max-w-48"
          style={{
            left: Math.min(
              (hoveredNode.x * transform.scale + transform.x + 15),
              (containerRef.current?.clientWidth || 400) - 200,
            ),
            top: hoveredNode.y * transform.scale + transform.y - 10,
          }}
        >
          <p className="font-medium truncate">{hoveredNode.title}</p>
          <p className="text-[var(--text-tertiary)]">
            {hoveredNode.category} · {hoveredNode.linkCount} links
          </p>
        </div>
      )}

      {/* Controls */}
      <div className="absolute bottom-4 right-4 flex flex-col gap-1 z-10">
        <button
          onClick={handleZoomIn}
          className="p-1.5 bg-[var(--surface-primary)] border border-[var(--border-primary)] rounded hover:bg-[var(--surface-secondary)] transition-colors"
        >
          <ZoomIn className="h-4 w-4" />
        </button>
        <button
          onClick={handleZoomOut}
          className="p-1.5 bg-[var(--surface-primary)] border border-[var(--border-primary)] rounded hover:bg-[var(--surface-secondary)] transition-colors"
        >
          <ZoomOut className="h-4 w-4" />
        </button>
        <button
          onClick={handleFit}
          className="p-1.5 bg-[var(--surface-primary)] border border-[var(--border-primary)] rounded hover:bg-[var(--surface-secondary)] transition-colors"
        >
          <Maximize2 className="h-4 w-4" />
        </button>
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
