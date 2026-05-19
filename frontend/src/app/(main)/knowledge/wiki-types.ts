/**
 * Shared types, constants, and helpers for the Wiki Knowledge Center.
 *
 * Extracted from content.tsx to avoid circular imports between
 * sub-components.
 */

// ── Types ──────────────────────────────────────────────────────────────────

export interface WikiPage {
  page_id: string;
  title: string;
  category: string;
  path: string;
}

export interface WikiPageDetail {
  page_id: string;
  title: string;
  content: string;
  category: string;
  path: string;
}

export interface WikiStatus {
  initialized: boolean;
  wiki_root: string;
  total_pages: number;
  categories: Record<string, number>;
  has_index: boolean;
}

export interface SearchResult {
  page_id: string;
  title: string;
  category: string;
  snippet: string;
  title_match: boolean;
  score: number;
}

/** Selected wiki scope: null = global, string = project directory path */
export type WikiTarget = string | null;

// ── Constants ──────────────────────────────────────────────────────────────

export const CATEGORIES = [
  "entities",
  "concepts",
  "sources",
  "synthesis",
  "comparison",
  "queries",
] as const;

export const CATEGORY_ICONS: Record<string, string> = {
  entities: "👤",
  concepts: "💡",
  sources: "📄",
  synthesis: "🔗",
  comparison: "⚖️",
  queries: "🔍",
};

export const CATEGORY_I18N_KEYS: Record<string, string> = {
  entities: "catEntities",
  concepts: "catConcepts",
  sources: "catSources",
  synthesis: "catSynthesis",
  comparison: "catComparison",
  queries: "catQueries",
};

export const SEARCH_DEBOUNCE_MS = 300;

// ── Helpers ────────────────────────────────────────────────────────────────

/** Shorten a filesystem path for display (replace home dir with ~) */
export function shortenPath(path: string): string {
  return path
    .replace(/^\/Users\/[^/]+/, "~")
    .replace(/^\/home\/[^/]+/, "~");
}

/** Strip YAML frontmatter from markdown content for preview display */
export function stripFrontmatter(content: string): string {
  return content.replace(/^---\n[\s\S]*?---\n/, "");
}

/** Parse YAML frontmatter from markdown content into a simple key→value map. */
export function parseFrontmatter(content: string): Record<string, string> {
  const fmMatch = content.match(/^---\n([\s\S]*?)---\n/);
  if (!fmMatch) return {};
  const fm = fmMatch[1];
  const result: Record<string, string> = {};
  for (const line of fm.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (key) result[key] = value;
  }
  return result;
}

/** Parse a YAML list field like `tags: ["a", "b"]` or `tags: []` into a string array. */
export function parseYamlList(value: string): string[] {
  if (!value || value === "[]") return [];
  const bracketMatch = value.match(/^\[([\s\S]*)\]$/);
  if (bracketMatch) {
    const inner = bracketMatch[1].trim();
    if (!inner) return [];
    return inner
      .split(/,\s*/)
      .map((s) => s.trim().replace(/^"/, "").replace(/"$/, ""))
      .filter(Boolean);
  }
  return value.split(/,\s*/).map((s) => s.trim()).filter(Boolean);
}

/** Serialize a string array back to YAML list notation: ["a", "b"]. */
export function toYamlList(items: string[]): string {
  if (items.length === 0) return "[]";
  return `[${items.map((s) => `"${s}"`).join(", ")}]`;
}

/** Format a frontmatter value for display (human-readable). */
export function formatFmValue(key: string, value: string): string {
  if (key === "created" || key === "updated") {
    try {
      return new Date(value).toLocaleString();
    } catch {
      return value;
    }
  }
  return value
    .replace(/^\["?/, "")
    .replace(/"?\]$/, "")
    .replace(/",\s*"/g, ", ");
}

/** Fields that are displayed as comma-separated input (array fields). */
export const ARRAY_FIELDS = ["tags", "related", "sources"];
