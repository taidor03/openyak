"use client";

import { useState, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Pencil, Trash2, ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { WikiMarkdown } from "./wiki-markdown";
import {
  type WikiPageDetail,
  CATEGORY_I18N_KEYS,
  parseFrontmatter,
  formatFmValue,
} from "./wiki-types";

// ── Frontmatter Display Panel (view mode) ──────────────────────────────────

interface FrontmatterPanelProps {
  content: string;
}

function FrontmatterPanel({ content }: FrontmatterPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const fm = useMemo(() => parseFrontmatter(content), [content]);

  const displayFields = ["category", "type", "tags", "sources", "related", "created", "updated"];
  const hasMetadata = displayFields.some((k) => fm[k] && fm[k] !== "[]");

  if (!hasMetadata) return null;

  return (
    <div className="mb-4 border border-[var(--border-primary)] rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-3 py-1.5 text-xs bg-[var(--surface-secondary)] hover:bg-[var(--surface-tertiary)] transition-colors"
      >
        <span className="font-medium">Metadata</span>
        <ChevronDown
          className={cn(
            "h-3 w-3 text-[var(--text-tertiary)] transition-transform",
            expanded && "rotate-180",
          )}
        />
      </button>
      {expanded && (
        <div className="px-3 py-2 space-y-1">
          {displayFields.map((key) => {
            const value = fm[key];
            if (!value || value === "[]") return null;
            return (
              <div key={key} className="flex items-start gap-2 text-[11px]">
                <span className="shrink-0 text-[var(--text-tertiary)] min-w-[60px] text-right font-medium">
                  {key}
                </span>
                <span className="text-[var(--text-secondary)] break-all">
                  {formatFmValue(key, value)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Wiki Page View ────────────────────────────────────────────────────────

interface WikiPageViewProps {
  page: WikiPageDetail;
  onEdit: () => void;
  onDelete: (pageId: string) => void;
  onWikilinkClick: (target: string) => void;
}

export function WikiPageView({ page, onEdit, onDelete, onWikilinkClick }: WikiPageViewProps) {
  const { t } = useTranslation("common");

  const categoryName = (cat: string) => {
    const key = CATEGORY_I18N_KEYS[cat];
    return key ? t(key, cat) : cat;
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="p-6 max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold">{page.title}</h2>
            <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
              {categoryName(page.category)} · {page.page_id}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={onEdit}
              className="p-1.5 text-[var(--text-tertiary)] hover:text-[var(--brand-primary)] transition-colors"
              title={t("editPage", "Edit page")}
            >
              <Pencil className="h-4 w-4" />
            </button>
            <button
              onClick={() => {
                if (window.confirm(t("confirmDeletePage"))) {
                  onDelete(page.page_id);
                }
              }}
              className="p-1.5 text-[var(--text-tertiary)] hover:text-red-500 transition-colors"
              title={t("deletePage")}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
        {/* Frontmatter metadata display */}
        <FrontmatterPanel content={page.content} />
        <WikiMarkdown
          content={page.content}
          onWikilinkClick={onWikilinkClick}
        />
      </div>
    </div>
  );
}
