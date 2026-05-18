"use client";

import { useEffect, useState } from "react";
import {
  Loader2,
  Pencil,
  Plus,
  RotateCw,
  Trash2,
  Unplug,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { queryKeys } from "@/lib/constants";
import {
  useConnectors,
  useConnectorToggle,
  useConnectorReconnect,
} from "@/hooks/use-connectors";
import { useMcpConfig, useUpdateMcpConfig } from "@/hooks/use-mcp-config";
import type { ConnectorInfo, McpServerConfig } from "@/types/connectors";

/* ------------------------------------------------------------------ */
/* Status dot colors                                                   */
/* ------------------------------------------------------------------ */

const STATUS_COLORS: Record<string, string> = {
  connected: "bg-emerald-500",
  needs_auth: "bg-amber-500",
  failed: "bg-red-500",
  disconnected: "bg-[var(--text-tertiary)]",
  disabled: "bg-[var(--text-tertiary)]",
};

/* ------------------------------------------------------------------ */
/* Main MCP Tab Component                                              */
/* ------------------------------------------------------------------ */

export function McpTab() {
  const { t } = useTranslation("settings");
  const { data: mcpConfigData, isLoading: configLoading } = useMcpConfig();
  const { data: connectorsData } = useConnectors();
  const [showAdd, setShowAdd] = useState(false);

  const userConfig = mcpConfigData?.config ?? {};
  const connectorsMap = connectorsData?.connectors ?? {};

  const entries = Object.entries(userConfig);
  const enabledCount = entries.filter(([, cfg]) => cfg.enabled !== false).length;

  return (
    <div className="space-y-4">
      <p className="text-xs text-[var(--text-tertiary)]">
        {t("mcpDesc", { defaultValue: "Manage custom MCP server connections. Changes are applied immediately." })}
      </p>

      <div className="flex items-center justify-between mb-3">
        {!configLoading && (
          <p className="text-ui-2xs text-[var(--text-tertiary)]">
            {t("mcpCount", { count: enabledCount, defaultValue: `${enabledCount} enabled` })} / {entries.length}
          </p>
        )}
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-ui-2xs px-2.5"
          onClick={() => setShowAdd(true)}
        >
          <Plus className="h-3 w-3 mr-1" />
          {t("mcpAdd", { defaultValue: "Add MCP" })}
        </Button>
      </div>

      {showAdd && (
        <McpEditDialog
          mode="add"
          onClose={() => setShowAdd(false)}
        />
      )}

      {configLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-14 rounded-lg bg-[var(--surface-tertiary)] animate-pulse"
            />
          ))}
        </div>
      ) : entries.length === 0 ? (
        <p className="text-xs text-[var(--text-tertiary)] text-center py-8">
          {t("mcpEmpty", { defaultValue: "No custom MCP servers configured" })}
        </p>
      ) : (
        <div className="space-y-1.5">
          {entries.map(([id, cfg]) => (
            <CustomMcpRow
              key={id}
              id={id}
              config={cfg}
              connector={connectorsMap[id]}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Custom MCP Row (with cold-start deviation fix)                      */
/* ------------------------------------------------------------------ */

function CustomMcpRow({
  id,
  config,
  connector,
}: {
  id: string;
  config: McpServerConfig;
  connector?: ConnectorInfo;
}) {
  const { t } = useTranslation("settings");
  const toggle = useConnectorToggle();
  const reconnect = useConnectorReconnect();
  const updateConfig = useUpdateMcpConfig();
  const [editing, setEditing] = useState(false);

  const qc = useQueryClient();

  // Deviation fix: when connector is undefined (cold start), infer enabled from config
  // connector may be undefined when backend hasn't registered user-config MCPs yet
  const isEnabled = connector ? connector.enabled : (config.enabled !== false);
  const status = connector
    ? connector.enabled
      ? connector.status
      : "disabled"
    : "disconnected"; // NOT "disabled" — avoid grey dot misleading user

  const handleDelete = async () => {
    // Load current config, remove this entry, save
    const current = await api.get<{ config: Record<string, unknown> }>("/api/mcp/user-config");
    const newConfig = { ...current.config };
    delete newConfig[id];
    await updateConfig.mutateAsync(newConfig);
    toast.success(t("mcpDeleted", { defaultValue: "MCP server removed" }));
  };

  if (editing) {
    return (
      <McpEditDialog
        mode="edit"
        id={id}
        initialConfig={config}
        onClose={() => setEditing(false)}
      />
    );
  }

  return (
    <div className="flex items-center gap-3 rounded-lg border border-[var(--border-default)] p-2.5">
      {/* Status dot */}
      <span
        className={`h-2 w-2 rounded-full shrink-0 ${
          STATUS_COLORS[status] ?? STATUS_COLORS.disconnected
        }`}
      />

      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-[var(--text-primary)]">
            {config.name || id}
          </span>
          <span className="text-ui-3xs px-1.5 py-0.5 rounded-full bg-purple-500/10 text-purple-400">
            {config.type}
          </span>
          {status === "connected" && connector && connector.tools_count > 0 && (
            <span className="text-ui-3xs text-[var(--text-tertiary)]">
              {connector.tools_count} {t("mcpTools", { defaultValue: "tools" })}
            </span>
          )}
        </div>
        <p className="text-ui-3xs text-[var(--text-tertiary)] truncate mt-0.5">
          {config.type === "remote"
            ? config.url || ""
            : [config.command, ...(config.args || [])].join(" ")}
        </p>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-1 shrink-0">
        {status === "failed" && (
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-ui-3xs px-2"
            onClick={() => reconnect.mutate(id)}
            disabled={reconnect.isPending}
          >
            {reconnect.isPending ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <RotateCw className="h-3 w-3" />
            )}
            <span className="ml-1">{t("mcpRetry", { defaultValue: "Retry" })}</span>
          </Button>
        )}

        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-ui-3xs px-1.5 text-[var(--text-tertiary)]"
          onClick={() => setEditing(true)}
          title={t("mcpEdit", { defaultValue: "Edit" })}
        >
          <Pencil className="h-3 w-3" />
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="h-6 text-ui-3xs px-1.5 text-[var(--text-tertiary)]"
          onClick={handleDelete}
          disabled={updateConfig.isPending}
          title={t("mcpDelete", { defaultValue: "Delete" })}
        >
          <Trash2 className="h-3 w-3" />
        </Button>

        {/* Enable/disable toggle — always rendered, not dependent on connector existence */}
        <Switch
          checked={isEnabled}
          disabled={toggle.isPending}
          onCheckedChange={async (checked) => {
            await toggle.mutateAsync({ id, enable: checked });
            if (checked) {
              // Refresh status after a short delay
              await new Promise((r) => setTimeout(r, 1000));
              await qc.invalidateQueries({ queryKey: queryKeys.connectors });
            }
          }}
          className="shrink-0"
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Add / Edit Dialog                                                   */
/* ------------------------------------------------------------------ */

interface McpEditDialogProps {
  mode: "add" | "edit";
  id?: string;
  initialConfig?: McpServerConfig;
  onClose: () => void;
}

function McpEditDialog({ mode, id, initialConfig, onClose }: McpEditDialogProps) {
  const { t } = useTranslation("settings");
  const updateConfig = useUpdateMcpConfig();
  const qc = useQueryClient();

  const [name, setName] = useState(initialConfig?.name ?? "");
  const [serverType, setServerType] = useState<"remote" | "local">(
    initialConfig?.type ?? "remote",
  );
  const [url, setUrl] = useState(initialConfig?.url ?? "");
  const [command, setCommand] = useState(initialConfig?.command ?? "");
  const [args, setArgs] = useState(initialConfig?.args?.join(" ") ?? "");
  const [headersText, setHeadersText] = useState(
    initialConfig?.headers
      ? Object.entries(initialConfig.headers)
          .map(([k, v]) => `${k}: ${v}`)
          .join("\n")
      : "",
  );

  const isPending = updateConfig.isPending;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Parse headers
    const headers: Record<string, string> = {};
    if (headersText.trim()) {
      for (const line of headersText.trim().split("\n")) {
        const colonIdx = line.indexOf(":");
        if (colonIdx > 0) {
          const key = line.slice(0, colonIdx).trim();
          const val = line.slice(colonIdx + 1).trim();
          if (key) headers[key] = val;
        }
      }
    }

    const serverId = mode === "add"
      ? name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")
      : id!;

    if (!serverId) return;

    // Build server config
    const serverCfg: Record<string, unknown> = {
      name,
      type: serverType,
      enabled: mode === "edit" ? (initialConfig?.enabled ?? true) : true,
    };

    if (serverType === "remote") {
      serverCfg.url = url;
      if (Object.keys(headers).length > 0) {
        serverCfg.headers = headers;
      }
    } else {
      serverCfg.command = command;
      if (args.trim()) {
        serverCfg.args = args.trim().split(/\s+/);
      }
    }

    // Load current config and merge
    const current = await api.get<{ config: Record<string, unknown> }>("/api/mcp/user-config");
    const newConfig = { ...current.config, [serverId]: serverCfg };
    await updateConfig.mutateAsync(newConfig);

    onClose();
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="mb-4 rounded-lg border border-[var(--border-default)] bg-[var(--surface-secondary)] p-3 space-y-2.5"
    >
      <h4 className="text-xs font-semibold text-[var(--text-primary)]">
        {mode === "add"
          ? t("mcpAddTitle", { defaultValue: "Add MCP Server" })
          : t("mcpEditTitle", { defaultValue: "Edit MCP Server" })}
      </h4>

      {/* Name */}
      <div>
        <label className="text-ui-3xs text-[var(--text-tertiary)] mb-1 block">
          {t("mcpName", { defaultValue: "Name" })}
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("mcpNamePlaceholder", { defaultValue: "My MCP Server" })}
          className="w-full h-7 rounded-md border border-[var(--border-default)] bg-transparent px-2.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--border-focus)]"
          required
          disabled={mode === "edit"}
        />
      </div>

      {/* Type toggle */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setServerType("remote")}
          className={`px-3 py-1.5 text-ui-2xs rounded-md border transition-colors ${
            serverType === "remote"
              ? "border-[var(--brand-primary)] text-[var(--brand-primary)] bg-[var(--brand-primary)]/5"
              : "border-[var(--border-default)] text-[var(--text-tertiary)]"
          }`}
        >
          {t("mcpTypeRemote", { defaultValue: "Remote (URL)" })}
        </button>
        <button
          type="button"
          onClick={() => setServerType("local")}
          className={`px-3 py-1.5 text-ui-2xs rounded-md border transition-colors ${
            serverType === "local"
              ? "border-[var(--brand-primary)] text-[var(--brand-primary)] bg-[var(--brand-primary)]/5"
              : "border-[var(--border-default)] text-[var(--text-tertiary)]"
          }`}
        >
          {t("mcpTypeLocal", { defaultValue: "Local (stdio)" })}
        </button>
      </div>

      {/* Remote: URL */}
      {serverType === "remote" && (
        <div>
          <label className="text-ui-3xs text-[var(--text-tertiary)] mb-1 block">
            {t("mcpUrl", { defaultValue: "Server URL" })}
          </label>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://mcp.example.com/mcp"
            className="w-full h-7 rounded-md border border-[var(--border-default)] bg-transparent px-2.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--border-focus)]"
            required
          />
        </div>
      )}

      {/* Local: command + args */}
      {serverType === "local" && (
        <>
          <div>
            <label className="text-ui-3xs text-[var(--text-tertiary)] mb-1 block">
              {t("mcpCommand", { defaultValue: "Command" })}
            </label>
            <input
              type="text"
              value={command}
              onChange={(e) => setCommand(e.target.value)}
              placeholder="npx"
              className="w-full h-7 rounded-md border border-[var(--border-default)] bg-transparent px-2.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--border-focus)]"
              required
            />
          </div>
          <div>
            <label className="text-ui-3xs text-[var(--text-tertiary)] mb-1 block">
              {t("mcpArgs", { defaultValue: "Arguments (space-separated)" })}
            </label>
            <input
              type="text"
              value={args}
              onChange={(e) => setArgs(e.target.value)}
              placeholder="-y @modelcontextprotocol/server-memory"
              className="w-full h-7 rounded-md border border-[var(--border-default)] bg-transparent px-2.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--border-focus)]"
            />
          </div>
        </>
      )}

      {/* Headers (remote only) */}
      {serverType === "remote" && (
        <div>
          <label className="text-ui-3xs text-[var(--text-tertiary)] mb-1 block">
            {t("mcpHeaders", { defaultValue: "Headers (key: value per line, optional)" })}
          </label>
          <textarea
            value={headersText}
            onChange={(e) => setHeadersText(e.target.value)}
            placeholder={"Authorization: Bearer token\nX-Custom: value"}
            rows={3}
            className="w-full rounded-md border border-[var(--border-default)] bg-transparent px-2.5 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none focus:ring-1 focus:ring-[var(--border-focus)] resize-y"
          />
        </div>
      )}

      <div className="flex justify-end gap-2 pt-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-ui-2xs"
          onClick={onClose}
          type="button"
        >
          {t("mcpCancel", { defaultValue: "Cancel" })}
        </Button>
        <Button
          size="sm"
          className="h-7 text-ui-2xs"
          type="submit"
          disabled={isPending || !name || (serverType === "remote" ? !url : !command)}
        >
          {isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : null}
          {mode === "add"
            ? t("mcpAddBtn", { defaultValue: "Add" })
            : t("mcpSaveBtn", { defaultValue: "Save" })}
        </Button>
      </div>
    </form>
  );
}
