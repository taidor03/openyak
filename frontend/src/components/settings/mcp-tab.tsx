"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useConnectors, useConnectorToggle } from "@/hooks/use-connectors";
import { useMcpConfig, useSaveMcpConfig } from "@/hooks/use-mcp-config";
import type { McpServerConfig } from "@/hooks/use-mcp-config";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  WifiOff,
  Terminal,
  Globe,
  Plus,
  Pencil,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ConnectorInfo } from "@/types/connectors";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function StatusDot({ status }: { status: ConnectorInfo["status"] }) {
  const map: Record<ConnectorInfo["status"], string> = {
    connected: "bg-green-500",
    disconnected: "bg-gray-400",
    needs_auth: "bg-amber-500",
    failed: "bg-red-500",
    disabled: "bg-gray-300",
  };
  return (
    <span
      className={cn("inline-block h-2 w-2 rounded-full flex-shrink-0 mt-1", map[status])}
      title={status}
    />
  );
}

// ---------------------------------------------------------------------------
// Built-in MCP row
// ---------------------------------------------------------------------------

function BuiltinMcpRow({ id, connector }: { id: string; connector: ConnectorInfo }) {
  const toggle = useConnectorToggle();

  return (
    <div className="flex items-start gap-3 py-3 border-b border-[var(--border-primary)] last:border-0">
      <StatusDot status={connector.enabled ? connector.status : "disabled"} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm text-[var(--text-primary)]">{connector.name}</span>
          {connector.type === "local" ? (
            <Badge variant="outline" className="text-xs gap-1 py-0">
              <Terminal className="h-3 w-3" />
              本地
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs gap-1 py-0">
              <Globe className="h-3 w-3" />
              远程
            </Badge>
          )}
          {connector.enabled && connector.status === "connected" && (
            <Badge className="text-xs py-0 bg-green-500/15 text-green-700 dark:text-green-400 border-0">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              {connector.tools_count > 0 ? `${connector.tools_count} 工具` : "已连接"}
            </Badge>
          )}
          {connector.enabled && connector.status === "failed" && (
            <Badge className="text-xs py-0 bg-red-500/15 text-red-600 dark:text-red-400 border-0">
              <XCircle className="h-3 w-3 mr-1" />
              连接失败
            </Badge>
          )}
        </div>
        {connector.description && (
          <p className="text-xs text-[var(--text-secondary)] mt-0.5 leading-relaxed">
            {connector.description}
          </p>
        )}
        {connector.type === "local" && (
          <p className="text-xs text-[var(--text-tertiary)] mt-0.5">需要 Node.js / npx</p>
        )}
      </div>

      <Switch
        checked={connector.enabled}
        disabled={toggle.isPending}
        onCheckedChange={(checked) => toggle.mutate({ id, enable: checked })}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add / Edit dialog
// ---------------------------------------------------------------------------

const ENTRY_PLACEHOLDER = JSON.stringify(
  {
    "my-mcp": {
      type: "remote",
      url: "https://example.com/mcp",
      headers: { Authorization: "Bearer your-token" },
      name: "My MCP",
      description: "描述信息",
      category: "search",
    },
  },
  null,
  2,
);

interface McpEntryDialogProps {
  open: boolean;
  onClose: () => void;
  /** existing entry being edited; undefined = add mode */
  initial?: { id: string; config: McpServerConfig };
  allServers: Record<string, McpServerConfig>;
  onSave: (servers: Record<string, McpServerConfig>) => void;
  isSaving: boolean;
}

function McpEntryDialog({
  open,
  onClose,
  initial,
  allServers,
  onSave,
  isSaving,
}: McpEntryDialogProps) {
  const isEdit = !!initial;

  const [draft, setDraft] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);

  // Reset draft when dialog opens
  useEffect(() => {
    if (!open) return;
    if (initial) {
      setDraft(JSON.stringify({ [initial.id]: initial.config }, null, 2));
    } else {
      setDraft("");
    }
    setParseError(null);
  }, [open, initial]);

  const handleChange = useCallback((value: string) => {
    setDraft(value);
    try {
      JSON.parse(value);
      setParseError(null);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "JSON 格式错误");
    }
  }, []);

  const handleSave = useCallback(() => {
    let parsed: Record<string, McpServerConfig>;
    try {
      parsed = JSON.parse(draft) as Record<string, McpServerConfig>;
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "JSON 格式错误");
      return;
    }

    const keys = Object.keys(parsed);
    if (keys.length === 0) {
      setParseError("请至少输入一条服务器配置");
      return;
    }

    // Validate each entry has required fields
    for (const [key, cfg] of Object.entries(parsed)) {
      if (!cfg || typeof cfg !== "object") {
        setParseError(`"${key}" 的值必须是对象`);
        return;
      }
      if (cfg.type === "local" && (!cfg.command || cfg.command.length === 0)) {
        setParseError(`本地类型 "${key}" 必须填写 command 数组`);
        return;
      }
      if (cfg.type !== "local" && !cfg.url) {
        setParseError(`远程类型 "${key}" 必须填写 url`);
        return;
      }
    }

    // Merge: remove old entry (if editing), add new entries
    const next = { ...allServers };
    if (isEdit && initial) {
      delete next[initial.id];
    }
    Object.assign(next, parsed);
    onSave(next);
  }, [draft, allServers, isEdit, initial, onSave]);

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEdit ? "编辑 MCP 服务器" : "添加 MCP 服务器"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <p className="text-xs text-[var(--text-secondary)]">
            输入 JSON 格式的服务器配置，key 为服务器 ID，value 为配置项。
          </p>

          <textarea
            value={draft}
            onChange={(e) => handleChange(e.target.value)}
            placeholder={ENTRY_PLACEHOLDER}
            spellCheck={false}
            rows={14}
            className={cn(
              "w-full rounded-lg border px-3 py-2.5 font-mono text-xs leading-relaxed",
              "bg-[var(--surface-primary)] text-[var(--text-primary)]",
              "resize-y focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]",
              parseError
                ? "border-red-500 focus:ring-red-500"
                : "border-[var(--border-primary)]",
            )}
          />

          {parseError && (
            <p className="text-xs text-red-500 flex items-center gap-1">
              <XCircle className="h-3.5 w-3.5 flex-shrink-0" />
              {parseError}
            </p>
          )}

          <div className="rounded-lg bg-[var(--surface-secondary)] px-3 py-2 text-xs text-[var(--text-secondary)] space-y-1">
            <p>• <code className="bg-[var(--surface-tertiary)] px-1 rounded">type: &quot;remote&quot;</code> — 填写 <code className="bg-[var(--surface-tertiary)] px-1 rounded">url</code>，可选 <code className="bg-[var(--surface-tertiary)] px-1 rounded">headers</code>（如 Bearer Token）</p>
            <p>• <code className="bg-[var(--surface-tertiary)] px-1 rounded">type: &quot;local&quot;</code> — 填写 <code className="bg-[var(--surface-tertiary)] px-1 rounded">command</code> 数组，可选 <code className="bg-[var(--surface-tertiary)] px-1 rounded">env</code></p>
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={onClose} disabled={isSaving}>
            取消
          </Button>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!!parseError || isSaving || !draft.trim()}
            className="gap-1.5"
          >
            {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            {isEdit ? "保存修改" : "添加"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Custom MCP list row
// ---------------------------------------------------------------------------

interface CustomMcpRowProps {
  id: string;
  config: McpServerConfig;
  connector: ConnectorInfo | undefined;
  onEdit: () => void;
  onDelete: () => void;
}

function CustomMcpRow({ id, config, connector, onEdit, onDelete }: CustomMcpRowProps) {
  const toggle = useConnectorToggle();
  const isLocal = config.type === "local";
  const status = connector
    ? connector.enabled
      ? connector.status
      : "disabled"
    : "disabled";

  return (
    <div className="flex items-start gap-3 py-3 border-b border-[var(--border-primary)] last:border-0">
      <StatusDot status={status} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm text-[var(--text-primary)]">
            {config.name || id}
          </span>
          <span className="text-xs text-[var(--text-tertiary)] font-mono">({id})</span>

          {isLocal ? (
            <Badge variant="outline" className="text-xs gap-1 py-0">
              <Terminal className="h-3 w-3" />本地
            </Badge>
          ) : (
            <Badge variant="outline" className="text-xs gap-1 py-0">
              <Globe className="h-3 w-3" />远程
            </Badge>
          )}

          {connector?.enabled && connector.status === "connected" && (
            <Badge className="text-xs py-0 bg-green-500/15 text-green-700 dark:text-green-400 border-0">
              <CheckCircle2 className="h-3 w-3 mr-1" />
              {connector.tools_count > 0 ? `${connector.tools_count} 工具` : "已连接"}
            </Badge>
          )}
          {connector?.enabled && connector.status === "failed" && (
            <Badge className="text-xs py-0 bg-red-500/15 text-red-600 dark:text-red-400 border-0">
              <XCircle className="h-3 w-3 mr-1" />连接失败
            </Badge>
          )}
        </div>

        {config.description && (
          <p className="text-xs text-[var(--text-secondary)] mt-0.5 leading-relaxed">
            {config.description}
          </p>
        )}
        {!isLocal && config.url && (
          <p className="text-xs text-[var(--text-tertiary)] mt-0.5 font-mono truncate">
            {config.url}
          </p>
        )}
        {isLocal && config.command && (
          <p className="text-xs text-[var(--text-tertiary)] mt-0.5 font-mono truncate">
            {config.command.join(" ")}
          </p>
        )}
        {config.headers && Object.keys(config.headers).length > 0 && (
          <p className="text-xs text-[var(--text-tertiary)] mt-0.5">
            Headers: {Object.keys(config.headers).join(", ")}
          </p>
        )}
      </div>

      <div className="flex items-center gap-1.5 flex-shrink-0">
        {connector && (
          <Switch
            checked={connector.enabled}
            disabled={toggle.isPending}
            onCheckedChange={(checked) => toggle.mutate({ id, enable: checked })}
          />
        )}
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          onClick={onEdit}
          title="编辑"
        >
          <Pencil className="h-3.5 w-3.5" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-7 w-7 text-[var(--text-secondary)] hover:text-red-500"
          onClick={onDelete}
          title="删除"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Custom MCPs manager section
// ---------------------------------------------------------------------------

function CustomMcpSection({
  connectorsData,
}: {
  connectorsData: Record<string, ConnectorInfo> | undefined;
}) {
  const { data: mcpConfig, isLoading } = useMcpConfig();
  const save = useSaveMcpConfig();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<{ id: string; config: McpServerConfig } | undefined>();

  const servers = useMemo(() => mcpConfig?.mcpServers ?? {}, [mcpConfig]);

  const handleSave = useCallback(
    (next: Record<string, McpServerConfig>) => {
      save.mutate(next, {
        onSuccess: () => setDialogOpen(false),
      });
    },
    [save],
  );

  const handleDelete = useCallback(
    (id: string) => {
      const next = { ...servers };
      delete next[id];
      save.mutate(next);
    },
    [servers, save],
  );

  const openAdd = () => {
    setEditTarget(undefined);
    setDialogOpen(true);
  };

  const openEdit = (id: string, config: McpServerConfig) => {
    setEditTarget({ id, config });
    setDialogOpen(true);
  };

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">自定义 MCP 服务器</h2>
          <p className="text-xs text-[var(--text-secondary)] mt-1">
            添加任意 MCP 服务器，保存后立即生效，无需重启。
          </p>
        </div>
        <Button size="sm" variant="outline" className="gap-1.5 flex-shrink-0" onClick={openAdd}>
          <Plus className="h-3.5 w-3.5" />
          添加 MCP
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)] py-4">
          <Loader2 className="h-4 w-4 animate-spin" />
          加载中...
        </div>
      ) : Object.keys(servers).length === 0 ? (
        <div
          className="rounded-lg border border-dashed border-[var(--border-primary)] px-4 py-8 text-center cursor-pointer hover:border-[var(--brand-primary)] hover:bg-[var(--surface-secondary)] transition-colors"
          onClick={openAdd}
        >
          <Plus className="h-6 w-6 mx-auto mb-2 text-[var(--text-tertiary)]" />
          <p className="text-sm text-[var(--text-secondary)]">暂无自定义 MCP 服务器</p>
          <p className="text-xs text-[var(--text-tertiary)] mt-1">点击添加第一个</p>
        </div>
      ) : (
        <div className="rounded-lg border border-[var(--border-primary)] px-4">
          {Object.entries(servers).map(([id, config]) => (
            <CustomMcpRow
              key={id}
              id={id}
              config={config}
              connector={connectorsData?.[id]}
              onEdit={() => openEdit(id, config)}
              onDelete={() => handleDelete(id)}
            />
          ))}
        </div>
      )}

      <McpEntryDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        initial={editTarget}
        allServers={servers}
        onSave={handleSave}
        isSaving={save.isPending}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// Main tab
// ---------------------------------------------------------------------------

export function McpTab() {
  const { data } = useConnectors();

  const builtinMcps = Object.entries(data?.connectors ?? {}).filter(
    ([, c]) => c.referenced_by?.includes("__builtin__"),
  );

  return (
    <div className="space-y-8">
      {/* Built-in MCPs */}
      <section>
        <div className="mb-4">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">内置搜索 MCP</h2>
          <p className="text-xs text-[var(--text-secondary)] mt-1">
            零配置、无需 API Key 的内置搜索工具。本地工具需要系统已安装 Node.js。
          </p>
        </div>

        {builtinMcps.length === 0 ? (
          <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)] py-4">
            <WifiOff className="h-4 w-4" />
            暂无内置 MCP（后端启动中...）
          </div>
        ) : (
          <div className="rounded-lg border border-[var(--border-primary)] px-4 divide-y divide-[var(--border-primary)]">
            {builtinMcps.map(([id, connector]) => (
              <BuiltinMcpRow key={id} id={id} connector={connector} />
            ))}
          </div>
        )}
      </section>

      {/* Custom MCPs */}
      <CustomMcpSection connectorsData={data?.connectors} />
    </div>
  );
}
