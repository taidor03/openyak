"use client";

import { useTranslation } from "react-i18next";
import { CheckCircle2 } from "lucide-react";
import { useBackendReady, type ConnectingStageKey } from "@/hooks/use-backend-ready";

// i18n keys → display strings (fallback values used when no translation loaded)
const STAGE_FALLBACKS: Record<ConnectingStageKey, string> = {
  starting: "正在启动",
  providers: "加载模型",
  plugins: "加载插件",
  mcp: "连接 MCP",
  almost: "即将就绪",
};

/**
 * Compact inline indicator placed in the chat header right side.
 *
 * Life-cycle:
 *   "connecting" → amber pulsing dot + time-based stage label
 *   "ready"      → green check + brief summary (providers / plugins / tools)
 *   "done"       → renders nothing
 *
 * Only meaningful in desktop mode; returns null immediately in web/remote mode.
 */
export function BackendReadyIndicator() {
  const { t } = useTranslation("chat");
  const { phase, connectingStage, info } = useBackendReady();

  if (phase === "done") return null;

  if (phase === "connecting") {
    const label =
      t(`backendStage_${connectingStage}`, {
        defaultValue: STAGE_FALLBACKS[connectingStage],
      }) + "…";

    return (
      <div className="flex items-center gap-1.5 select-none" aria-live="polite">
        {/* Pulsing amber dot */}
        <span className="relative flex h-2 w-2 shrink-0">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500" />
        </span>
        <span className="text-[11px] font-medium text-[var(--text-tertiary)] whitespace-nowrap animate-pulse">
          {label}
        </span>
      </div>
    );
  }

  // phase === "ready"
  const parts: string[] = [];
  if (info) {
    if (info.providers > 0)
      parts.push(
        t("backendReadyProviders", {
          count: info.providers,
          defaultValue: `${info.providers} 个提供商`,
        }),
      );
    if (info.plugins > 0)
      parts.push(
        t("backendReadyPlugins", {
          count: info.plugins,
          defaultValue: `${info.plugins} 个插件`,
        }),
      );
    if (info.tools > 0)
      parts.push(
        t("backendReadyTools", {
          count: info.tools,
          defaultValue: `${info.tools} 个工具`,
        }),
      );
  }

  return (
    <div
      className="flex items-center gap-1.5 select-none animate-in fade-in duration-300"
      aria-live="polite"
    >
      <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
      <span className="text-[11px] font-medium text-[var(--text-secondary)] whitespace-nowrap">
        {t("backendReady", { defaultValue: "就绪" })}
        {parts.length > 0 && (
          <span className="text-[var(--text-tertiary)]">
            {" · "}
            {parts.join(" · ")}
          </span>
        )}
      </span>
    </div>
  );
}
