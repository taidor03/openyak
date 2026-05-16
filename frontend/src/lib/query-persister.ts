/**
 * TanStack Query persistence layer.
 *
 * Selectively persists slow / structural queries to localStorage so the UI
 * can show last-known state immediately on startup while the backend is
 * still initialising.
 *
 * PERSISTED queries (shown from cache on cold start):
 *   connectors, mcpConfig, plugins, agents, models, providers, skills
 *
 * NOT persisted (always fetched fresh):
 *   sessions, messages, usage, ollamaStatus, rapid-mlx, channels, …
 *
 * A query opts-in by setting `meta: { persist: true }` in useQuery options.
 * The dehydrate filter below enforces this contract.
 */

import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";
import type { DehydratedState } from "@tanstack/react-query";

const STORAGE_KEY = "openyak_query_cache_v1";

/** 24 hours – stale cache older than this is discarded on hydration */
export const PERSIST_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * localStorage persister.
 * Gracefully degrades to a no-op when localStorage is unavailable
 * (SSR / private browsing / storage quota exceeded).
 */
export const localStoragePersister = (() => {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return createSyncStoragePersister({
      storage: window.localStorage,
      key: STORAGE_KEY,
      // Throttle writes so rapid cache invalidations don't flood storage
      throttleTime: 1_000,
    });
  } catch {
    return null;
  }
})();

/**
 * Only dehydrate (serialise) queries that have explicitly opted in via
 * `meta: { persist: true }`.  This prevents sensitive or ephemeral data
 * (chat messages, usage stats, SSE state) from leaking into localStorage.
 */
export function shouldPersistQuery(query: { meta?: Record<string, unknown> }): boolean {
  return query.meta?.persist === true;
}

/**
 * Dehydrate options passed to `PersistQueryClientProvider`.
 * Filters the snapshot to persisted queries only.
 */
export const dehydrateOptions: {
  shouldDehydrateQuery: (q: DehydratedState["queries"][number]) => boolean;
} = {
  shouldDehydrateQuery: (query) =>
    shouldPersistQuery(query) && query.state.status === "success",
};
