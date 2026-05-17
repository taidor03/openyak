"use client";

import { useMemo, useRef, useEffect, useCallback, useState } from "react";
import {
  useInfiniteQuery,
  useQueryClient,
  keepPreviousData,
  type InfiniteData,
} from "@tanstack/react-query";
import { api } from "@/lib/api";
import { API, queryKeys } from "@/lib/constants";
import { mergeLatestPageIntoCache, refreshLatestMessages } from "@/lib/message-cache";
import type { PaginatedMessages } from "@/types/message";

const PAGE_SIZE = 50;

/**
 * Hook to fetch messages with reverse infinite scroll.
 *
 * Initial load fetches the latest page (offset=-1).
 * `fetchPreviousPage()` loads older messages.
 * Pages are stored oldest-first: pages[0] = oldest loaded, pages[last] = newest.
 *
 * ## Why we don't use useInfiniteQuery's built-in refetch
 *
 * useInfiniteQuery's refetch (triggered by refetchInterval, refetchOnWindowFocus,
 * or invalidateQueries) re-fetches ALL loaded pages sequentially using their
 * stored pageParams, then replaces the entire cache. When new messages have
 * arrived since the last fetch, the "latest page" param (a fixed offset) no
 * longer covers the newest messages — they silently vanish from the UI.
 *
 * Instead, we disable the built-in refetch triggers and use a custom polling
 * mechanism that only fetches the latest page (offset=-1) and merges it into
 * the existing cache (preserving older pages and appending new messages).
 * This is the same strategy used by the SSE DONE handler's finishFromDatabase().
 */
export function useMessages(sessionId: string | undefined) {
  const query = useInfiniteQuery({
    queryKey: queryKeys.messages.list(sessionId!),
    queryFn: ({ pageParam }: { pageParam: number }) =>
      api.get<PaginatedMessages>(API.MESSAGES.LIST(sessionId!, PAGE_SIZE, pageParam)),
    initialPageParam: -1 as number,
    getPreviousPageParam: (firstPage: PaginatedMessages) => {
      if (firstPage.offset <= 0) return undefined;
      return Math.max(0, firstPage.offset - PAGE_SIZE);
    },
    getNextPageParam: (): undefined => undefined,
    enabled: !!sessionId,
    // IMPORTANT: Disable useInfiniteQuery's built-in refetch mechanisms.
    // They re-fetch ALL pages using fixed offsets, which silently drops
    // the newest messages when total has increased since last fetch.
    // Instead, we use a custom polling mechanism below.
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    refetchInterval: false,
    staleTime: 60_000, // Treat data as fresh for 60s; initial load won't double-fetch
    placeholderData: keepPreviousData,
  });

  // Track the oldest loaded offset independently. getPreviousPageParam always
  // receives the first page, but when new messages arrive the first page is
  // refetched with a new offset — breaking the pagination chain. By tracking
  // the minimum offset across all pages we can always compute the correct
  // previous page offset regardless of refetches or page reordering.
  const [oldestOffset, setOldestOffset] = useState<number | undefined>(undefined);
  const queryClient = useQueryClient();

  useEffect(() => {
    const pages = query.data?.pages;
    if (pages && pages.length > 0 && query.data) {
      // Find the minimum offset across all pages — refetches can reorder pages
      // so we can't assume pages[0] or pages[last] is the oldest.
      let minOffset = pages[0].offset;
      for (let i = 1; i < pages.length; i++) {
        if (pages[i].offset < minOffset) {
          minOffset = pages[i].offset;
        }
      }
      setOldestOffset(minOffset);

      // CRITICAL FIX: Replace any -1 pageParams with actual offsets.
      // If pageParams contains -1, the backend re-interprets it as "latest page"
      // and recalculates offset = total - limit, causing offset drift and
      // missing messages when total has increased.
      const pageParams = query.data.pageParams as number[] | undefined;
      if (pageParams && pageParams.some((p) => p < 0)) {
        const resolvedPageParams = pageParams.map((p, i) =>
          p < 0 ? (pages[i]?.offset ?? 0) : p,
        );
        queryClient.setQueryData(queryKeys.messages.list(sessionId!), (old: any) => {
          if (!old) return old;
          return { ...old, pageParams: resolvedPageParams };
        });
      }
    }
  }, [query.data, queryClient, sessionId]);

  // ── Custom smart polling ────────────────────────────────────────────────
  // Fetches ONLY the latest page (offset=-1) and merges it into the cache.
  // This preserves older pages and correctly appends new messages — unlike
  // useInfiniteQuery's built-in refetch which replaces ALL pages.
  const pollingTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;

  useEffect(() => {
    // Clean up previous timer on sessionId change
    if (pollingTimerRef.current) {
      clearInterval(pollingTimerRef.current);
    }

    if (!sessionId) return;

    // Poll every 10s to catch new messages (channel messages, remote sessions)
    pollingTimerRef.current = setInterval(() => {
      refreshLatestMessages(sessionIdRef.current!, queryClient, PAGE_SIZE);
    }, 10_000);

    return () => {
      if (pollingTimerRef.current) {
        clearInterval(pollingTimerRef.current);
      }
    };
  }, [sessionId, queryClient]);

  // Window focus handler: smart refresh (not full refetch)
  useEffect(() => {
    if (!sessionId) return;

    const handleFocus = () => {
      refreshLatestMessages(sessionId!, queryClient, PAGE_SIZE);
    };

    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [sessionId, queryClient]);

  // ── Flatten & deduplicate ───────────────────────────────────────────────
  // Reverse infinite scroll can briefly overlap the latest page with older
  // pages after refetches.
  const messages = useMemo(() => {
    const byId = new Map<string, PaginatedMessages["messages"][number]>();
    const order: string[] = [];
    for (const message of query.data?.pages.flatMap((p) => p.messages) ?? []) {
      if (!byId.has(message.id)) {
        order.push(message.id);
      }
      // Keep the freshest copy if an overlapped page contains the same id.
      byId.set(message.id, message);
    }
    return order.map((id) => byId.get(id)!);
  }, [query.data]);

  const total = query.data?.pages[0]?.total ?? 0;

  // ── fetchPreviousPage override ──────────────────────────────────────────
  // Override fetchPreviousPage to use the tracked oldest offset instead of
  // getPreviousPageParam (which uses the first page's offset and breaks when
  // the first page is refetched with new messages).
  const [isFetchingPreviousPage, setIsFetchingPreviousPage] = useState(false);
  const fetchPreviousPage = useCallback(async () => {
    if (oldestOffset === undefined || oldestOffset <= 0 || !sessionId) return;
    const newOffset = Math.max(0, oldestOffset - PAGE_SIZE);

    setIsFetchingPreviousPage(true);
    try {
      // Manually fetch and prepend to avoid getPreviousPageParam's broken first-page dependency
      const data = await api.get<PaginatedMessages>(
        API.MESSAGES.LIST(sessionId, PAGE_SIZE, newOffset),
      );

      queryClient.setQueryData(queryKeys.messages.list(sessionId), (old: any) => {
        if (!old) return old;
        // Replace pageParams to ensure no -1 values remain (which cause offset
        // drift on refetch). Use the actual offset from the newest page.
        const resolvedPageParams = old.pageParams.map((p: number, i: number) =>
          p < 0 ? (old.pages[i]?.offset ?? 0) : p,
        );
        return {
          ...old,
          pages: [data, ...old.pages],
          pageParams: [newOffset, ...resolvedPageParams],
        };
      });
    } finally {
      setIsFetchingPreviousPage(false);
    }
  }, [sessionId, oldestOffset, queryClient]);

  const hasPreviousPage = oldestOffset !== undefined && oldestOffset > 0;

  return {
    ...query,
    messages,
    total,
    hasPreviousPage,
    isFetchingPreviousPage,
    fetchPreviousPage,
  };
}
