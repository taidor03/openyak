"use client";

import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  ListOrdered,
  Play,
  RotateCcw,
  RefreshCw,
  Loader2,
  CheckCircle,
  AlertCircle,
  Clock,
  XCircle,
  ChevronDown,
  ChevronRight,
  FileText,
  PackageOpen,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { api, apiErrorMessage } from "@/lib/api";

// ── Types ──────────────────────────────────────────────────────────────────

interface IngestJob {
  id: string;
  source_name: string;
  purpose: string;
  status: "pending" | "processing" | "done" | "failed";
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
  error: string | null;
  retries: number;
}

interface QueueData {
  jobs: IngestJob[];
  stats: {
    pending: number;
    processing: number;
    done: number;
    failed: number;
  };
}

// ── Status icon per job state ──────────────────────────────────────────────

function StatusIcon({ status }: { status: string }) {
  switch (status) {
    case "pending":
      return <Clock className="h-3.5 w-3.5 text-gray-400 shrink-0" />;
    case "processing":
      return <Loader2 className="h-3.5 w-3.5 text-amber-500 shrink-0 animate-spin" />;
    case "done":
      return <CheckCircle className="h-3.5 w-3.5 text-green-500 shrink-0" />;
    case "failed":
      return <XCircle className="h-3.5 w-3.5 text-red-500 shrink-0" />;
    default:
      return <Clock className="h-3.5 w-3.5 text-gray-400 shrink-0" />;
  }
}

function statusLabel(status: string, t: (key: string, fb: string) => string): string {
  switch (status) {
    case "pending": return t("queueStatusPending", "Pending");
    case "processing": return t("queueStatusProcessing", "Processing");
    case "done": return t("queueStatusDone", "Done");
    case "failed": return t("queueStatusFailed", "Failed");
    default: return status;
  }
}

// ── Relative time helper ───────────────────────────────────────────────────

function relativeTime(isoStr: string): string {
  try {
    const diff = Date.now() - new Date(isoStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  } catch {
    return isoStr;
  }
}

// ── Wiki Queue Panel ──────────────────────────────────────────────────────

interface WikiQueuePanelProps {
  wikiUrl: (path: string) => string;
  onRefresh?: () => void;
}

export function WikiQueuePanel({ wikiUrl, onRefresh }: WikiQueuePanelProps) {
  const { t } = useTranslation("common");
  const [data, setData] = useState<QueueData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [retryingIds, setRetryingIds] = useState<Set<string>>(new Set());

  // Fetch queue data
  const fetchQueue = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await api.get<QueueData>(wikiUrl("/ingest-queue"));
      setData(result);
    } catch {
      setData(null);
    } finally {
      setIsLoading(false);
    }
  }, [wikiUrl]);

  useEffect(() => { fetchQueue(); }, [fetchQueue]);

  // Auto-refresh every 10s if there are active jobs
  useEffect(() => {
    if (!data) return;
    const hasActive = (data.stats.pending + data.stats.processing) > 0;
    if (!hasActive) return;

    const timer = setInterval(fetchQueue, 10000);
    return () => clearInterval(timer);
  }, [data, fetchQueue]);

  // Process all pending jobs
  const handleProcessAll = useCallback(async () => {
    setIsProcessing(true);
    try {
      await api.post(wikiUrl("/ingest-queue/process"));
      await fetchQueue();
      onRefresh?.();
    } catch (err) {
      console.error(apiErrorMessage(err, "Failed to process queue"));
    } finally {
      setIsProcessing(false);
    }
  }, [wikiUrl, fetchQueue, onRefresh]);

  // Retry a failed job
  const handleRetry = useCallback(async (jobId: string) => {
    setRetryingIds((prev) => new Set(prev).add(jobId));
    try {
      await api.post(wikiUrl(`/ingest-queue/${jobId}/retry`));
      await fetchQueue();
      onRefresh?.();
    } catch (err) {
      console.error(apiErrorMessage(err, "Failed to retry job"));
    } finally {
      setRetryingIds((prev) => { const n = new Set(prev); n.delete(jobId); return n; });
    }
  }, [wikiUrl, fetchQueue, onRefresh]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-5 w-5 animate-spin text-[var(--text-tertiary)]" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-[var(--text-secondary)]">
        <AlertCircle className="h-10 w-10 text-[var(--text-tertiary)]" />
        <p className="text-sm">{t("queueLoadError", "Failed to load queue")}</p>
      </div>
    );
  }

  const pendingJobs = data.jobs.filter((j) => j.status === "pending");
  const processingJobs = data.jobs.filter((j) => j.status === "processing");
  const failedJobs = data.jobs.filter((j) => j.status === "failed");
  const doneJobs = data.jobs.filter((j) => j.status === "done");
  const activeJobs = [...processingJobs, ...pendingJobs, ...failedJobs];

  const totalPending = data.stats.pending + data.stats.processing + data.stats.failed;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border-primary)]">
        <div className="flex items-center gap-2">
          <ListOrdered className="h-4 w-4 text-[var(--text-secondary)]" />
          <span className="text-sm font-medium">{t("ingestQueue", "Ingest Queue")}</span>
          {totalPending > 0 && (
            <span className={cn(
              "px-1.5 py-0.5 text-[10px] font-bold rounded-full",
              data.stats.failed > 0 ? "bg-red-500/20 text-red-600" : "bg-amber-500/20 text-amber-600",
            )}>{totalPending}</span>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          {pendingJobs.length > 0 && (
            <button
              onClick={handleProcessAll}
              disabled={isProcessing}
              className={cn(
                "flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium rounded-md transition-colors",
                "bg-[var(--brand-primary)] text-[var(--brand-primary-text)] hover:opacity-90",
                isProcessing && "opacity-50 cursor-not-allowed",
              )}
            >
              {isProcessing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
              {t("processAll", "Process All")}
            </button>
          )}
          <button
            onClick={fetchQueue}
            className="p-1.5 rounded-md hover:bg-[var(--surface-secondary)] transition-colors"
            title={t("refresh", "Refresh")}
          >
            <RefreshCw className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
          </button>
        </div>
      </div>

      {/* Stats bar */}
      <div className="flex items-center gap-4 px-4 py-2 border-b border-[var(--border-primary)] text-[10px] text-[var(--text-tertiary)]">
        <span className="flex items-center gap-1"><Clock className="h-2.5 w-2.5" />{t("queueStatusPending", "Pending")}: {data.stats.pending}</span>
        <span className="flex items-center gap-1"><Loader2 className="h-2.5 w-2.5" />{t("queueStatusProcessing", "Processing")}: {data.stats.processing}</span>
        <span className="flex items-center gap-1"><CheckCircle className="h-2.5 w-2.5 text-green-500" />{t("queueStatusDone", "Done")}: {data.stats.done}</span>
        <span className="flex items-center gap-1"><XCircle className="h-2.5 w-2.5 text-red-500" />{t("queueStatusFailed", "Failed")}: {data.stats.failed}</span>
      </div>

      {/* Job list */}
      <div className="flex-1 overflow-y-auto">
        {data.jobs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-[var(--text-secondary)]">
            <PackageOpen className="h-10 w-10 text-[var(--text-tertiary)]" />
            <p className="text-sm font-medium">{t("queueEmpty", "Queue is empty")}</p>
            <p className="text-[10px] text-[var(--text-tertiary)]">{t("queueEmptyHint", "Drag files onto the wiki or use the ingest API to add jobs")}</p>
          </div>
        ) : (
          <div className="p-2 space-y-1">
            {/* Active jobs first */}
            {activeJobs.length > 0 && (
              <>
                <p className="px-2 py-1 text-[10px] font-semibold text-[var(--text-tertiary)] uppercase">
                  {t("activeJobs", "Active")} ({activeJobs.length})
                </p>
                {activeJobs.map((job) => (
                  <div
                    key={job.id}
                    className={cn(
                      "rounded-lg border border-[var(--border-primary)] overflow-hidden",
                      job.status === "failed" && "border-red-500/30",
                      job.status === "processing" && "border-amber-500/30",
                    )}
                  >
                    <button
                      onClick={() => setExpandedId(expandedId === job.id ? null : job.id)}
                      className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left hover:bg-[var(--surface-secondary)] transition-colors"
                    >
                      {expandedId === job.id ? (
                        <ChevronDown className="h-3 w-3 shrink-0 text-[var(--text-tertiary)]" />
                      ) : (
                        <ChevronRight className="h-3 w-3 shrink-0 text-[var(--text-tertiary)]" />
                      )}
                      <StatusIcon status={job.status} />
                      <FileText className="h-3 w-3 shrink-0 text-[var(--text-tertiary)]" />
                      <span className="flex-1 font-medium truncate">{job.source_name}</span>
                      <span className="text-[10px] text-[var(--text-tertiary)] shrink-0">
                        {relativeTime(job.created_at)}
                      </span>
                    </button>
                    {expandedId === job.id && (
                      <div className="px-3 pb-2 space-y-2 border-t border-[var(--border-primary)]">
                        <div className="pt-2 space-y-1 text-[11px]">
                          <div className="flex items-center gap-2">
                            <span className="text-[var(--text-tertiary)] min-w-[70px]">ID</span>
                            <span className="text-[var(--text-secondary)] font-mono text-[10px]">{job.id}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[var(--text-tertiary)] min-w-[70px]">{t("status", "Status")}</span>
                            <span className={cn(
                              "px-1.5 py-0.5 rounded text-[10px] font-medium",
                              job.status === "pending" && "bg-gray-500/10 text-gray-500",
                              job.status === "processing" && "bg-amber-500/10 text-amber-600",
                              job.status === "failed" && "bg-red-500/10 text-red-600",
                            )}>{statusLabel(job.status, t)}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="text-[var(--text-tertiary)] min-w-[70px]">{t("purpose", "Purpose")}</span>
                            <span className="text-[var(--text-secondary)]">{job.purpose}</span>
                          </div>
                          {job.retries > 0 && (
                            <div className="flex items-center gap-2">
                              <span className="text-[var(--text-tertiary)] min-w-[70px]">{t("retries", "Retries")}</span>
                              <span className="text-amber-600">{job.retries}</span>
                            </div>
                          )}
                          {job.error && (
                            <div className="mt-1 p-2 bg-red-500/5 rounded text-[10px] text-red-600 font-mono break-all">
                              {job.error}
                            </div>
                          )}
                        </div>
                        {job.status === "failed" && (
                          <div className="flex items-center gap-1.5 pt-1">
                            <button
                              onClick={() => handleRetry(job.id)}
                              disabled={retryingIds.has(job.id)}
                              className={cn(
                                "flex items-center gap-1 px-2.5 py-1 text-[10px] font-medium rounded-md transition-colors",
                                "bg-[var(--brand-primary)] text-[var(--brand-primary-text)] hover:opacity-90",
                                retryingIds.has(job.id) && "opacity-50 cursor-not-allowed",
                              )}
                            >
                              {retryingIds.has(job.id) ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
                              {t("retry", "Retry")}
                            </button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </>
            )}

            {/* Completed jobs */}
            {doneJobs.length > 0 && (
              <>
                <div className="px-2 pt-2 pb-1 border-t border-[var(--border-primary)]">
                  <p className="text-[10px] font-semibold text-[var(--text-tertiary)] uppercase">
                    {t("completedJobs", "Completed")} ({doneJobs.length})
                  </p>
                </div>
                {doneJobs.slice(0, 10).map((job) => (
                  <div
                    key={job.id}
                    className="flex items-center gap-2 px-3 py-1.5 text-xs rounded-md hover:bg-[var(--surface-secondary)] transition-colors"
                  >
                    <CheckCircle className="h-3 w-3 shrink-0 text-green-500" />
                    <FileText className="h-3 w-3 shrink-0 text-[var(--text-tertiary)]" />
                    <span className="flex-1 truncate text-[var(--text-tertiary)]">{job.source_name}</span>
                    <span className="text-[10px] text-[var(--text-tertiary)] shrink-0">
                      {job.finished_at ? relativeTime(job.finished_at) : ""}
                    </span>
                  </div>
                ))}
                {doneJobs.length > 10 && (
                  <p className="px-3 py-1 text-[10px] text-[var(--text-tertiary)] text-center">
                    +{doneJobs.length - 10} {t("moreJobs", "more")}
                  </p>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
