/**
 * Shared utilities for message cache management.
 *
 * These functions ensure that refreshing the message list never drops
 * older pages from the InfiniteData cache — a critical invariant that
 * useInfiniteQuery's built-in refetch does NOT guarantee.
 */

import type { InfiniteData } from "@tanstack/react-query";
import type { PaginatedMessages } from "@/types/message";

/**
 * Merge a freshly-fetched latest page into the existing InfiniteData cache
 * WITHOUT dropping any previously-loaded older pages.
 *
 * Strategy:
 * - For the last (newest) page in the cache, replace existing messages with
 *   fresher copies and append any brand-new messages.
 * - All older pages are preserved as-is.
 *
 * This is the same merge logic that should be used everywhere messages are
 * refreshed — polling, window focus, SSE completion, and error recovery.
 */
export function mergeLatestPageIntoCache(
  latestPage: PaginatedMessages,
  old: InfiniteData<PaginatedMessages> | undefined,
): InfiniteData<PaginatedMessages> {
  if (!old || old.pages.length === 0) {
    return { pages: [latestPage], pageParams: [-1] };
  }
  const lastOldPage = old.pages[old.pages.length - 1];
  const existingById = new Map(
    lastOldPage.messages.map((m) => [m.id, m]),
  );
  const mergedMessages: typeof lastOldPage.messages = [];

  // Replace old messages with fresher copies (parts may have been
  // appended server-side).
  for (const oldMsg of lastOldPage.messages) {
    const fresh = latestPage.messages.find((m) => m.id === oldMsg.id);
    mergedMessages.push(fresh ?? oldMsg);
  }

  // Append brand-new messages not present in the old last page.
  for (const newMsg of latestPage.messages) {
    if (!existingById.has(newMsg.id)) {
      mergedMessages.push(newMsg);
    }
  }

  const mergedLastPage: PaginatedMessages = {
    total: latestPage.total,
    offset: lastOldPage.offset,
    messages: mergedMessages,
  };

  return {
    pages: [...old.pages.slice(0, -1), mergedLastPage],
    pageParams: [...old.pageParams],
  };
}

/**
 * Fetch the latest message page and merge it into the cache.
 *
 * This is a safe alternative to `invalidateQueries` for infinite queries —
 * it only fetches the newest page (offset=-1) and merges it, preserving
 * all previously loaded older pages. `invalidateQueries` would re-fetch
 * ALL pages and silently drop messages that shifted out of the latest page's
 * fixed-offset window.
 */
export async function refreshLatestMessages(
  sessionId: string,
  queryClient: import("@tanstack/react-query").QueryClient,
  pageSize: number = 50,
): Promise<void> {
  const { API, queryKeys } = await import("@/lib/constants");
  const { api } = await import("@/lib/api");

  try {
    const latestPage = await api.get<PaginatedMessages>(
      API.MESSAGES.LIST(sessionId, pageSize, -1),
    );
    await queryClient.cancelQueries({ queryKey: queryKeys.messages.list(sessionId) });
    queryClient.setQueryData<InfiniteData<PaginatedMessages>>(
      queryKeys.messages.list(sessionId),
      (old) => mergeLatestPageIntoCache(latestPage, old),
    );
  } catch {
    // Non-critical: refresh failure should not disrupt the UI
  }
}
