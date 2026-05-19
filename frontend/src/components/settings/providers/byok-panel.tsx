"use client";

import { useState, useMemo } from "react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Globe,
  KeyRound,
  Loader2,
  MapPin,
  Pencil,
  Trash2,
  X,
} from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/lib/api";
import { errorToMessage } from "@/lib/errors";
import { API, queryKeys } from "@/lib/constants";
import type { ProviderInfo } from "@/types/usage";

// ---------------------------------------------------------------------------
// Region classification — mirrors backend PROVIDER_CATALOG order
// ---------------------------------------------------------------------------

/** Chinese domestic providers */
const CHINA_PROVIDER_IDS = new Set([
  "qwen",
  "kimi",
  "minimax",
  "zhipu",
  "siliconflow",
  "xiaomi",
  "deepseek",
]);

/** Aggregator / proxy providers */
const AGGREGATOR_PROVIDER_IDS = new Set(["openrouter", "zen", "zen-go"]);

type RegionTab = "china" | "global";

interface ByokPanelProps {
  providers: ProviderInfo[] | undefined;
  onSaved: () => void;
}

export function ByokPanel({ providers, onSaved }: ByokPanelProps) {
  const { t } = useTranslation("settings");
  const qc = useQueryClient();

  const [activeTab, setActiveTab] = useState<RegionTab>("china");
  const [keyInputs, setKeyInputs] = useState<Record<string, string>>({});
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});
  const [mutatingId, setMutatingId] = useState<string | null>(null);
  const [providerError, setProviderError] = useState<Record<string, string>>(
    {},
  );
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const updateProviderKey = useMutation({
    mutationFn: async ({ id, apiKey }: { id: string; apiKey: string }) => {
      setMutatingId(id);
      return api.post<ProviderInfo>(API.CONFIG.PROVIDER_KEY(id), {
        api_key: apiKey,
      });
    },
    onSuccess: (_data, { id }) => {
      setKeyInputs((prev) => ({ ...prev, [id]: "" }));
      setProviderError((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setMutatingId(null);
      onSaved();
      qc.invalidateQueries({ queryKey: queryKeys.providers });
      qc.invalidateQueries({ queryKey: queryKeys.models });
    },
    onError: (err, { id }) => {
      setMutatingId(null);
      const detail = errorToMessage(err, t("failedSaveKey"));
      setProviderError((prev) => ({ ...prev, [id]: detail }));
    },
  });

  const deleteProviderKey = useMutation({
    mutationFn: async (id: string) => {
      setMutatingId(id);
      return api.delete<ProviderInfo>(API.CONFIG.PROVIDER_KEY(id));
    },
    onSuccess: () => {
      setMutatingId(null);
      qc.invalidateQueries({ queryKey: queryKeys.providers });
      qc.invalidateQueries({ queryKey: queryKeys.models });
    },
    onError: () => setMutatingId(null),
  });

  const toggleProvider = useMutation({
    mutationFn: (id: string) =>
      api.post<ProviderInfo>(API.CONFIG.PROVIDER_TOGGLE(id)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.providers });
      qc.invalidateQueries({ queryKey: queryKeys.models });
    },
  });

  const byokProviders = (providers ?? []).filter(
    (p) => !p.id.startsWith("custom_"),
  );

  // Split providers by region
  const chinaProviders = useMemo(
    () =>
      byokProviders.filter(
        (p) => CHINA_PROVIDER_IDS.has(p.id),
      ),
    [byokProviders],
  );

  const globalProviders = useMemo(
    () =>
      byokProviders.filter(
        (p) => !CHINA_PROVIDER_IDS.has(p.id),
      ),
    [byokProviders],
  );

  const activeProviders = activeTab === "china" ? chinaProviders : globalProviders;

  // Count configured providers per region
  const chinaConfigured = chinaProviders.filter((p) => p.is_configured).length;
  const globalConfigured = globalProviders.filter((p) => p.is_configured).length;

  return (
    <div className="space-y-4">
      <p className="text-xs text-[var(--text-secondary)]">{t("byokDesc")}</p>

      {/* Region Tabs */}
      <div className="flex gap-1 p-1 bg-[var(--surface-secondary)] rounded-lg">
        <button
          type="button"
          onClick={() => setActiveTab("china")}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex-1 justify-center ${
            activeTab === "china"
              ? "bg-[var(--surface-primary)] text-[var(--text-primary)] shadow-sm"
              : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          }`}
        >
          <MapPin className="h-3.5 w-3.5" />
          {t("regionChina", { defaultValue: "中国" })}
          {chinaConfigured > 0 && (
            <span className="text-[10px] text-[var(--color-success)] font-semibold">
              {chinaConfigured}
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("global")}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors flex-1 justify-center ${
            activeTab === "global"
              ? "bg-[var(--surface-primary)] text-[var(--text-primary)] shadow-sm"
              : "text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          }`}
        >
          <Globe className="h-3.5 w-3.5" />
          {t("regionGlobal", { defaultValue: "全球" })}
          {globalConfigured > 0 && (
            <span className="text-[10px] text-[var(--color-success)] font-semibold">
              {globalConfigured}
            </span>
          )}
        </button>
      </div>

      {/* Provider List */}
      <div className="space-y-2">
        {activeProviders.map((p) => (
          <ProviderCard
            key={p.id}
            provider={p}
            isExpanded={expandedId === p.id}
            onToggleExpand={() =>
              setExpandedId(expandedId === p.id ? null : p.id)
            }
            keyInput={keyInputs[p.id] ?? ""}
            onKeyChange={(val) =>
              setKeyInputs((prev) => ({ ...prev, [p.id]: val }))
            }
            showKey={showKey[p.id] ?? false}
            onToggleShowKey={() =>
              setShowKey((prev) => ({ ...prev, [p.id]: !prev[p.id] }))
            }
            isMutating={mutatingId === p.id}
            error={providerError[p.id]}
            onSave={() =>
              updateProviderKey.mutate({
                id: p.id,
                apiKey: keyInputs[p.id] ?? "",
              })
            }
            onDelete={() => deleteProviderKey.mutate(p.id)}
            onToggle={() => toggleProvider.mutate(p.id)}
            t={t}
          />
        ))}

        {activeProviders.length === 0 && (
          <div className="py-6 text-center text-xs text-[var(--text-tertiary)]">
            {t("noProvidersInRegion", { defaultValue: "此区域暂无服务商" })}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single Provider Card
// ---------------------------------------------------------------------------

function ProviderCard({
  provider: p,
  isExpanded,
  onToggleExpand,
  keyInput,
  onKeyChange,
  showKey,
  onToggleShowKey,
  isMutating,
  error,
  onSave,
  onDelete,
  onToggle,
  t,
}: {
  provider: ProviderInfo;
  isExpanded: boolean;
  onToggleExpand: () => void;
  keyInput: string;
  onKeyChange: (val: string) => void;
  showKey: boolean;
  onToggleShowKey: () => void;
  isMutating: boolean;
  error: string | undefined;
  onSave: () => void;
  onDelete: () => void;
  onToggle: () => void;
  t: (key: string, opts?: Record<string, unknown>) => string;
}) {
  const isConfigured = p.is_configured;
  const isActive = isConfigured && p.enabled;

  return (
    <div
      className={`rounded-lg border transition-all ${
        isConfigured && !p.enabled
          ? "border-[var(--border-default)] opacity-60"
          : isConfigured
            ? "border-[var(--color-success)]/30 bg-[var(--color-success)]/[0.02]"
            : "border-[var(--border-default)] hover:border-[var(--border-heavy)]"
      }`}
    >
      {/* Header row — always visible */}
      <button
        type="button"
        onClick={onToggleExpand}
        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left"
      >
        {/* Expand chevron */}
        {isExpanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-[var(--text-tertiary)] shrink-0" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-[var(--text-tertiary)] shrink-0" />
        )}

        {/* Provider icon */}
        <div
          className={`h-7 w-7 rounded-lg flex items-center justify-center shrink-0 ${
            isActive
              ? "bg-[var(--color-success)]/10 text-[var(--color-success)]"
              : isConfigured
                ? "bg-[var(--surface-tertiary)] text-[var(--text-tertiary)]"
                : "bg-[var(--surface-secondary)] text-[var(--text-tertiary)]"
          }`}
        >
          <KeyRound className="h-3.5 w-3.5" />
        </div>

        {/* Provider name + status */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-[var(--text-primary)] truncate">
              {p.name}
            </span>
            {isActive && (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-green-700 dark:text-green-400 bg-green-500/10 px-1.5 py-0.5 rounded shrink-0">
                <Check className="h-3 w-3" />
                {p.model_count > 0
                  ? `${p.model_count} ${t("providerModels")}`
                  : t("connected", { defaultValue: "已连接" })}
              </span>
            )}
            {isConfigured && !p.enabled && (
              <span className="inline-flex items-center text-[10px] font-medium text-[var(--text-tertiary)] bg-[var(--surface-tertiary)] px-1.5 py-0.5 rounded shrink-0">
                {t("disabled", { defaultValue: "已停用" })}
              </span>
            )}
            {isConfigured && p.enabled && p.status === "error" && (
              <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-red-600 dark:text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded shrink-0">
                {t("error", { defaultValue: "错误" })}
              </span>
            )}
          </div>
          {isConfigured && p.masked_key && (
            <p className="text-[10px] text-[var(--text-tertiary)] font-mono mt-0.5 truncate">
              {p.masked_key}
            </p>
          )}
        </div>

        {/* Toggle switch — only if configured */}
        {isConfigured && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${
              p.enabled
                ? "bg-[var(--color-success)]"
                : "bg-[var(--surface-tertiary)]"
            }`}
            title={p.enabled ? t("disableProvider") : t("enableProvider")}
          >
            <span
              className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow-sm transition-transform ${
                p.enabled ? "translate-x-3" : "translate-x-0"
              }`}
            />
          </button>
        )}
      </button>

      {/* Expanded body */}
      {isExpanded && (
        <div className="px-3 pb-3 pt-0 space-y-2.5">
          {/* Divider */}
          <div className="border-t border-[var(--border-primary)]" />

          {/* Configured: show current key + actions */}
          {isConfigured && (
            <div className="flex items-center gap-2">
              <Check className="h-3.5 w-3.5 text-[var(--color-success)] shrink-0" />
              <span className="text-xs text-[var(--text-secondary)] font-mono flex-1 truncate">
                {p.masked_key}
              </span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 text-[var(--text-tertiary)] hover:text-[var(--color-destructive)] hover:bg-[var(--color-destructive)]/10 shrink-0"
                onClick={onDelete}
                disabled={isMutating}
                title={t("removeApiKey")}
              >
                {isMutating ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Trash2 className="h-3 w-3" />
                )}
              </Button>
            </div>
          )}

          {/* Input for new / replacement key */}
          <div className="flex items-start gap-2">
            <div className="flex-1">
              <div className="relative">
                <Input
                  type={showKey ? "text" : "password"}
                  value={keyInput}
                  onChange={(e) => onKeyChange(e.target.value)}
                  placeholder={
                    isConfigured
                      ? t("replaceApiKeyPlaceholder", {
                          defaultValue: "输入新密钥以替换...",
                        })
                      : t(`providerKeyPlaceholder_${p.id}`, {
                          defaultValue: `${p.name} API key`,
                        })
                  }
                  className="pr-8 font-mono text-xs h-8"
                  autoComplete="one-time-code"
                  data-form-type="other"
                />
                <button
                  type="button"
                  onClick={onToggleShowKey}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]"
                >
                  {showKey ? (
                    <EyeOff className="h-3.5 w-3.5" />
                  ) : (
                    <Eye className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>
            <Button
              variant={isConfigured ? "outline" : "default"}
              size="sm"
              className="h-8 shrink-0"
              onClick={onSave}
              disabled={!keyInput.trim() || isMutating}
            >
              {isMutating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />
              ) : null}
              {isConfigured ? t("update", { defaultValue: "更新" }) : t("save")}
            </Button>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-1.5 text-xs text-[var(--color-destructive)]">
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
