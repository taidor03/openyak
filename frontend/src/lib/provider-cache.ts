/**
 * Thin localStorage cache for provider and model lists.
 *
 * Data is written whenever a successful API response arrives and read back
 * as TanStack Query `initialData` so the UI renders immediately on startup
 * without a loading flash.  The `updatedAt` timestamp lets TanStack Query
 * evaluate staleness correctly via `initialDataUpdatedAt`.
 */

import type { ProviderInfo } from "@/types/usage";
import type { ModelInfo } from "@/types/model";

const PROVIDERS_KEY = "xflow:providers_v1";
const MODELS_KEY = "xflow:models_v1";

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
    const entry: CacheEntry<T> = { data, updatedAt: Date.now() };
    localStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // storage quota exceeded or private-browsing restrictions — ignore silently
  }
}

export function readProvidersCache(): CacheEntry<ProviderInfo[]> | null {
  return readCache<ProviderInfo[]>(PROVIDERS_KEY);
}

export function writeProvidersCache(data: ProviderInfo[]): void {
  writeCache(PROVIDERS_KEY, data);
}

export function readModelsCache(): CacheEntry<ModelInfo[]> | null {
  return readCache<ModelInfo[]>(MODELS_KEY);
}

export function writeModelsCache(data: ModelInfo[]): void {
  writeCache(MODELS_KEY, data);
}
