"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  Globe,
  Pencil,
  ChevronDown,
  Check,
  Folder,
  Eye,
  Code2,
  GitMerge,
  Save,
} from "lucide-react";

import { cn, directoryLabelOf, normalizeDirectory } from "@/lib/utils";
import { useWorkspaceStore } from "@/stores/workspace-store";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/constants";
import type { SessionResponse } from "@/types/session";
import { WikiMarkdown } from "./wiki-markdown";
import {
  type WikiTarget,
  type WikiStatus,
  CATEGORIES,
  CATEGORY_ICONS,
  CATEGORY_I18N_KEYS,
  stripFrontmatter,
  parseFrontmatter,
  parseYamlList,
  toYamlList,
  ARRAY_FIELDS,
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

// ── Frontmatter Editor Panel ───────────────────────────────────────────────

interface FrontmatterEditorProps {
  content: string;
  onChange: (updatedContent: string) => void;
}

function FrontmatterEditor({ content, onChange }: FrontmatterEditorProps) {
  const { t } = useTranslation("common");
  const [expanded, setExpanded] = useState(true);
  const fm = useMemo(() => parseFrontmatter(content), [content]);

  const handleChange = useCallback(
    (field: string, newValue: string) => {
      const yamlValue = ARRAY_FIELDS.includes(field)
        ? toYamlList(newValue.split(",").map((s) => s.trim()).filter(Boolean))
        : newValue;

      const fmMatch = content.match(/^(---\n[\s\S]*?---\n)/);
      if (!fmMatch) {
        const newFm = `---\ntitle: ${field === "title" ? newValue : ""}\ncategory: ${field === "category" ? newValue : "entities"}\ntags: []\nsources: []\nrelated: []\n---\n\n${content}`;
        onChange(newFm);
        return;
      }

      const fmBlock = fmMatch[1];
      const body = content.slice(fmMatch[0].length);

      const fieldPattern = new RegExp(`^${field}:.*$`, "m");
      let newFmBlock: string;
      if (fieldPattern.test(fmBlock)) {
        newFmBlock = fmBlock.replace(fieldPattern, `${field}: ${yamlValue}`);
      } else {
        newFmBlock = fmBlock.replace(/---\n$/, `${field}: ${yamlValue}\n---\n`);
      }

      onChange(newFmBlock + body);
    },
    [content, onChange],
  );

  const editableFields = [
    { key: "type", label: t("type", "Type"), placeholder: "brief / concept" },
    { key: "tags", label: t("tags", "Tags"), placeholder: "tag1, tag2" },
    { key: "sources", label: t("sources", "Sources"), placeholder: "source1, source2" },
    { key: "related", label: t("related", "Related"), placeholder: "page1, page2" },
  ];

  return (
    <div className="border border-[var(--border-primary)] rounded-lg overflow-hidden mb-3">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-1.5 text-xs bg-[var(--surface-secondary)] hover:bg-[var(--surface-tertiary)] transition-colors"
      >
        <span className="font-medium">Frontmatter</span>
        <ChevronDown
          className={cn(
            "h-3 w-3 text-[var(--text-tertiary)] transition-transform",
            expanded && "rotate-180",
          )}
        />
      </button>
      {expanded && (
        <div className="px-3 py-2 space-y-2">
          {editableFields.map(({ key, label, placeholder }) => {
            const rawValue = fm[key] || "";
            const displayValue = ARRAY_FIELDS.includes(key)
              ? parseYamlList(rawValue).join(", ")
              : rawValue;
            return (
              <div key={key} className="flex items-center gap-2 text-[11px]">
                <label className="shrink-0 text-[var(--text-tertiary)] min-w-[55px] text-right font-medium">
                  {label}
                </label>
                <input
                  type="text"
                  value={displayValue}
                  onChange={(e) => handleChange(key, e.target.value)}
                  placeholder={placeholder}
                  className="flex-1 min-w-0 px-2 py-1 text-[11px] bg-[var(--surface-secondary)] border border-[var(--border-primary)] rounded focus:outline-none focus:ring-1 focus:ring-[var(--brand-primary)]"
                />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Wiki Editor ───────────────────────────────────────────────────────────

interface WikiEditorProps {
  editTitle: string;
  editContent: string;
  editCategory: string;
  isEditingExisting: boolean;
  isWriting: boolean;
  isMerging: boolean;
  target: WikiTarget;
  status: WikiStatus | null;
  onTitleChange: (title: string) => void;
  onContentChange: (content: string) => void;
  onCategoryChange: (category: string) => void;
  onTargetChange: (target: WikiTarget) => void;
  onWrite: () => void;
  onMerge: () => void;
  onCancel: () => void;
}

export function WikiEditor({
  editTitle,
  editContent,
  editCategory,
  isEditingExisting,
  isWriting,
  isMerging,
  target,
  status,
  onTitleChange,
  onContentChange,
  onCategoryChange,
  onTargetChange,
  onWrite,
  onMerge,
  onCancel,
}: WikiEditorProps) {
  const { t } = useTranslation("common");
  const projectDirs = useProjectDirectories();
  const [editorMode, setEditorMode] = useState<"edit" | "preview">("edit");
  const [editorSelectorOpen, setEditorSelectorOpen] = useState(false);
  const editorSelectorRef = useRef<HTMLDivElement>(null);

  // Auto-save draft to localStorage every 30s
  const [autoSaveStatus, setAutoSaveStatus] = useState<"saved" | "saving" | "unsaved">("saved");
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Clear previous timer
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    // Only auto-save if there's content
    if (!editTitle.trim() && !editContent.trim()) {
      return;
    }

    setAutoSaveStatus("unsaved");

    // Debounced auto-save (5 seconds after last change)
    autoSaveTimerRef.current = setTimeout(() => {
      setAutoSaveStatus("saving");
      try {
        const draftKey = `wiki-draft-${editTitle || "untitled"}`;
        localStorage.setItem(draftKey, JSON.stringify({
          title: editTitle,
          content: editContent,
          category: editCategory,
          savedAt: new Date().toISOString(),
        }));
        setAutoSaveStatus("saved");
      } catch {
        setAutoSaveStatus("unsaved");
      }
    }, 5000);

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, [editTitle, editContent, editCategory]);

  // Close selector on outside click
  useEffect(() => {
    if (!editorSelectorOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (editorSelectorRef.current && !editorSelectorRef.current.contains(e.target as Node)) {
        setEditorSelectorOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [editorSelectorOpen]);

  const categoryName = (cat: string) => {
    const key = CATEGORY_I18N_KEYS[cat];
    return key ? t(key, cat) : cat;
  };

  const currentLabel = target === null
    ? t("wikiScopeGlobal")
    : directoryLabelOf(target);

  return (
    <>
      {/* Editor toolbar */}
      <div className="flex flex-col border-b border-[var(--border-primary)] bg-[var(--surface-tertiary)] shrink-0">
        {/* Row 1: Label + target selector + category + edit/preview toggle */}
        <div className="flex items-center justify-between px-4 py-2">
          <div className="flex items-center gap-3 min-w-0">
            <h2 className="text-xs font-semibold shrink-0">
              {isEditingExisting ? t("editWikiPage", "Edit Page") : t("newWikiPage")}
            </h2>
            {/* Editor target selector — inline dropdown */}
            <div ref={editorSelectorRef} className="relative shrink-0">
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
                      onTargetChange(null);
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
                            onTargetChange(proj.directory);
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
            {/* Category selector */}
            <div className="flex items-center gap-1.5 shrink-0">
              <label className="text-[10px] text-[var(--text-tertiary)] shrink-0">
                {t("category")}
              </label>
              <select
                value={editCategory}
                onChange={(e) => onCategoryChange(e.target.value)}
                className="px-2 py-0.5 text-[10px] bg-[var(--surface-secondary)] border border-[var(--border-primary)] rounded focus:outline-none focus:ring-1 focus:ring-[var(--brand-primary)]"
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
          </div>
        </div>
        {/* Row 2: Title input + save/cancel actions */}
        <div className="flex items-center gap-3 px-4 py-1.5 border-t border-[var(--border-primary)]">
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <label className="text-[10px] text-[var(--text-tertiary)] shrink-0">
              {t("title")}
            </label>
            <input
              type="text"
              value={editTitle}
              onChange={(e) => onTitleChange(e.target.value)}
              className="flex-1 min-w-0 px-2 py-1 text-xs bg-[var(--surface-secondary)] border border-[var(--border-primary)] rounded focus:outline-none focus:ring-1 focus:ring-[var(--brand-primary)]"
              placeholder={t("pageTitlePlaceholder")}
            />
          </div>
          {/* Save / Cancel actions */}
          <div className="flex items-center gap-1.5 shrink-0">
            {isEditingExisting ? (
              <div className="flex items-center gap-1">
                <button
                  onClick={onMerge}
                  disabled={isMerging || !editTitle.trim() || !editContent.trim()}
                  className="flex items-center gap-1 px-3 py-1 text-[11px] font-medium bg-[var(--brand-primary)] text-[var(--brand-primary-text)] rounded hover:opacity-90 transition-opacity disabled:opacity-50"
                  title={t("mergeSaveTooltip", "Merge new sections into existing page")}
                >
                  <GitMerge className="h-3 w-3" />
                  {isMerging ? t("saving") : t("mergeSave", "Merge & Save")}
                </button>
                <button
                  onClick={onWrite}
                  disabled={isWriting || !editTitle.trim() || !editContent.trim()}
                  className="px-3 py-1 text-[11px] font-medium text-[var(--text-secondary)] border border-[var(--border-primary)] rounded hover:bg-[var(--surface-secondary)] transition-colors disabled:opacity-50"
                  title={t("overwriteSaveTooltip", "Overwrite existing page completely")}
                >
                  {isWriting ? t("saving") : t("overwriteSave", "Overwrite")}
                </button>
              </div>
            ) : (
              <button
                onClick={onWrite}
                disabled={isWriting || !editTitle.trim() || !editContent.trim()}
                className="px-3 py-1 text-[11px] font-medium bg-[var(--brand-primary)] text-[var(--brand-primary-text)] rounded hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {isWriting ? t("saving") : t("save")}
              </button>
            )}
            <button
              onClick={onCancel}
              className="px-3 py-1 text-[11px] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
            >
              {t("cancel")}
            </button>
          </div>
        </div>
      </div>
      {/* Unified editor/preview area */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {editorMode === "edit" ? (
          <>
            {/* Frontmatter editor — collapsible YAML metadata fields */}
            <div className="px-4 pt-3 shrink-0">
              <FrontmatterEditor
                content={editContent}
                onChange={onContentChange}
              />
            </div>
            <textarea
              value={editContent}
              onChange={(e) => onContentChange(e.target.value)}
              className="flex-1 w-full p-6 text-sm font-mono bg-[var(--surface-secondary)] resize-none focus:outline-none"
              placeholder={t("pageContentPlaceholder")}
            />
          </>
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
  );
}
