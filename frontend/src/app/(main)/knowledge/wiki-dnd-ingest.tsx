"use client";

import { useState, useCallback, useRef, type DragEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Upload, FileText, X, Loader2, CheckCircle, AlertCircle } from "lucide-react";

import { cn } from "@/lib/utils";
import { apiErrorMessage } from "@/lib/api";

// ── Ingest result for a single file ──────────────────────────────────────

interface IngestResult {
  filename: string;
  status: "success" | "error";
  message: string;
}

// ── DndIngestOverlay ─────────────────────────────────────────────────────

interface DndIngestOverlayProps {
  /** The base wiki API URL builder (e.g., `/api/wiki`) */
  wikiUrl: (path: string) => string;
  /** Callback when ingest completes successfully */
  onIngestComplete?: () => void;
  children: ReactNode;
}

const SUPPORTED_EXTENSIONS = new Set([
  ".md", ".txt", ".json", ".csv", ".yaml", ".yml", ".toml",
]);

export function DndIngestOverlay({ wikiUrl, onIngestComplete, children }: DndIngestOverlayProps) {
  const { t } = useTranslation("common");
  const [isDragging, setIsDragging] = useState(false);
  const [isIngesting, setIsIngesting] = useState(false);
  const [results, setResults] = useState<IngestResult[]>([]);
  const dragCounterRef = useRef(0);

  const handleDragEnter = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current += 1;
    if (dragCounterRef.current === 1) {
      setIsDragging(true);
    }
  }, []);

  const handleDragLeave = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current -= 1;
    if (dragCounterRef.current === 0) {
      setIsDragging(false);
    }
  }, []);

  const handleDragOver = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(
    async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragCounterRef.current = 0;
      setIsDragging(false);

      const files = Array.from(e.dataTransfer.files);
      if (files.length === 0) return;

      // Filter supported files
      const supported = files.filter((f) => {
        const ext = f.name.substring(f.name.lastIndexOf(".")).toLowerCase();
        return SUPPORTED_EXTENSIONS.has(ext);
      });

      if (supported.length === 0) {
        setResults([{
          filename: files.map((f) => f.name).join(", "),
          status: "error",
          message: t("unsupportedFileType", "Unsupported file type. Supported: .md, .txt, .json, .csv, .yaml, .yml, .toml"),
        }]);
        return;
      }

      setIsIngesting(true);
      setResults([]);

      const ingestResults: IngestResult[] = [];

      for (const file of supported) {
        try {
          const formData = new FormData();
          formData.append("file", file);

          // Build the ingest-file URL with workspace param
          const url = wikiUrl("/ingest-file") + "&purpose=general";

          const response = await fetch(url, {
            method: "POST",
            body: formData,
          });

          if (!response.ok) {
            const errData = await response.json().catch(() => ({ detail: "Upload failed" }));
            throw new Error(errData.detail || `HTTP ${response.status}`);
          }

          ingestResults.push({
            filename: file.name,
            status: "success",
            message: t("ingestSuccess", "Ingested successfully"),
          });
        } catch (err) {
          ingestResults.push({
            filename: file.name,
            status: "error",
            message: apiErrorMessage(err, t("ingestFailed", "Ingest failed")),
          });
        }
      }

      setResults(ingestResults);
      setIsIngesting(false);

      // If any succeeded, refresh the page list
      if (ingestResults.some((r) => r.status === "success")) {
        onIngestComplete?.();
      }
    },
    [wikiUrl, onIngestComplete, t],
  );

  const clearResults = useCallback(() => {
    setResults([]);
  }, []);

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className="relative h-full"
    >
      {children}

      {/* Drag overlay */}
      {isDragging && (
        <div className="absolute inset-0 z-50 bg-[var(--brand-primary)]/10 border-2 border-dashed border-[var(--brand-primary)] rounded-lg flex flex-col items-center justify-center gap-3 backdrop-blur-sm">
          <Upload className="h-10 w-10 text-[var(--brand-primary)] animate-bounce" />
          <p className="text-sm font-medium text-[var(--brand-primary)]">
            {t("dropToIngest", "Drop files here to ingest into wiki")}
          </p>
          <p className="text-[10px] text-[var(--text-tertiary)]">
            .md, .txt, .json, .csv, .yaml, .yml, .toml
          </p>
        </div>
      )}

      {/* Ingest progress overlay */}
      {(isIngesting || results.length > 0) && (
        <div className="absolute bottom-4 right-4 z-50 w-80 bg-[var(--surface-primary)] border border-[var(--border-primary)] rounded-xl shadow-xl overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border-primary)]">
            <div className="flex items-center gap-2">
              {isIngesting ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--brand-primary)]" />
              ) : (
                <FileText className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
              )}
              <span className="text-xs font-medium">
                {isIngesting
                  ? t("ingesting", "Ingesting files...")
                  : t("ingestComplete", "Ingest complete")}
              </span>
            </div>
            {!isIngesting && (
              <button
                onClick={clearResults}
                className="text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <div className="max-h-40 overflow-y-auto p-2 space-y-1">
            {results.map((r, i) => (
              <div
                key={i}
                className={cn(
                  "flex items-start gap-2 px-2 py-1.5 rounded-md text-xs",
                  r.status === "success" ? "bg-green-500/10" : "bg-red-500/10",
                )}
              >
                {r.status === "success" ? (
                  <CheckCircle className="h-3.5 w-3.5 shrink-0 text-green-600 mt-0.5" />
                ) : (
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 text-red-500 mt-0.5" />
                )}
                <div className="min-w-0">
                  <p className="font-medium truncate">{r.filename}</p>
                  <p className="text-[var(--text-tertiary)] text-[10px]">{r.message}</p>
                </div>
              </div>
            ))}
            {isIngesting && (
              <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-[var(--text-tertiary)]">
                <Loader2 className="h-3 w-3 animate-spin" />
                <span>{t("processing", "Processing...")}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
