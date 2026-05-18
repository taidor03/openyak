/**
 * TanStack Query persistence layer for cold-start instant display.
 *
 * PERSISTED queries (shown from cache on cold start):
 *   - agents list, connectors list, plugins list, skills list, mcp config
 *
 * NOT persisted (always fetched fresh):
 *   - chat messages, usage stats, SSE state, sessions (has its own cache)
 *
 * A query opts-in by setting `meta: { persist: true }` in useQuery options.
 */

import { type DehydratedState } from "@tanstack/react-query";
import { createSyncStoragePersister } from "@tanstack/query-sync-storage-persister";

export const PERSIST_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h

const STORAGE_KEY = "openyak_query_cache";

export const localStoragePersister = (() => {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return createSyncStoragePersister({
      storage: window.localStorage,
      key: STORAGE_KEY,
      throttleTime: 1_000, // Throttle writes so rapid invalidations don't flood storage
    });
  } catch {
    return null;
  }
})();

export function shouldPersistQuery(query: { meta?: Record<string, unknown> }): boolean {
  return query.meta?.persist === true;
}

export const dehydrateOptions: {
  shouldDehydrateQuery: (q: DehydratedState["queries"][number]) => boolean;
} = {
  shouldDehydrateQuery: (query) =>
    shouldPersistQuery(query) && query.state.status === "success",
};
