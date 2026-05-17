"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  BookOpen,
  Search,
  FileText,
  FolderOpen,
  Plus,
  Trash2,
  Loader2,
  Globe,
  Pencil,
  X,
  ChevronDown,
  Check,
  Folder,
  Eye,
  Code2,
  GitMerge,
} from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

import { cn, directoryLabelOf, normalizeDirectory } from "@/lib/utils";
import { api, ApiError, apiErrorMessage } from "@/lib/api";
import { queryKeys } from "@/lib/constants";
import { useWorkspaceStore } from "@/stores/workspace-store";
import type { SessionResponse } from "@/types/session";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// ── Types ──────────────────────────────────────────────────────────────────

interface WikiPage {
  page_id: string;
  title: string;
  category: string;
  path: string;
}

interface WikiPageDetail {
  page_id: string;
  title: string;
  content: string;
  category: string;
  path: string;
}

interface WikiStatus {
  initialized: boolean;
  wiki_root: string;
  total_pages: number;
  categories: Record<string, number>;
  has_index: boolean;
}

interface SearchResult {
  page_id: string;
  title: string;
  category: string;
  snippet: string;
  title_match: boolean;
  score: number;
}

/** Selected wiki scope: null = global, string = project directory path */
type WikiTarget = string | null;

const CATEGORIES = [
  "entities",
  "concepts",
  "sources",
  "synthesis",
  "comparison",
  "queries",
] as const;

const CATEGORY_ICONS: Record<string, string> = {
  entities: "👤",
  concepts: "💡",
  sources: "📄",
  synthesis: "🔗",
  comparison: "⚖️",
  queries: "🔍",
};

const CATEGORY_I18N_KEYS: Record<string, string> = {
  entities: "catEntities",
  concepts: "catConcepts",
  sources: "catSources",
  synthesis: "catSynthesis",
  comparison: "catComparison",
  queries: "catQueries",
};

const SEARCH_DEBOUNCE_MS = 300;

/** Shorten a filesystem path for display (replace home dir with ~) */
function shortenPath(path: string): string {
  return path
    .replace(/^\/Users\/[^/]+/, "~")
    .replace(/^\/home\/[^/]+/, "~");
}

/** Strip YAML frontmatter from markdown content for preview display */
function stripFrontmatter(content: string): string {
  return content.replace(/^---\n[\s\S]*?---\n/, "");
}

// ── Toast helper ───────────────────────────────────────────────────────────

function showToast(message: string, type: "error" | "success" = "error") {
  const el = document.createElement("div");
  el.className = cn(
    "fixed bottom-4 right-4 z-[9999] px-4 py-2 rounded-lg text-sm font-medium shadow-lg transition-opacity",
    type === "error" ? "bg-red-600 text-white" : "bg-green-600 text-white",
  );
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => {
    el.style.opacity = "0";
    setTimeout(() => el.remove(), 300);
  }, 3000);
}

// ── Project Directory Selector ─────────────────────────────────────────────

interface ProjectOption {
  directory: string;
  label: string;
}

/**
 * Extract unique project directories from the sessions cache.
 * Falls back to the current active workspace if the cache is empty.
 */
function useProjectDirectories(): ProjectOption[] {
  const queryClient = useQueryClient();
  const activeWorkspacePath = useWorkspaceStore((s) => s.activeWorkspacePath);

  return useMemo(() => {
    const dirs = new Map<string, string>();

    // Always include the active workspace
    if (activeWorkspacePath) {
      const norm = normalizeDirectory(activeWorkspacePath);
      dirs.set(norm, directoryLabelOf(norm));
    }

    // Extract from sessions cache
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

// ── Main Component ─────────────────────────────────────────────────────────

export function KnowledgeCenterContent() {
  const { t } = useTranslation("common");
  const activeWorkspacePath = useWorkspaceStore((s) => s.activeWorkspacePath);
  const projectDirs = useProjectDirectories();

  // Wiki target: null = global, string = project directory
  const [target, setTarget] = useState<WikiTarget>(null); // default: global
  const [selectorOpen, setSelectorOpen] = useState(false);
  const selectorRef = useRef<HTMLDivElement>(null);
  const [editorSelectorOpen, setEditorSelectorOpen] = useState(false);
  const editorSelectorRef = useRef<HTMLDivElement>(null);

  // Close selector on outside click
  useEffect(() => {
    if (!selectorOpen && !editorSelectorOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (selectorOpen && selectorRef.current && !selectorRef.current.contains(e.target as Node)) {
        setSelectorOpen(false);
      }
      if (editorSelectorOpen && editorSelectorRef.current && !editorSelectorRef.current.contains(e.target as Node)) {
        setEditorSelectorOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [selectorOpen, editorSelectorOpen]);

  // Derive the workspace query param for API calls
  const workspaceParam = target; // null = global, string = project dir

  const [status, setStatus] = useState<WikiStatus | null>(null);
  const [pages, setPages] = useState<WikiPage[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedPage, setSelectedPage] = useState<WikiPageDetail | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isWriting, setIsWriting] = useState(false);

  // Editor state
  const [editContent, setEditContent] = useState("");
  const [editTitle, setEditTitle] = useState("");
  const [editCategory, setEditCategory] = useState<string>("entities");
  const [showEditor, setShowEditor] = useState(false);
  const [isEditingExisting, setIsEditingExisting] = useState(false);
  const [editorMode, setEditorMode] = useState<"edit" | "preview">("edit");
  const [isMerging, setIsMerging] = useState(false);

  // Search debounce timer ref
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Helper: build URL with workspace query param
  const wikiUrl = useCallback(
    (path: string) => {
      const base = `/api/wiki${path}`;
      if (workspaceParam) {
        const sep = path.includes("?") ? "&" : "?";
        return `${base}${sep}workspace=${encodeURIComponent(workspaceParam)}`;
      }
      return base;
    },
    [workspaceParam],
  );

  // Fetch wiki status
  const fetchStatus = useCallback(async (): Promise<WikiStatus | null> => {
    try {
      const data = await api.get<WikiStatus>(wikiUrl("/status"));
      setStatus(data);
      return data;
    } catch {
      return null;
    }
  }, [wikiUrl]);

  // Fetch pages
  const fetchPages = useCallback(
    async (category?: string) => {
      try {
        let url = wikiUrl("/pages");
        if (category) {
          const sep = url.includes("?") ? "&" : "?";
          url += `${sep}category=${category}`;
        }
        const data = await api.get<{ pages: WikiPage[]; count: number }>(url);
        setPages(data.pages || []);
      } catch {
        setPages([]);
      }
    },
    [wikiUrl],
  );

  // Initialize on mount and when target changes
  useEffect(() => {
    // Reset browsing state on scope switch
    setSearchResults([]);
    setSelectedCategory(null);
    setSearchQuery("");

    // When the editor is NOT open, clear the selected page so the
    // user sees the fresh page list for the new scope.
    // When the editor IS open (user is editing / creating a page),
    // keep it open — they may just be switching the save target.
    if (!showEditor) {
      setSelectedPage(null);
    }

    const init = async () => {
      setIsLoading(true);
      const data = await fetchStatus();
      if (data && !data.initialized) {
        try {
          await api.post(wikiUrl("/initialize"));
          await fetchStatus();
        } catch {
          // Auto-init failed
        }
      }
      await fetchPages();
      setIsLoading(false);
    };
    init();
    // NOTE: showEditor is intentionally excluded from deps to avoid
    // re-running this effect when the editor opens/closes.  The value
    // is read at the time the effect fires (i.e. when target changes).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, fetchStatus, fetchPages, wikiUrl]);

  // Fetch pages when category changes
  useEffect(() => {
    if (!isLoading) {
      fetchPages(selectedCategory || undefined);
    }
  }, [selectedCategory, fetchPages, isLoading]);

  // Debounced search: auto-search after user stops typing
  useEffect(() => {
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current);
    }

    const trimmed = searchQuery.trim();
    if (!trimmed) {
      setSearchResults([]);
      return;
    }

    searchTimerRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const data = await api.post<{ results: SearchResult[]; count: number; query: string }>(
          wikiUrl("/search"),
          { query: trimmed, max_results: 20 },
        );
        setSearchResults(data.results || []);
      } catch (err) {
        setSearchResults([]);
        const msg = apiErrorMessage(err, t("searchFailed", "Search failed"));
        showToast(msg, "error");
      } finally {
        setIsSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current);
      }
    };
  }, [searchQuery, wikiUrl, t]);

  // Read page
  const handleSelectPage = useCallback(
    async (pageId: string) => {
      try {
        const data = await api.get<WikiPageDetail>(wikiUrl(`/pages/${encodeURIComponent(pageId)}`));
        setSelectedPage(data);
        setEditContent(data.content || "");
        setEditTitle(data.title || "");
        setEditCategory(data.category || "concepts");
        setShowEditor(false);
        setIsEditingExisting(false);
      } catch (err) {
        const msg = apiErrorMessage(err, t("pageNotFound", "Page not found"));
        showToast(msg, "error");
      }
    },
    [wikiUrl, t],
  );

  // Start editing the currently selected page
  const handleEditPage = useCallback(() => {
    if (!selectedPage) return;
    setEditContent(selectedPage.content || "");
    setEditTitle(selectedPage.title || "");
    setEditCategory(selectedPage.category || "concepts");
    setIsEditingExisting(true);
    setShowEditor(true);
    setEditorMode("edit");
  }, [selectedPage]);

  // Write page (with force for existing pages)
  const handleWritePage = useCallback(async () => {
    if (!editTitle.trim() || !editContent.trim()) return;
    setIsWriting(true);
    try {
      await api.post(wikiUrl("/pages"), {
        title: editTitle,
        content: editContent,
        category: editCategory,
        force: isEditingExisting, // force overwrite when editing existing
      });
      setShowEditor(false);
      setIsEditingExisting(false);
      await fetchPages(selectedCategory || undefined);
      await fetchStatus();
      showToast(t("pageSaved", "Page saved"), "success");
    } catch (err) {
      const msg = apiErrorMessage(err, t("saveFailed", "Save failed"));
      showToast(msg, "error");
    } finally {
      setIsWriting(false);
    }
  }, [editTitle, editContent, editCategory, isEditingExisting, selectedCategory, fetchPages, fetchStatus, wikiUrl, t]);

  // Merge sections into existing page
  const handleMergePage = useCallback(async () => {
    if (!editTitle.trim() || !editContent.trim()) return;
    setIsMerging(true);
    try {
      await api.post(wikiUrl("/merge"), {
        title: editTitle,
        content: editContent,
        category: editCategory,
      });
      setShowEditor(false);
      setIsEditingExisting(false);
      await fetchPages(selectedCategory || undefined);
      await fetchStatus();
      showToast(t("pageMerged", "Page merged"), "success");
    } catch (err) {
      const msg = apiErrorMessage(err, t("mergeFailed", "Merge failed"));
      showToast(msg, "error");
    } finally {
      setIsMerging(false);
    }
  }, [editTitle, editContent, editCategory, selectedCategory, fetchPages, fetchStatus, wikiUrl, t]);

  // Delete page
  const handleDeletePage = useCallback(
    async (pageId: string) => {
      try {
        await api.delete(wikiUrl(`/pages/${encodeURIComponent(pageId)}`));
        if (selectedPage?.page_id === pageId) {
          setSelectedPage(null);
        }
        await fetchPages(selectedCategory || undefined);
        await fetchStatus();
        showToast(t("pageDeleted", "Page deleted"), "success");
      } catch (err) {
        const msg = apiErrorMessage(err, t("deleteFailed", "Delete failed"));
        showToast(msg, "error");
      }
    },
    [selectedPage, selectedCategory, fetchPages, fetchStatus, wikiUrl, t],
  );

  // Initialize wiki
  const handleInitialize = useCallback(async () => {
    try {
      await api.post(wikiUrl("/initialize"));
      await fetchStatus();
      await fetchPages();
    } catch (err) {
      const msg = apiErrorMessage(err, t("initFailed", "Initialization failed"));
      showToast(msg, "error");
    }
  }, [fetchStatus, fetchPages, wikiUrl, t]);

  // Start creating a new page
  const handleNewPage = useCallback(() => {
    setShowEditor(true);
    setSelectedPage(null);
    setEditTitle("");
    setEditContent("");
    setEditCategory("entities");
    setIsEditingExisting(false);
  }, []);

  // Clear search
  const handleClearSearch = useCallback(() => {
    setSearchQuery("");
    setSearchResults([]);
  }, []);

  // Helper: category display name (with i18n)
  const categoryName = useCallback(
    (cat: string) => {
      const key = CATEGORY_I18N_KEYS[cat];
      return key ? t(key, cat) : cat;
    },
    [t],
  );

  // Selector: current display label
  const currentLabel = target === null
    ? t("wikiScopeGlobal")
    : directoryLabelOf(target);
  const currentIcon = target === null
    ? <Globe className="h-3.5 w-3.5 shrink-0" />
    : <Folder className="h-3.5 w-3.5 shrink-0" />;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="h-6 w-6 animate-spin text-[var(--text-secondary)]" />
      </div>
    );
  }

  // Not initialized state
  if (status && !status.initialized) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <BookOpen className="h-12 w-12 text-[var(--text-secondary)]" />
        <p className="text-sm text-[var(--text-secondary)]">
          {t("wikiNotInitialized")}
        </p>
        <button
          onClick={handleInitialize}
          className="px-4 py-2 bg-[var(--brand-primary)] text-[var(--brand-primary-text)] rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
        >
          {t("initializeWiki")}
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full">
      {/* Left sidebar */}
      <div className="w-64 border-r border-[var(--border-primary)] flex flex-col overflow-hidden">
        {/* Wiki target selector — replaces the old scope switcher + path indicator */}
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
                  setTarget(null);
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
                        setTarget(proj.directory);
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

        {/* Search bar */}
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
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t("searchWiki")}
              className="w-full pl-8 pr-7 py-1.5 text-xs bg-[var(--surface-secondary)] border border-[var(--border-primary)] rounded-lg focus:outline-none focus:ring-1 focus:ring-[var(--brand-primary)]"
            />
            {searchQuery && (
              <button
                onClick={handleClearSearch}
                className="absolute right-2 top-1.5 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Categories */}
        <div className="flex-1 overflow-y-auto">
          <div className="p-2">
            <button
              onClick={() => setSelectedCategory(null)}
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
                onClick={() => setSelectedCategory(cat === selectedCategory ? null : cat)}
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
                    onClick={() => handleSelectPage(r.page_id)}
                    className={cn(
                      "w-full text-left px-2 py-1.5 rounded-md text-xs hover:bg-[var(--surface-secondary)] transition-colors",
                      selectedPage?.page_id === r.page_id && "bg-[var(--surface-secondary)]",
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
                      onClick={() => handleSelectPage(p.page_id)}
                      className={cn(
                        "w-full text-left flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs hover:bg-[var(--surface-secondary)] transition-colors",
                        selectedPage?.page_id === p.page_id && "bg-[var(--surface-secondary)]",
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

        {/* New page button */}
        <div className="p-2 border-t border-[var(--border-primary)]">
          <button
            onClick={handleNewPage}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-[var(--brand-primary)] text-[var(--brand-primary-text)] rounded-lg hover:opacity-90 transition-opacity"
          >
            <Plus className="h-3.5 w-3.5" />
            {t("newPage")}
          </button>
        </div>
      </div>

      {/* Right panel: Page content or editor */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {showEditor ? (
          <>
            {/* Editor toolbar */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-[var(--border-primary)] bg-[var(--surface-tertiary)] shrink-0">
              <div className="flex items-center gap-3">
                <h2 className="text-xs font-semibold">
                  {isEditingExisting ? t("editWikiPage", "Edit Page") : t("newWikiPage")}
                </h2>
                {/* Editor target selector — inline dropdown */}
                <div ref={editorSelectorRef} className="relative">
                  <button
                    onClick={() => setEditorSelectorOpen(!editorSelectorOpen)}
                    className={cn(
                      "flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-md transition-colors",
                      "bg-[var(--surface-secondary)] border border-[var(--border-primary)]",
                      "hover:bg-[var(--surface-tertiary)]",
                      editorSelectorOpen && "bg-[var(--surface-tertiary)]",
                    )}
                  >
                    {target === null
                      ? <Globe className="h-3 w-3 shrink-0 text-[var(--text-tertiary)]" />
                      : <Folder className="h-3 w-3 shrink-0 text-[var(--text-tertiary)]" />}
                    <span className="max-w-24 truncate">{currentLabel}</span>
                    <ChevronDown
                      className={cn(
                        "h-2.5 w-2.5 shrink-0 text-[var(--text-tertiary)] transition-transform",
                        editorSelectorOpen && "rotate-180",
                      )}
                    />
                  </button>

                  {editorSelectorOpen && (
                    <div className="absolute left-0 top-full z-30 mt-1 bg-[var(--surface-primary)] border border-[var(--border-primary)] rounded-lg shadow-lg min-w-48 max-h-64 overflow-y-auto">
                      {/* Global wiki */}
                      <button
                        onClick={() => {
                          setTarget(null);
                          setEditorSelectorOpen(false);
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
                                setTarget(proj.directory);
                                setEditorSelectorOpen(false);
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
                <div className="flex items-center gap-1.5">
                  <label className="text-[10px] text-[var(--text-tertiary)]">
                    {t("title")}
                  </label>
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="px-2 py-0.5 text-xs bg-[var(--surface-secondary)] border border-[var(--border-primary)] rounded focus:outline-none focus:ring-1 focus:ring-[var(--brand-primary)] w-48"
                    placeholder={t("pageTitlePlaceholder")}
                  />
                </div>
                <div className="flex items-center gap-1.5">
                  <label className="text-[10px] text-[var(--text-tertiary)]">
                    {t("category")}
                  </label>
                  <select
                    value={editCategory}
                    onChange={(e) => setEditCategory(e.target.value)}
                    className="px-2 py-0.5 text-xs bg-[var(--surface-secondary)] border border-[var(--border-primary)] rounded focus:outline-none focus:ring-1 focus:ring-[var(--brand-primary)]"
                  >
                    {CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {CATEGORY_ICONS[cat]} {categoryName(cat)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                {/* Edit / Preview toggle */}
                <div className="flex items-center bg-[var(--surface-secondary)] rounded-md border border-[var(--border-primary)] p-0.5">
                  <button
                    onClick={() => setEditorMode("edit")}
                    className={cn(
                      "flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors",
                      editorMode === "edit"
                        ? "bg-[var(--surface-primary)] text-[var(--text-primary)] shadow-sm"
                        : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]",
                    )}
                    title={t("edit")}
                  >
                    <Code2 className="h-3 w-3" />
                    {t("edit")}
                  </button>
                  <button
                    onClick={() => setEditorMode("preview")}
                    className={cn(
                      "flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors",
                      editorMode === "preview"
                        ? "bg-[var(--surface-primary)] text-[var(--text-primary)] shadow-sm"
                        : "text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]",
                    )}
                    title={t("preview")}
                  >
                    <Eye className="h-3 w-3" />
                    {t("preview")}
                  </button>
                </div>
                {/* Save actions */}
                {isEditingExisting ? (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={handleMergePage}
                      disabled={isMerging || !editTitle.trim() || !editContent.trim()}
                      className="flex items-center gap-1 px-3 py-1 text-[11px] font-medium bg-[var(--brand-primary)] text-[var(--brand-primary-text)] rounded hover:opacity-90 transition-opacity disabled:opacity-50"
                      title={t("mergeSaveTooltip", "Merge new sections into existing page")}
                    >
                      <GitMerge className="h-3 w-3" />
                      {isMerging ? t("saving") : t("mergeSave", "Merge & Save")}
                    </button>
                    <button
                      onClick={handleWritePage}
                      disabled={isWriting || !editTitle.trim() || !editContent.trim()}
                      className="px-3 py-1 text-[11px] font-medium text-[var(--text-secondary)] border border-[var(--border-primary)] rounded hover:bg-[var(--surface-secondary)] transition-colors disabled:opacity-50"
                      title={t("overwriteSaveTooltip", "Overwrite existing page completely")}
                    >
                      {isWriting ? t("saving") : t("overwriteSave", "Overwrite")}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={handleWritePage}
                    disabled={isWriting || !editTitle.trim() || !editContent.trim()}
                    className="px-3 py-1 text-[11px] font-medium bg-[var(--brand-primary)] text-[var(--brand-primary-text)] rounded hover:opacity-90 transition-opacity disabled:opacity-50"
                  >
                    {isWriting ? t("saving") : t("save")}
                  </button>
                )}
                <button
                  onClick={() => {
                    setShowEditor(false);
                    setIsEditingExisting(false);
                    setEditorMode("edit");
                  }}
                  className="px-3 py-1 text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                >
                  {t("cancel")}
                </button>
              </div>
            </div>
            {/* Unified editor/preview area */}
            <div className="flex-1 overflow-hidden">
              {editorMode === "edit" ? (
                <textarea
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="w-full h-full p-6 text-sm font-mono bg-[var(--surface-secondary)] resize-none focus:outline-none"
                  placeholder={t("pageContentPlaceholder")}
                />
              ) : (
                <div className="h-full overflow-y-auto p-6 max-w-3xl mx-auto">
                  {editContent.trim() ? (
                    <WikiMarkdown content={stripFrontmatter(editContent)} />
                  ) : (
                    <p className="text-xs text-[var(--text-tertiary)] italic">
                      {t("previewPlaceholder")}
                    </p>
                  )}
                </div>
              )}
            </div>
          </>
        ) : selectedPage ? (
          <div className="flex-1 overflow-y-auto">
            <div className="p-6 max-w-3xl mx-auto">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h2 className="text-lg font-semibold">{selectedPage.title}</h2>
                  <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
                    {categoryName(selectedPage.category)} · {selectedPage.page_id}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={handleEditPage}
                    className="p-1.5 text-[var(--text-tertiary)] hover:text-[var(--brand-primary)] transition-colors"
                    title={t("editPage", "Edit page")}
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => {
                      if (window.confirm(t("confirmDeletePage"))) {
                        handleDeletePage(selectedPage.page_id);
                      }
                    }}
                    className="p-1.5 text-[var(--text-tertiary)] hover:text-red-500 transition-colors"
                    title={t("deletePage")}
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <WikiMarkdown
                content={selectedPage.content}
                onWikilinkClick={(target) => handleSelectPage(target)}
              />
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-[var(--text-secondary)]">
            <BookOpen className="h-10 w-10 text-[var(--text-tertiary)]" />
            <p className="text-sm">{t("selectOrSearch")}</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Wiki Markdown Renderer ─────────────────────────────────────────────────

interface WikiMarkdownProps {
  content: string;
  onWikilinkClick?: (target: string) => void;
}

function preprocessWikiMarkdown(raw: string): string {
  const content = raw.replace(/^---\n[\s\S]*?---\n/, "");
  return content.replace(
    /\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]/g,
    (_, target: string, alias: string) =>
      `[${alias || target}](wiki:${target.trim()})`,
  );
}

function WikiMarkdown({ content, onWikilinkClick }: WikiMarkdownProps) {
  const processed = preprocessWikiMarkdown(content);

  const components = useMemo(
    () => ({
      a: ({
        children,
        href,
        ...props
      }: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
        children?: React.ReactNode;
      }) => {
        if (href?.startsWith("wiki:")) {
          const target = decodeURIComponent(href.slice(5));
          return (
            <span
              className="text-[var(--brand-primary)] underline decoration-dotted cursor-pointer hover:opacity-80 transition-opacity"
              role="button"
              tabIndex={0}
              onClick={() => onWikilinkClick?.(target)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onWikilinkClick?.(target);
              }}
            >
              {children}
            </span>
          );
        }
        return (
          <a target="_blank" rel="noopener noreferrer" href={href} {...props}>
            {children}
          </a>
        );
      },
    }),
    [onWikilinkClick],
  );

  return (
    <div className="prose prose-sm dark:prose-invert max-w-none">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {processed}
      </ReactMarkdown>
    </div>
  );
}
