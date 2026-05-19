"use client";

import { useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Globe,
  Loader2,
  Pencil,
  Trash2,
  XCircle,
} from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";
import { errorToMessage } from "@/lib/errors";
import { API, queryKeys } from "@/lib/constants";
import type { LocalProviderStatus, ProviderInfo } from "@/types/usage";
import { CustomEndpointForm } from "@/components/settings/providers/custom-endpoint-form";

function extractApiDetail(err: unknown, fallback: string): string {
  if (!(err instanceof ApiError)) return fallback;
  return errorToMessage(err, fallback);
}

interface CustomEndpointPanelProps {
  providers: ProviderInfo[] | undefined;
  localStatus: LocalProviderStatus | undefined;
  /** Invoked after the legacy local provider is deleted, so parent can fall back. */
  onLocalDeleted: () => void;
}

export function CustomEndpointPanel({
  providers,
  localStatus,
  onLocalDeleted,
}: CustomEndpointPanelProps) {
  const { t } = useTranslation("settings");
  const qc = useQueryClient();

  const [mutatingId, setMutatingId] = useState<string | null>(null);
  const [providerError, setProviderError] = useState<Record<string, string>>(
    {},
  );

  // --- Edit mode state ---
  const [editingId, setEditingId] = useState<string | null>(null);

  const deleteCustomEndpoint = useMutation({
    mutationFn: async (id: string) => {
      setMutatingId(id);
      return api.delete<ProviderInfo>(API.CONFIG.CUSTOM_ENDPOINT_ITEM(id));
    },
    onSuccess: () => {
      setMutatingId(null);
      qc.invalidateQueries({ queryKey: queryKeys.providers });
      qc.invalidateQueries({ queryKey: queryKeys.models });
    },
    onError: () => setMutatingId(null),
  });

  const updateCustomEndpoint = useMutation({
    mutationFn: async ({
      id,
      enabled,
    }: {
      id: string;
      enabled?: boolean;
    }) => {
      setMutatingId(id);
      const body: Record<string, unknown> = {};
      if (enabled !== undefined) body.enabled = enabled;
      return api.patch<ProviderInfo>(
        API.CONFIG.CUSTOM_ENDPOINT_ITEM(id),
        body,
      );
    },
    onSuccess: () => {
      setMutatingId(null);
      qc.invalidateQueries({ queryKey: queryKeys.providers });
      qc.invalidateQueries({ queryKey: queryKeys.models });
    },
    onError: (err, { id }) => {
      setMutatingId(null);
      setProviderError((prev) => ({
        ...prev,
        [id]: extractApiDetail(err, "Failed to update endpoint"),
      }));
    },
  });

  const deleteLocalProvider = useMutation({
    mutationFn: () =>
      api.delete<LocalProviderStatus>(API.CONFIG.LOCAL_PROVIDER),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: queryKeys.localProvider });
      qc.invalidateQueries({ queryKey: queryKeys.models });
      setProviderError((prev) => {
        const next = { ...prev };
        delete next["local_legacy"];
        return next;
      });
      onLocalDeleted();
    },
    onError: (err) => {
      const detail = errorToMessage(err, t("failedSaveKey"));
      setProviderError((prev) => ({ ...prev, ["local_legacy"]: detail }));
    },
  });

  const customProviders =
    providers?.filter((p) => p.id.startsWith("custom_")) ?? [];
  const hasLegacyLocal = !!localStatus?.is_configured;

  return (
    <div className="space-y-6">
      <p className="text-xs text-[var(--text-secondary)]">
        {t("customEndpointDesc")}
      </p>

      {(hasLegacyLocal || customProviders.length > 0) && (
        <div className="space-y-3">
          <h4 className="text-xs font-semibold text-[var(--text-secondary)]">
            {t("savedEndpoints")}
          </h4>

          {hasLegacyLocal && (
            <div
              className={`p-3 border border-[var(--border-primary)] rounded-lg bg-[var(--surface-secondary)] ${localStatus?.status === "error" ? "border-[var(--color-destructive)]/40" : ""}`}
            >
              <div className="flex items-center justify-between">
                <div className="flex min-w-0 items-center gap-2 text-xs">
                  <span className="font-semibold">{t("localProvider")}</span>
                  <span className="text-[var(--text-secondary)] font-mono ml-2 text-ui-3xs bg-[var(--surface-primary)] px-2 py-0.5 rounded truncate">
                    {localStatus?.base_url}
                  </span>
                  {localStatus?.status === "error" && (
                    <span className="text-[var(--color-destructive)] text-ui-3xs">
                      {t("localProviderConnectError")}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-[var(--color-destructive)] hover:text-[var(--color-destructive)] hover:bg-[var(--color-destructive)]/10"
                    onClick={() => deleteLocalProvider.mutate()}
                    disabled={deleteLocalProvider.isPending}
                  >
                    {deleteLocalProvider.isPending ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Trash2 className="h-3 w-3" />
                    )}
                  </Button>
                </div>
              </div>
              {providerError["local_legacy"] && (
                <div className="mt-2 flex items-center gap-1.5 text-xs text-[var(--color-destructive)]">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  <span>{providerError["local_legacy"]}</span>
                </div>
              )}
            </div>
          )}

          {customProviders.map((p) => (
            <div
              key={p.id}
              className={`group rounded-lg border border-[var(--border-primary)] bg-[var(--surface-secondary)] transition-colors ${!p.enabled ? "opacity-50" : "hover:border-[var(--border-heavy)]"}`}
            >
              {/* Row 1: name + url + actions */}
              <div className="flex items-start justify-between px-3 pt-3 pb-1.5">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-[var(--text-primary)]">
                      {p.name || t("customEndpoint")}
                    </span>
                    {p.status === "connected" && p.enabled && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-green-700 dark:text-green-400 bg-green-500/10 px-1.5 py-0.5 rounded">
                        <CheckCircle2 className="h-3 w-3" />
                        {t("connected", { defaultValue: "已连接" })}
                      </span>
                    )}
                    {p.status === "error" && p.enabled && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] font-medium text-red-600 dark:text-red-400 bg-red-500/10 px-1.5 py-0.5 rounded">
                        <XCircle className="h-3 w-3" />
                        {t("error", { defaultValue: "错误" })}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <Globe className="h-3 w-3 text-[var(--text-tertiary)] shrink-0" />
                    <span className="text-[var(--text-secondary)] font-mono text-ui-3xs bg-[var(--surface-primary)] px-2 py-0.5 rounded truncate max-w-[320px]">
                      {p.base_url}
                    </span>
                    {p.masked_key && (
                      <span className="text-[var(--text-tertiary)] font-mono text-ui-3xs">
                        Key: {p.masked_key}
                      </span>
                    )}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                  {/* Enable/Disable toggle */}
                  <button
                    type="button"
                    onClick={() =>
                      updateCustomEndpoint.mutate({
                        id: p.id,
                        enabled: !p.enabled,
                      })
                    }
                    disabled={updateCustomEndpoint.isPending}
                    className={`relative inline-flex h-4 w-7 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors focus:outline-none ${
                      p.enabled
                        ? "bg-[var(--color-success)]"
                        : "bg-[var(--surface-tertiary)]"
                    }`}
                    title={
                      p.enabled
                        ? t("disableProvider")
                        : t("enableProvider")
                    }
                  >
                    <span
                      className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow-sm transition-transform ${
                        p.enabled ? "translate-x-3" : "translate-x-0"
                      }`}
                    />
                  </button>

                  {/* Edit button */}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 text-[var(--text-tertiary)] hover:text-[var(--text-primary)] hover:bg-[var(--surface-tertiary)]"
                    onClick={() =>
                      setEditingId(editingId === p.id ? null : p.id)
                    }
                    title={t("editEndpoint", { defaultValue: "编辑端点" })}
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>

                  {/* Delete button */}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0 text-[var(--text-tertiary)] hover:text-[var(--color-destructive)] hover:bg-[var(--color-destructive)]/10"
                    onClick={() => deleteCustomEndpoint.mutate(p.id)}
                    disabled={mutatingId === p.id}
                    title={t("deleteEndpoint", { defaultValue: "删除端点" })}
                  >
                    {mutatingId === p.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Trash2 className="h-3 w-3" />
                    )}
                  </Button>
                </div>
              </div>

              {/* Row 2: models */}
              <div className="px-3 pb-3">
                {p.model_ids && p.model_ids.length > 0 ? (
                  <div className="flex items-start gap-1.5 mt-1">
                    <span className="text-ui-3xs text-[var(--text-tertiary)] shrink-0 pt-0.5">
                      {t("pinnedModels")}:
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {p.model_ids.map((mid) => (
                        <span
                          key={mid}
                          className="inline-block text-ui-3xs font-mono text-[var(--text-secondary)] bg-[var(--surface-primary)] px-1.5 py-0.5 rounded"
                        >
                          {mid}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : (
                  <span className="text-ui-3xs text-[var(--text-tertiary)] mt-1 inline-block">
                    {t("modelsCount", { count: p.model_count })}
                  </span>
                )}
              </div>

              {/* Inline edit form (expandable) */}
              {editingId === p.id && (
                <div className="border-t border-[var(--border-primary)] px-3 py-3 bg-[var(--surface-tertiary)]/30 rounded-b-lg">
                  <EndpointEditForm
                    provider={p}
                    onClose={() => setEditingId(null)}
                  />
                </div>
              )}

              {providerError[p.id] && (
                <div className="px-3 pb-2 flex items-center gap-1.5 text-xs text-[var(--color-destructive)]">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  <span>{providerError[p.id]}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <CustomEndpointForm />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inline edit form for a saved custom endpoint
// ---------------------------------------------------------------------------

function EndpointEditForm({
  provider,
  onClose,
}: {
  provider: ProviderInfo;
  onClose: () => void;
}) {
  const { t } = useTranslation("settings");
  const qc = useQueryClient();

  const [name, setName] = useState(provider.name || "");
  const [baseUrl, setBaseUrl] = useState(provider.base_url || "");
  const [apiKey, setApiKey] = useState("");
  const [modelIds, setModelIds] = useState(
    (provider.model_ids ?? []).join(", "),
  );
  const [error, setError] = useState<string | null>(null);

  const saveEdit = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {};
      if (name.trim()) body.name = name.trim();
      if (baseUrl.trim()) body.base_url = baseUrl.trim();
      // Only send api_key if the user typed something new
      if (apiKey.trim()) body.api_key = apiKey.trim();
      const parsed = modelIds.trim()
        ? modelIds.split(",").map((s) => s.trim()).filter(Boolean)
        : [];
      body.model_ids = parsed;
      return api.patch<ProviderInfo>(
        API.CONFIG.CUSTOM_ENDPOINT_ITEM(provider.id),
        body,
      );
    },
    onSuccess: () => {
      setError(null);
      qc.invalidateQueries({ queryKey: queryKeys.providers });
      qc.invalidateQueries({ queryKey: queryKeys.models });
      onClose();
    },
    onError: (err) => {
      setError(extractApiDetail(err, t("failedSaveKey", { defaultValue: "保存失败" })));
    },
  });

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-[1fr_1fr] gap-2">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("endpointNamePlaceholder", { defaultValue: "端点名称" })}
          className="h-7 rounded-md border border-[var(--border-primary)] bg-[var(--surface-primary)] px-2 text-xs focus:outline-none focus:ring-1 focus:ring-[var(--brand-primary)]"
        />
        <input
          type="text"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder="Base URL"
          className="h-7 rounded-md border border-[var(--border-primary)] bg-[var(--surface-primary)] px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-[var(--brand-primary)]"
        />
      </div>
      <div className="grid grid-cols-[1fr_1fr] gap-2">
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder={provider.masked_key ? `当前: ${provider.masked_key}` : t("apiKeyPlaceholderOptional", { defaultValue: "API Key (可选)" })}
          className="h-7 rounded-md border border-[var(--border-primary)] bg-[var(--surface-primary)] px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-[var(--brand-primary)]"
        />
        <input
          type="text"
          value={modelIds}
          onChange={(e) => setModelIds(e.target.value)}
          placeholder={t("endpointModelIdsPlaceholder", { defaultValue: "指定模型ID (逗号分隔，留空自动发现)" })}
          className="h-7 rounded-md border border-[var(--border-primary)] bg-[var(--surface-primary)] px-2 text-xs font-mono focus:outline-none focus:ring-1 focus:ring-[var(--brand-primary)]"
        />
      </div>

      {error && (
        <div className="flex items-center gap-1.5 text-xs text-[var(--color-destructive)]">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex items-center justify-end gap-2 pt-0.5">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-xs"
          onClick={onClose}
          disabled={saveEdit.isPending}
        >
          {t("cancel", { defaultValue: "取消" })}
        </Button>
        <Button
          size="sm"
          className="h-6 text-xs gap-1"
          onClick={() => saveEdit.mutate()}
          disabled={saveEdit.isPending || !baseUrl.trim()}
        >
          {saveEdit.isPending && <Loader2 className="h-3 w-3 animate-spin" />}
          {t("saveChanges", { defaultValue: "保存修改" })}
        </Button>
      </div>
    </div>
  );
}
