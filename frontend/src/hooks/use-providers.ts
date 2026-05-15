"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { API, queryKeys } from "@/lib/constants";
import { readProvidersCache, writeProvidersCache } from "@/lib/provider-cache";
import type { ProviderInfo } from "@/types/usage";

/**
 * Fetches the list of configured providers.
 *
 * Uses a localStorage cache as `initialData` so the UI renders immediately
 * on startup.  The cache is refreshed automatically whenever the query
 * returns fresh data from the backend.
 */
export function useProviders() {
  const cache = readProvidersCache();
  return useQuery({
    queryKey: queryKeys.providers,
    queryFn: async () => {
      const data = await api.get<ProviderInfo[]>(API.CONFIG.PROVIDERS);
      writeProvidersCache(data);
      return data;
    },
    initialData: cache?.data,
    initialDataUpdatedAt: cache?.updatedAt,
    staleTime: 30 * 1000, // 30 s — stay fresh enough that mutations feel instant
  });
}

/**
 * Helper to invalidate providers + clear the cache so the next read is fresh.
 * Call this after any mutation that changes provider state.
 */
export function useInvalidateProviders() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: queryKeys.providers });
  };
}
