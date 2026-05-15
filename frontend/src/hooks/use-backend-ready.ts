"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";
import { API, IS_DESKTOP } from "@/lib/constants";

export interface BackendStartupInfo {
  providers: number;
  plugins: number;
  mcp_connected: number;
  tools: number;
}

export type BackendReadyPhase = "connecting" | "ready" | "done";

// Time-bucketed stage labels shown while the backend is still starting up.
// These are intentionally approximate — real stages happen before HTTP is
// available; we just give the user a sense of progress based on elapsed time.
const CONNECTING_STAGES = [
  { after: 0, key: "starting" as const },
  { after: 5_000, key: "providers" as const },
  { after: 12_000, key: "plugins" as const },
  { after: 22_000, key: "mcp" as const },
  { after: 38_000, key: "almost" as const },
] as const;

export type ConnectingStageKey = (typeof CONNECTING_STAGES)[number]["key"];

export interface UseBackendReadyResult {
  phase: BackendReadyPhase;
  /** Approximate stage key while phase === "connecting" */
  connectingStage: ConnectingStageKey;
  /** Real info from the server, available once phase === "ready" */
  info: BackendStartupInfo | null;
}

/** How long to keep the "ready" banner visible before fading to "done". */
const READY_DISPLAY_MS = 3_500;
/** Interval between /startup-status poll attempts. */
const POLL_INTERVAL_MS = 1_500;

/**
 * Polls the backend /startup-status endpoint until it responds successfully,
 * then transitions through "connecting" → "ready" → "done".
 *
 * Only active in desktop mode where there is a meaningful startup lag.
 * In web/remote mode returns `{ phase: "done" }` immediately.
 */
export function useBackendReady(): UseBackendReadyResult {
  const [phase, setPhase] = useState<BackendReadyPhase>(
    IS_DESKTOP ? "connecting" : "done",
  );
  const [connectingStage, setConnectingStage] =
    useState<ConnectingStageKey>("starting");
  const [info, setInfo] = useState<BackendStartupInfo | null>(null);

  const startedAt = useRef(Date.now());
  const cancelled = useRef(false);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!IS_DESKTOP) return;

    cancelled.current = false;
    startedAt.current = Date.now();

    // Kick off time-based stage labels while we wait for the backend
    const scheduleStages = () => {
      CONNECTING_STAGES.forEach(({ after, key }) => {
        const delay = after - (Date.now() - startedAt.current);
        if (delay <= 0) {
          setConnectingStage(key);
          return;
        }
        const t = setTimeout(() => {
          if (!cancelled.current) setConnectingStage(key);
        }, delay);
        // Keep last timer for cleanup (only need to cancel the last few)
        stageTimer.current = t;
      });
    };
    scheduleStages();

    const poll = async () => {
      if (cancelled.current) return;
      try {
        const res = await apiFetch(API.STARTUP_STATUS, { timeoutMs: 2_500 });
        if (res.ok) {
          const data = (await res.json()) as BackendStartupInfo & {
            ready: boolean;
          };
          if (!cancelled.current) {
            setInfo(data);
            setPhase("ready");
            readyTimer.current = setTimeout(() => {
              if (!cancelled.current) setPhase("done");
            }, READY_DISPLAY_MS);
          }
          return; // stop polling
        }
      } catch {
        // backend not up yet — keep polling
      }
      if (!cancelled.current) {
        pollTimer.current = setTimeout(poll, POLL_INTERVAL_MS);
      }
    };

    poll();

    return () => {
      cancelled.current = true;
      if (pollTimer.current) clearTimeout(pollTimer.current);
      if (stageTimer.current) clearTimeout(stageTimer.current);
      if (readyTimer.current) clearTimeout(readyTimer.current);
    };
  }, []);

  return { phase, connectingStage, info };
}
