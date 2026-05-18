/**
 * Session list local cache for sidebar instant rendering on cold start.
 *
 * Uses a separate localStorage key from TanStack Query persistence
 * because sessions need their own cache layer with simple read/write semantics.
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
