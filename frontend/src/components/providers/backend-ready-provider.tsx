"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  API,
  getBackendUrl,
  IS_DESKTOP,
  queryKeys,
  resetBackendUrl,
  resetBackendToken,
} from "@/lib/constants";
import { desktopAPI } from "@/lib/tauri-api";

export type BackendReadyPhase =
  | "connecting"
  | "backend_ok"
  | "syncing"
  | "synced"
  | "done";

/** After both startup banners finish, subsequent mounts stay idle. */
let _startupUiFinished = false;

/** Ensures only one post-handshake chain runs (handshake may be polled more than once). */
let _postHandshakeChainStarted = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Refreshed after /startup-status succeeds (aligns persisted client cache with backend). */
const STARTUP_SYNC_QUERY_KEYS = [
  queryKeys.connectors,
  queryKeys.mcpConfig,
  queryKeys.plugins.all,
  queryKeys.skills,
  queryKeys.agents,
  queryKeys.models,
  queryKeys.providers,
  queryKeys.tools,
] as const;

export interface UseBackendReadyResult {
  phase: BackendReadyPhase;
}

const BACKEND_OK_DISPLAY_MS = 1_000;
const CACHE_SYNCED_DISPLAY_MS = 1_500;
/** Retry quickly — `/livez` is cheap and needs no Bearer (unlike `/startup-status`). */
const POLL_INTERVAL_MS = 350;
const LIVEZ_FETCH_TIMEOUT_MS = 900;

const defaultWebValue: UseBackendReadyResult = { phase: "done" };

const BackendReadyContext = createContext<UseBackendReadyResult>(defaultWebValue);

export function BackendReadyProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const [phase, setPhase] = useState<BackendReadyPhase>(() => {
    if (!IS_DESKTOP || _startupUiFinished) return "done";
    return "connecting";
  });

  const cancelled = useRef(false);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!IS_DESKTOP) return;
    if (_startupUiFinished) return;

    cancelled.current = false;

    const runPostHandshake = async () => {
      setPhase("backend_ok");

      await sleep(BACKEND_OK_DISPLAY_MS);
      if (cancelled.current) return;

      setPhase("syncing");

      try {
        await Promise.all(
          STARTUP_SYNC_QUERY_KEYS.map((queryKey) =>
            queryClient.invalidateQueries({ queryKey, refetchType: "all" }),
          ),
        );
      } catch {
        /* still show the synced banner — best-effort refresh */
      }
      if (cancelled.current) return;

      setPhase("synced");

      await sleep(CACHE_SYNCED_DISPLAY_MS);
      if (cancelled.current) return;

      setPhase("done");
      _startupUiFinished = true;
    };

    // In desktop mode the shell may have already confirmed the backend is
    // ready (health check + token loaded) before the frontend even mounts.
    // Check via IPC first — if ready, skip the /livez poll entirely.
    const checkIpcReady = async (): Promise<boolean> => {
      try {
        return await desktopAPI.isBackendReady();
      } catch {
        return false;
      }
    };

    // Listen for the backend-ready event from the shell.  This fires once
    // when the backend finishes startup; if it arrives before or during
    // the /livez poll we transition immediately.
    const unlisten = desktopAPI.onBackendReady((url: string) => {
      // Cache the URL so subsequent getBackendUrl() calls resolve instantly.
      resetBackendUrl(url);
      // Token may have rotated — clear stale cache.
      resetBackendToken();

      if (cancelled.current || _postHandshakeChainStarted) return;
      _postHandshakeChainStarted = true;
      if (pollTimer.current) {
        clearTimeout(pollTimer.current);
        pollTimer.current = null;
      }
      void runPostHandshake();
    });

    const poll = async () => {
      if (cancelled.current) return;
      try {
        const base = await getBackendUrl();
        const url = `${base.replace(/\/$/, "")}${API.LIVEZ}`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), LIVEZ_FETCH_TIMEOUT_MS);
        const res = await fetch(url, {
          method: "GET",
          cache: "no-store",
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        if (res.ok) {
          if (pollTimer.current) {
            clearTimeout(pollTimer.current);
            pollTimer.current = null;
          }
          if (_postHandshakeChainStarted) return;
          _postHandshakeChainStarted = true;
          if (cancelled.current) return;
          void runPostHandshake();
          return;
        }
      } catch {
        // ECONNREFUSED, timeout, or getBackendUrl not ready — keep polling
      }
      if (!cancelled.current) {
        pollTimer.current = setTimeout(poll, POLL_INTERVAL_MS);
      }
    };

    // Kick off: check IPC first, fall back to /livez polling.
    void (async () => {
      const alreadyReady = await checkIpcReady();
      if (cancelled.current) return;
      if (alreadyReady && !_postHandshakeChainStarted) {
        _postHandshakeChainStarted = true;
        void runPostHandshake();
        return;
      }
      // Not ready yet (or IPC check failed) — poll /livez.
      void poll();
    })();

    return () => {
      cancelled.current = true;
      if (pollTimer.current) clearTimeout(pollTimer.current);
      if (!_startupUiFinished) {
        _postHandshakeChainStarted = false;
      }
      unlisten();
    };
  }, [queryClient]);

  const value = useMemo(() => ({ phase }), [phase]);

  return (
    <BackendReadyContext.Provider value={value}>{children}</BackendReadyContext.Provider>
  );
}

export function useBackendReady(): UseBackendReadyResult {
  return useContext(BackendReadyContext);
}