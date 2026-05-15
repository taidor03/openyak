/**
 * Thin localStorage cache for the session (conversation) list.
 *
 * The full flattened session list is written whenever a complete snapshot is
 * available (all infinite-query pages loaded).  On startup the cached data is
 * fed back as TanStack Query `initialData` so the sidebar renders immediately
 * without a loading skeleton.
 *
 * Sync contract
 * ─────────────
 * • staleTime = 0  → every mount triggers a background refetch immediately
 * • initialDataUpdatedAt   → lets TanStack decide the data is already stale,
 *   so the refetch starts at once while the UI shows cached rows
 * • All mutations already call invalidateQueries → cache is refreshed after
 *   any create / rename / pin / archive / delete operation
 */

import type { SessionResponse } from "@/types/session";

const SESSIONS_KEY = "xflow:sessions_v1";

interface CacheEntry<T> {
  data: T;
  updatedAt: number; // epoch ms
}

function readCache<T>(key: string): CacheEntry<T> | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as CacheEntry<T>;
  } catch {
    return null;
  }
}

function writeCache<T>(key: string, data: T): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(key, JSON.stringify({ data, updatedAt: Date.now() }));
  } catch {
    // quota exceeded or private-browsing — ignore silently
  }
}

export function readSessionsCache(): CacheEntry<SessionResponse[]> | null {
  return readCache<SessionResponse[]>(SESSIONS_KEY);
}

export function writeSessionsCache(data: SessionResponse[]): void {
  writeCache(SESSIONS_KEY, data);
}
