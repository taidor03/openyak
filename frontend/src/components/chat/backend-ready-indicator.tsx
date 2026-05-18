"use client";

import { CheckCircle2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useBackendReady } from "@/components/providers/backend-ready-provider";
import { IS_DESKTOP } from "@/lib/constants";

export function BackendReadyIndicator() {
  const { t } = useTranslation("chat");
  const { phase } = useBackendReady();

  if (!IS_DESKTOP || phase === "done") return null;

  // State 1: Starting — amber pulse dot
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

  // syncing phase — hidden
  if (phase === "syncing") return null;

  // State 2: Ready/Synced — green checkmark
  const message =
    phase === "backend_ok"
      ? t("backendServiceStarted", { defaultValue: "后台服务启动成功" })
      : t("localCacheSynced", { defaultValue: "本地缓存已同步" });

  return (
    <div className="flex items-center gap-1.5 select-none animate-in fade-in duration-300" aria-live="polite">
      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
      <span className="text-[11px] font-medium text-[var(--text-secondary)] whitespace-nowrap">
        {message}
      </span>
    </div>
  );
}
