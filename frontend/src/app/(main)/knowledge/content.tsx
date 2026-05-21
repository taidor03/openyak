"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { BookOpen, Loader2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { api, apiErrorMessage } from "@/lib/api";
import { useWorkspaceStore } from "@/stores/workspace-store";

import { GraphView } from "./graph-view";
import { WikiSidebar, type SearchMode } from "./wiki-sidebar";
import { WikiEditor } from "./wiki-editor";
import { WikiPageView } from "./wiki-page-view";
import { DndIngestOverlay } from "./wiki-dnd-ingest";
import { WikiReviewPanel } from "./wiki-review-panel";
import { WikiQueuePanel } from "./wiki-queue-panel";
import {
  type WikiTarget,
  type WikiStatus,
  type WikiPage,
  type WikiPageDetail,
  type SearchResult,
  SEARCH_DEBOUNCE_MS,
} from "./wiki-types";

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

// ── Main Component ─────────────────────────────────────────────────────────

export function KnowledgeCenterContent() {
  const { t } = useTranslation("common");
  const activeWorkspacePath = useWorkspaceStore((s) => s.activeWorkspacePath); // eslint-disable-line @typescript-eslint/no-unused-vars

  // Wiki target: null = global, string = project directory
  const [target, setTarget] = useState<WikiTarget>(null);

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
  const [isMerging, setIsMerging] = useState(false);

  // View mode: list or graph or review or queue
  const [viewMode, setViewMode] = useState<"list" | "graph" | "review" | "queue">("list");

  // Queue pending count for sidebar badge
  const [queuePendingCount, setQueuePendingCount] = useState(0);

  // Search mode: keyword, semantic, or hybrid
  const [searchMode, setSearchMode] = useState<SearchMode>("keyword");

  // Search debounce timer ref
  const searchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Helper: build URL with workspace query param
  const wikiUrl = useCallback(
    (path: string) => {
      const base = `/api/wiki${path}`;
      if (target) {
        const sep = path.includes("?") ? "&" : "?";
        return `${base}${sep}workspace=${encodeURIComponent(target)}`;
      }
      return base;
    },
    [target],
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
    setSearchResults([]);
    setSelectedCategory(null);
    setSearchQuery("");

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target, fetchStatus, fetchPages, wikiUrl]);

  // Fetch pages when category changes
  useEffect(() => {
    if (!isLoading) {
      fetchPages(selectedCategory || undefined);
    }
  }, [selectedCategory, fetchPages, isLoading]);

  // Debounced search
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
          { query: trimmed, max_results: 20, mode: searchMode },
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
  }, [searchQuery, searchMode, wikiUrl, t]);

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
        force: isEditingExisting,
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

  // Refresh helper after ingest/review actions (must be before early returns for rules-of-hooks)
  const handleIngestComplete = useCallback(async () => {
    await fetchPages(selectedCategory || undefined);
    await fetchStatus();
  }, [fetchPages, fetchStatus, selectedCategory]);

  // Fetch queue pending count for sidebar badge
  useEffect(() => {
    const fetchQueueCount = async () => {
      try {
        const data = await api.get<{ stats: { pending: number; processing: number; failed: number } }>(wikiUrl("/ingest-queue"));
        setQueuePendingCount(data.stats.pending + data.stats.processing + data.stats.failed);
      } catch {
        setQueuePendingCount(0);
      }
    };
    fetchQueueCount();
    const timer = setInterval(fetchQueueCount, 30000);
    return () => clearInterval(timer);
  }, [wikiUrl]);

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
    <DndIngestOverlay wikiUrl={wikiUrl} onIngestComplete={handleIngestComplete}>
      <div className="flex h-full">
        {/* Left sidebar */}
        <WikiSidebar
          target={target}
          status={status}
          selectedCategory={selectedCategory}
          selectedPageId={selectedPage?.page_id ?? null}
          searchQuery={searchQuery}
          searchResults={searchResults}
          isSearching={isSearching}
          pages={pages}
          viewMode={viewMode}
          searchMode={searchMode}
          queuePendingCount={queuePendingCount}
          onTargetChange={setTarget}
          onCategoryChange={setSelectedCategory}
          onSearchQueryChange={setSearchQuery}
          onClearSearch={handleClearSearch}
          onSelectPage={handleSelectPage}
          onNewPage={handleNewPage}
          onViewModeChange={setViewMode}
          onSearchModeChange={setSearchMode}
        />

        {/* Right panel: Page content or editor */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {showEditor ? (
            <WikiEditor
              editTitle={editTitle}
              editContent={editContent}
              editCategory={editCategory}
              isEditingExisting={isEditingExisting}
              isWriting={isWriting}
              isMerging={isMerging}
              target={target}
              onTitleChange={setEditTitle}
              onContentChange={setEditContent}
              onCategoryChange={setEditCategory}
              onTargetChange={setTarget}
              onWrite={handleWritePage}
              onMerge={handleMergePage}
              onCancel={() => {
                setShowEditor(false);
                setIsEditingExisting(false);
              }}
            />
          ) : selectedPage ? (
            <WikiPageView
              page={selectedPage}
              onEdit={handleEditPage}
              onDelete={handleDeletePage}
              onWikilinkClick={(target) => handleSelectPage(target)}
            />
          ) : viewMode === "queue" ? (
            <WikiQueuePanel
              wikiUrl={wikiUrl}
              onRefresh={handleIngestComplete}
            />
          ) : viewMode === "review" ? (
            <WikiReviewPanel
              wikiUrl={wikiUrl}
              onPageClick={(pageId) => handleSelectPage(pageId)}
              onRefresh={handleIngestComplete}
            />
          ) : viewMode === "graph" ? (
            <GraphView
              wikiUrl={wikiUrl}
              onPageClick={(pageId) => handleSelectPage(pageId)}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-[var(--text-secondary)]">
              <BookOpen className="h-10 w-10 text-[var(--text-tertiary)]" />
              <p className="text-sm">{t("selectOrSearch")}</p>
            </div>
          )}
        </div>
      </div>
    </DndIngestOverlay>
  );
}
