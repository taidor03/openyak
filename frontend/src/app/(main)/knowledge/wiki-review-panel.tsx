"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Shield,
  AlertTriangle,
  Info,
  Check,
  ExternalLink,
  RefreshCw,
  Loader2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { api, apiErrorMessage } from "@/lib/api";

interface ReviewItem {
  id: string;
  type: string;
  severity: "warning" | "info";
  title: string;
  description: string;
  affected_pages: string[];
  suggested_action: string;
  status: "open" | "resolved" | "skipped";
  created_at: string;
  resolved_at: string | null;
}

interface ReviewData {
  items: ReviewItem[];
  total: number;
  open: number;
  resolved: number;
  newly_added: number;
  warnings: number;
}

function SeverityIcon({ severity }: { severity: string }) {
  if (severity === "warning") {
    return <AlertTriangle className="h-3.5 w-3.5 text-amber-500 shrink-0" />;
  }
  return <Info className="h-3.5 w-3.5 text-blue-500 shrink-0" />;
}

function actionLabel(action: string, t: (key: string, fb: string) => string): string {
  switch (action) {
    case "create-page": return t("createMissingPage", "Create missing page");
    case "add-link": return t("addLinks", "Add links");
    case "update-content": return t("updateContent", "Update content");
    case "review-manually": return t("reviewManually", "Review manually");
    default: return action;
  }
}

interface WikiReviewPanelProps {
  wikiUrl: (path: string) => string;
  onPageClick?: (pageId: string) => void;
  onRefresh?: () => void;
}

export function WikiReviewPanel({ wikiUrl, onPageClick, onRefresh }: WikiReviewPanelProps) {
  const { t } = useTranslation("common");
  const [data, setData] = useState<ReviewData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [resolvingIds, setResolvingIds] = useState<Set<string>>(new Set());

  const fetchReview = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await api.get<ReviewData>(wikiUrl("/review"));
      setData(result);
    } catch {
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, [wikiUrl]);

  useEffect(() => { fetchReview(); }, [fetchReview]);

  const handleResolve = useCallback(async (itemId: string) => {
    setResolvingIds((prev) => new Set(prev).add(itemId));
    try {
      await api.post(wikiUrl(`/review/${itemId}/resolve`));
      await fetchReview();
      onRefresh?.();
    } catch (err) {
      console.error(apiErrorMessage(err, "Failed to resolve"));
    } finally {
      setResolvingIds((prev) => { const n = new Set(prev); n.delete(itemId); return n; });
    }
  }, [wikiUrl, fetchReview, onRefresh]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--text-tertiary)]" />
      </div>
    );
  }

  if (!data || data.items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-[var(--text-secondary)]">
        <Shield className="h-10 w-10 text-green-500" />
        <p className="text-sm font-medium">{t("wikiReviewClean", "Wiki is in good shape!")}</p>
        <p className="text-[10px] text-[var(--text-tertiary)]">{t("noReviewItems", "No review items found")}</p>
      </div>
    );
  }

  const openItems = data.items.filter((i) => i.status === "open");
  const resolvedItems = data.items.filter((i) => i.status !== "open");

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-primary)]">
        <div className="flex items-center gap-2">
          <Shield className="h-4 w-4 text-[var(--text-secondary)]" />
          <span className="text-sm font-medium">{t("reviewItems", "Review Items")}</span>
          {data.open > 0 && (
            <span className={cn(
              "px-1.5 py-0.5 text-[10px] font-bold rounded-full",
              data.warnings > 0 ? "bg-amber-500/20 text-amber-600" : "bg-blue-500/20 text-blue-600",
            )}>{data.open}</span>
          )}
        </div>
        <button onClick={fetchReview} className="p-1.5 rounded-md hover:bg-[var(--surface-secondary)] transition-colors" title={t("refresh", "Refresh")}>
          <RefreshCw className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
        </button>
      </div>

      <div className="flex items-center gap-4 px-4 py-2 border-b border-[var(--border-primary)] text-[10px] text-[var(--text-tertiary)]">
        <span>{t("open", "Open")}: {data.open}</span>
        <span>{t("warnings", "Warnings")}: {data.warnings}</span>
        <span>{t("resolved", "Resolved")}: {data.resolved}</span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {openItems.length > 0 && (
          <div className="p-2">
            {openItems.map((item) => (
              <div key={item.id} className={cn(
                "mb-1 rounded-lg border border-[var(--border-primary)] overflow-hidden",
                item.severity === "warning" && "border-amber-500/30",
              )}>
                <button
                  onClick={() => setExpandedId(expandedId === item.id ? null : item.id)}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-[var(--surface-secondary)] transition-colors"
                >
                  {expandedId === item.id ? <ChevronDown className="h-3 w-3 shrink-0 text-[var(--text-tertiary)]" /> : <ChevronRight className="h-3 w-3 shrink-0 text-[var(--text-tertiary)]" />}
                  <SeverityIcon severity={item.severity} />
                  <span className="flex-1 font-medium truncate">{item.title}</span>
                </button>
                {expandedId === item.id && (
                  <div className="px-3 pb-2 space-y-2 border-t border-[var(--border-primary)]">
                    <p className="text-[11px] text-[var(--text-secondary)] pt-2">{item.description}</p>
                    {item.affected_pages.length > 0 && (
                      <div className="space-y-1">
                        <p className="text-[10px] font-medium text-[var(--text-tertiary)] uppercase">{t("affectedPages", "Affected Pages")}</p>
                        {item.affected_pages.map((pid) => (
                          <button key={pid} onClick={() => onPageClick?.(pid)} className="flex items-center gap-1 text-[11px] text-[var(--brand-primary)] hover:underline">
                            <ExternalLink className="h-3 w-3" />{pid}
                          </button>
                        ))}
                      </div>
                    )}
                    <div className="flex items-center gap-2 pt-1">
                      <span className="text-[10px] text-[var(--text-tertiary)]">{t("suggestedAction", "Suggested")}: {actionLabel(item.suggested_action, t)}</span>
                    </div>
                    <div className="flex items-center gap-1.5 pt-1">
                      <button
                        onClick={() => handleResolve(item.id)}
                        disabled={resolvingIds.has(item.id)}
                        className={cn(
                          "flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium rounded-md transition-colors",
                          "bg-[var(--brand-primary)] text-[var(--brand-primary-text)] hover:opacity-90",
                          resolvingIds.has(item.id) && "opacity-50 cursor-not-allowed",
                        )}
                      >
                        {resolvingIds.has(item.id) ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                        {t("markResolved", "Resolve")}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
        {resolvedItems.length > 0 && (
          <div className="px-3 py-2 border-t border-[var(--border-primary)]">
            <p className="text-[10px] font-medium text-[var(--text-tertiary)] uppercase mb-1">{t("resolvedItems", "Resolved")} ({resolvedItems.length})</p>
            {resolvedItems.slice(0, 5).map((item) => (
              <div key={item.id} className="flex items-center gap-2 px-2 py-1 text-[10px] text-[var(--text-tertiary)]">
                <Check className="h-3 w-3 text-green-500" />
                <span className="truncate line-through">{item.title}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
