"use client";

import { useTranslation } from "react-i18next";
import { CheckCircle2 } from "lucide-react";
import { useBackendReady } from "@/hooks/use-backend-ready";
import { IS_DESKTOP } from "@/lib/constants";

/**
 * Chat header startup hints (desktop only).
 *
 * While the backend HTTP server is not up yet: amber dot + 「正在启动服务」.
 * As soon as GET /livez succeeds (public, no Bearer token), show 「后台服务启动成功」
 * → cache refresh → 「本地缓存已同步」 → hidden.
 */
export function BackendReadyIndicator() {
  const { t } = useTranslation("chat");
  const { phase } = useBackendReady();

  if (!IS_DESKTOP || phase === "done") return null;

  if (phase === "connecting") {
    return (
      <div className="flex items-center gap-1.5 select-none" aria-live="polite">
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
        </span>
        <span className="text-[11px] font-medium text-[var(--text-tertiary)] whitespace-nowrap animate-pulse">
          {t("backendStartingService", { defaultValue: "正在启动服务" })}
        </span>
      </div>
    );
  }

  if (phase === "syncing") {
    return null;
  }

  const message =
    phase === "backend_ok"
      ? t("backendServiceStarted", { defaultValue: "后台服务启动成功" })
      : t("localCacheSynced", { defaultValue: "本地缓存已同步" });

  return (
    <div
      className="flex items-center gap-1.5 select-none animate-in fade-in duration-300"
      aria-live="polite"
    >
      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
      <span className="text-[11px] font-medium text-[var(--text-secondary)] whitespace-nowrap">
        {message}
      </span>
    </div>
  );
}
