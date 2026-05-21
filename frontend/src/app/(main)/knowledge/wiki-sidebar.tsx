"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  Search,
  FileText,
  FolderOpen,
  Plus,
  Loader2,
  Globe,
  X,
  ChevronDown,
  Check,
  Folder,
  Network,
  List,
  Shield,
  Zap,
  ListOrdered,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { cn, directoryLabelOf, normalizeDirectory } from "@/lib/utils";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { queryKeys } from "@/lib/constants";
import type { SessionResponse } from "@/types/session";
import {
  type WikiTarget,
  type WikiStatus,
  type WikiPage,
  type SearchResult,
  CATEGORIES,
  CATEGORY_ICONS,
  CATEGORY_I18N_KEYS,
  shortenPath,
} from "./wiki-types";

// ── Project Directory Selector ─────────────────────────────────────────────

interface ProjectOption {
  directory: string;
  label: string;
}

function useProjectDirectories(): ProjectOption[] {
  const queryClient = useQueryClient();
  const activeWorkspacePath = useWorkspaceStore((s) => s.activeWorkspacePath);

  return useMemo(() => {
    const dirs = new Map<string, string>();

    if (activeWorkspacePath) {
      const norm = normalizeDirectory(activeWorkspacePath);
      dirs.set(norm, directoryLabelOf(norm));
    }

    try {
      const sessionsData = queryClient.getQueryData<unknown>(queryKeys.sessions.all);
      if (sessionsData && typeof sessionsData === "object" && sessionsData !== null) {
        const pages = (sessionsData as { pages?: unknown[] }).pages;
        if (Array.isArray(pages)) {
          for (const page of pages) {
            if (Array.isArray(page)) {
              for (const session of page as SessionResponse[]) {
                if (session.directory && session.directory !== ".") {
                  const norm = normalizeDirectory(session.directory);
                  if (!dirs.has(norm)) {
                    dirs.set(norm, directoryLabelOf(norm));
                  }
                }
              }
            }
          }
        }
      }
    } catch {
      // Cache not available yet
    }

    return Array.from(dirs.entries())
      .map(([directory, label]) => ({ directory, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [queryClient, activeWorkspacePath]);
}

// ── Wiki Sidebar ──────────────────────────────────────────────────────────

export type SearchMode = "keyword" | "semantic" | "hybrid";

interface WikiSidebarProps {
  target: WikiTarget;
  status: WikiStatus | null;
  selectedCategory: string | null;
  selectedPageId: string | null;
  searchQuery: string;
  searchResults: SearchResult[];
  isSearching: boolean;
  pages: WikiPage[];
  viewMode: "list" | "graph" | "review" | "queue";
  searchMode: SearchMode;
  queuePendingCount?: number;
  onTargetChange: (target: WikiTarget) => void;
  onCategoryChange: (category: string | null) => void;
  onSearchQueryChange: (query: string) => void;
  onClearSearch: () => void;
  onSelectPage: (pageId: string) => void;
  onNewPage: () => void;
  onViewModeChange: (mode: "list" | "graph" | "review" | "queue") => void;
  onSearchModeChange: (mode: SearchMode) => void;
}

export function WikiSidebar({
  target,
  status,
  selectedCategory,
  selectedPageId,
  searchQuery,
  searchResults,
  isSearching,
  pages,
  viewMode,
  searchMode,
  queuePendingCount = 0,
  onTargetChange,
  onCategoryChange,
  onSearchQueryChange,
  onClearSearch,
  onSelectPage,
  onNewPage,
  onViewModeChange,
  onSearchModeChange,
}: WikiSidebarProps) {
  const { t } = useTranslation("common");
  const projectDirs = useProjectDirectories();
  const [selectorOpen, setSelectorOpen] = useState(false);
  const selectorRef = useRef<HTMLDivElement>(null);

  // Close selector on outside click
  useEffect(() => {
    if (!selectorOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (selectorRef.current && !selectorRef.current.contains(e.target as Node)) {
        setSelectorOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [selectorOpen]);

  const categoryName = useCallback(
    (cat: string) => {
      const key = CATEGORY_I18N_KEYS[cat];
      return key ? t(key, cat) : cat;
    },
    [t],
  );

  const currentLabel = target === null
    ? t("wikiScopeGlobal")
    : directoryLabelOf(target);
  const currentIcon = target === null
    ? <Globe className="h-3.5 w-3.5 shrink-0" />
    : <Folder className="h-3.5 w-3.5 shrink-0" />;

  return (
    <div className="w-64 border-r border-[var(--border-primary)] flex flex-col overflow-hidden">
      {/* Wiki target selector */}
      <div ref={selectorRef} className="relative border-b border-[var(--border-primary)]">
        <button
          onClick={() => setSelectorOpen(!selectorOpen)}
          className={cn(
            "w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors",
            "hover:bg-[var(--surface-secondary)]",
            selectorOpen && "bg-[var(--surface-secondary)]",
          )}
        >
          {currentIcon}
          <div className="flex-1 text-left min-w-0">
            <p className="font-medium truncate leading-tight">{currentLabel}</p>
            <p className="text-[10px] text-[var(--text-tertiary)] truncate leading-tight mt-0.5">
              {target === null
                ? shortenPath(status?.wiki_root || "~/.xflow/wiki")
                : shortenPath(target) + "/.wiki"}
            </p>
          </div>
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)] transition-transform",
              selectorOpen && "rotate-180",
            )}
          />
        </button>

        {/* Dropdown */}
        {selectorOpen && (
          <div className="absolute left-0 right-0 top-full z-20 bg-[var(--surface-primary)] border border-[var(--border-primary)] rounded-b-lg shadow-lg max-h-72 overflow-y-auto">
            {/* Global wiki */}
            <button
              onClick={() => {
                onTargetChange(null);
                setSelectorOpen(false);
              }}
              className={cn(
                "w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors hover:bg-[var(--surface-secondary)]",
                target === null && "bg-[var(--surface-secondary)]",
              )}
            >
              <Globe className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" />
              <span className="flex-1 text-left truncate font-medium">
                {t("wikiScopeGlobal")}
              </span>
              <span className="text-[10px] text-[var(--text-tertiary)] truncate max-w-24">
                {shortenPath(status?.wiki_root || "~/.xflow/wiki")}
              </span>
              {target === null && <Check className="h-3 w-3 shrink-0 text-[var(--brand-primary)]" />}
            </button>

            {/* Project wikis */}
            {projectDirs.length > 0 && (
              <>
                <div className="px-3 py-1 text-[9px] font-semibold text-[var(--text-tertiary)] uppercase tracking-wider border-t border-[var(--border-primary)]">
                  {t("wikiProjectWikis", "Project Wikis")}
                </div>
                {projectDirs.map((proj) => (
                  <button
                    key={proj.directory}
                    onClick={() => {
                      onTargetChange(proj.directory);
                      setSelectorOpen(false);
                    }}
                    className={cn(
                      "w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors hover:bg-[var(--surface-secondary)]",
                      target === proj.directory && "bg-[var(--surface-secondary)]",
                    )}
                  >
                    <Folder className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" />
                    <span className="flex-1 text-left truncate">{proj.label}</span>
                    {target === proj.directory && (
                      <Check className="h-3 w-3 shrink-0 text-[var(--brand-primary)]" />
                    )}
                  </button>
                ))}
              </>
            )}
          </div>
        )}
      </div>

      {/* Search bar + mode selector */}
      <div className="p-3 border-b border-[var(--border-primary)]">
        <div className="relative">
          {isSearching ? (
            <Loader2 className="absolute left-2.5 top-2 h-3.5 w-3.5 animate-spin text-[var(--text-tertiary)]" />
          ) : (
            <Search className="absolute left-2.5 top-2 h-3.5 w-3.5 text-[var(--text-tertiary)]" />
          )}
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
            placeholder={t("searchWiki")}
            className="w-full pl-8 pr-7 py-1.5 text-xs bg-[var(--surface-secondary)] border border-[var(--border-primary)] rounded-lg focus:outline-none focus:ring-1 focus:ring-[var(--brand-primary)]"
          />
          {searchQuery && (
            <button
              onClick={onClearSearch}
              className="absolute right-2 top-1.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        {/* Search mode toggle */}
        <div className="flex items-center gap-1 mt-1.5">
          <Zap className="h-3 w-3 text-[var(--text-tertiary)] shrink-0" />
          <div className="flex items-center bg-[var(--surface-secondary)] rounded-md border border-[var(--border-primary)] p-0.5 flex-1">
            {([
              { key: "keyword", label: t("searchModeKeyword", "Keyword") },
              { key: "semantic", label: t("searchModeSemantic", "Semantic") },
              { key: "hybrid", label: t("searchModeHybrid", "Hybrid") },
            ] as const).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => onSearchModeChange(key)}
                className={cn(
                  "flex-1 px-1.5 py-0.5 text-[9px] font-medium rounded transition-colors text-center",
                  searchMode === key
                    ? "bg-[var(--surface-primary)] text-[var(--text-primary)] shadow-sm"
                    : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]",
                )}
                title={t("searchModeTooltip", "Search Mode")}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Categories */}
      <div className="flex-1 overflow-y-auto">
        <div className="p-2">
          <button
            onClick={() => onCategoryChange(null)}
            className={cn(
              "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors",
              !selectedCategory
                ? "bg-[var(--surface-secondary)] font-medium"
                : "hover:bg-[var(--surface-secondary)]",
            )}
          >
            <FolderOpen className="h-3.5 w-3.5" />
            {t("allPages")}
            <span className="ml-auto text-[var(--text-tertiary)]">{status?.total_pages || 0}</span>
          </button>

          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => onCategoryChange(cat === selectedCategory ? null : cat)}
              className={cn(
                "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors",
                selectedCategory === cat
                  ? "bg-[var(--surface-secondary)] font-medium"
                  : "hover:bg-[var(--surface-secondary)]",
              )}
            >
              <span className="text-xs">{CATEGORY_ICONS[cat] || "📁"}</span>
              <span>{categoryName(cat)}</span>
              <span className="ml-auto text-[var(--text-tertiary)]">
                {status?.categories?.[cat] || 0}
              </span>
            </button>
          ))}
        </div>

        {/* Search results or page list */}
        <div className="border-t border-[var(--border-primary)] px-2 py-2">
          {searchResults.length > 0 ? (
            <>
              <p className="px-2 py-1 text-[10px] font-medium text-[var(--text-tertiary)] uppercase">
                {t("searchResults")} ({searchResults.length})
              </p>
              {searchResults.map((r) => (
                <button
                  key={r.page_id}
                  onClick={() => onSelectPage(r.page_id)}
                  className={cn(
                    "w-full text-left px-2 py-1.5 rounded-md text-xs hover:bg-[var(--surface-secondary)] transition-colors",
                    selectedPageId === r.page_id && "bg-[var(--surface-secondary)]",
                  )}
                >
                  <p className="font-medium truncate">{r.title}</p>
                  <p className="text-[var(--text-tertiary)] truncate text-[10px] mt-0.5">
                    {categoryName(r.category)}
                    {r.snippet ? ` · ${r.snippet.slice(0, 60)}` : ""}
                  </p>
                </button>
              ))}
            </>
          ) : searchQuery.trim() ? (
            isSearching ? null : (
              <p className="px-2 py-2 text-[10px] text-[var(--text-tertiary)] text-center">
                {t("noSearchResults", "No results found")}
              </p>
            )
          ) : (
            <>
              <p className="px-2 py-1 text-[10px] font-medium text-[var(--text-tertiary)] uppercase">
                {t("pages")} ({pages.length})
              </p>
              {pages.length === 0 ? (
                <p className="px-2 py-2 text-[10px] text-[var(--text-tertiary)] text-center">
                  {t("noPagesYet", "No pages yet")}
                </p>
              ) : (
                pages.map((p) => (
                  <button
                    key={p.page_id}
                    onClick={() => onSelectPage(p.page_id)}
                    className={cn(
                      "w-full text-left flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs hover:bg-[var(--surface-secondary)] transition-colors",
                      selectedPageId === p.page_id && "bg-[var(--surface-secondary)]",
                    )}
                  >
                    <FileText className="h-3 w-3 shrink-0 text-[var(--text-tertiary)]" />
                    <span className="truncate">{p.title}</span>
                  </button>
                ))
              )}
            </>
          )}
        </div>
      </div>

      {/* New page button + view toggle */}
      <div className="p-2 border-t border-[var(--border-primary)] flex gap-1.5">
        <button
          onClick={onNewPage}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[var(--brand-primary)] text-[var(--brand-primary-text)] rounded-lg hover:opacity-90 transition-opacity"
        >
          <Plus className="h-3.5 w-3.5" />
          {t("newPage")}
        </button>
        <div className="flex items-center bg-[var(--surface-secondary)] rounded-lg border border-[var(--border-primary)] p-0.5">
          <button
            onClick={() => onViewModeChange("list")}
            className={cn(
              "p-1 rounded transition-colors",
              viewMode === "list"
                ? "bg-[var(--surface-primary)] text-[var(--text-primary)] shadow-sm"
                : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]",
            )}
            title={t("listView", "List View")}
          >
            <List className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => onViewModeChange("graph")}
            className={cn(
              "p-1 rounded transition-colors",
              viewMode === "graph"
                ? "bg-[var(--surface-primary)] text-[var(--text-primary)] shadow-sm"
                : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]",
            )}
            title={t("graphView", "Graph View")}
          >
            <Network className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => onViewModeChange("review")}
            className={cn(
              "p-1 rounded transition-colors",
              viewMode === "review"
                ? "bg-[var(--surface-primary)] text-[var(--text-primary)] shadow-sm"
                : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]",
            )}
            title={t("reviewView", "Review")}
          >
            <Shield className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => onViewModeChange("queue")}
            className={cn(
              "p-1 rounded transition-colors relative",
              viewMode === "queue"
                ? "bg-[var(--surface-primary)] text-[var(--text-primary)] shadow-sm"
                : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]",
            )}
            title={t("queueView", "Queue")}
          >
            <ListOrdered className="h-3.5 w-3.5" />
            {queuePendingCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] flex items-center justify-center px-0.5 text-[8px] font-bold rounded-full bg-amber-500 text-white">
                {queuePendingCount > 9 ? "9+" : queuePendingCount}
              </span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
