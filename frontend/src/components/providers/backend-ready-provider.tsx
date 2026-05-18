"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { IS_DESKTOP } from "@/lib/constants";
import { desktopAPI } from "@/lib/tauri-api";

type Phase = "connecting" | "backend_ok" | "syncing" | "synced" | "done";

interface BackendReadyState {
  phase: Phase;
}

const BackendReadyContext = createContext<BackendReadyState>({ phase: "connecting" });

export function useBackendReady() {
  return useContext(BackendReadyContext);
}

const BACKEND_OK_DISPLAY_MS = 1_000;
const CACHE_SYNCED_DISPLAY_MS = 1_500;

export function BackendReadyProvider({ children }: { children: React.ReactNode }) {
  const [phase, setPhase] = useState<Phase>("connecting");

  useEffect(() => {
    // In non-desktop mode, skip directly to done
    if (!IS_DESKTOP) {
      setPhase("done");
      return;
    }

    let mounted = true;

    const setBackendReady = () => {
      if (!mounted) return;
      setPhase("backend_ok");
      // Phase: backend_ok → syncing → synced → done
      setTimeout(() => {
        if (!mounted) return;
        setPhase("syncing");
        // Allow a tick for cache restoration to begin
        setTimeout(() => {
          if (!mounted) return;
          setPhase("synced");
          setTimeout(() => {
            if (!mounted) return;
            setPhase("done");
          }, CACHE_SYNCED_DISPLAY_MS);
        }, 100);
      }, BACKEND_OK_DISPLAY_MS);
    };

    // 1. Check IPC ready status
    const checkIpcReady = async () => {
      try {
        const ready = await desktopAPI.isBackendReady();
        if (ready) setBackendReady();
      } catch {
        // Not in Tauri or not available
      }
    };

    // 2. Listen for Rust backend event
    const unlisten = desktopAPI.onBackendReady(() => {
      setBackendReady();
    });

    checkIpcReady();

    return () => {
      mounted = false;
      unlisten();
    };
  }, []);

  return (
    <BackendReadyContext.Provider value={{ phase }}>
      {children}
    </BackendReadyContext.Provider>
  );
}
