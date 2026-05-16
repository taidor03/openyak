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

/** Ensures only one post-handshake chain runs. */
let _postHandshakeChainStarted = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/** Refreshed after backend confirms readiness (aligns persisted client cache). */
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

const defaultWebValue: UseBackendReadyResult = { phase: "done" };

const BackendReadyContext = createContext<UseBackendReadyResult>(defaultWebValue);

export function BackendReadyProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const [phase, setPhase] = useState<BackendReadyPhase>(() => {
    if (!IS_DESKTOP || _startupUiFinished) return "done";
    return "connecting";
  });

  const cancelled = useRef(false);

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

    // On mount the Tauri shell may have already finished backend startup
    // (health check passed + session token loaded).  Check via IPC first.
    const checkIpcReady = async (): Promise<boolean> => {
      try {
        return await desktopAPI.isBackendReady();
      } catch {
        return false;
      }
    };

    // Listen for the backend-ready event.  This fires once when the
    // backend finishes startup — the Tauri shell is the single source of
    // truth, no /livez polling needed.
    const unlisten = desktopAPI.onBackendReady((url: string) => {
      resetBackendUrl(url);
      resetBackendToken();

      if (cancelled.current || _postHandshakeChainStarted) return;
      _postHandshakeChainStarted = true;
      void runPostHandshake();
    });

    // Kick off: if the shell already marked the backend as ready, proceed
    // immediately; otherwise the event listener above handles it.
    void (async () => {
      const alreadyReady = await checkIpcReady();
      if (cancelled.current) return;
      if (alreadyReady && !_postHandshakeChainStarted) {
        _postHandshakeChainStarted = true;
        void runPostHandshake();
      }
    })();

    return () => {
      cancelled.current = true;
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