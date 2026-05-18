"use client";

import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { API, queryKeys } from "@/lib/constants";
import { readModelsCache, writeModelsCache } from "@/lib/provider-cache";
import type { ModelInfo } from "@/types/model";

const MODEL_LOAD_TIMEOUT_MS = 60_000;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

export function useModels() {
  // Read cached models for instant rendering on cold start
  const cached = typeof window !== "undefined" ? readModelsCache() : null;

  const query = useQuery({
    queryKey: queryKeys.models,
    queryFn: async () => {
      return withTimeout(
        (async () => {
          return api.get<ModelInfo[]>(API.MODELS, {
            timeoutMs: MODEL_LOAD_TIMEOUT_MS,
          });
        })(),
        MODEL_LOAD_TIMEOUT_MS,
        "Timed out loading models. Check your provider connection, firewall, or VPN settings.",
      );
    },
    initialData: cached && cached.data.length > 0 ? cached.data : undefined,
    staleTime: 0, // Always refetch for fresh data after cache renders
    retry: false,
  });

  // Write cache on successful fetch
  useEffect(() => {
    if (query.data && query.data.length > 0 && !query.isFetching) {
      writeModelsCache(query.data);
    }
  }, [query.data, query.isFetching]);

  return query;
}
