"use client";

import { useState, useEffect, useCallback } from "react";
import { useConnectors, useConnectorToggle } from "@/hooks/use-connectors";
import { useMcpConfig, useSaveMcpConfig } from "@/hooks/use-mcp-config";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Loader2, Save, RefreshCw, CheckCircle2, XCircle, WifiOff, Terminal, Globe } from "lucide-react";
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
// JSON config editor
// ---------------------------------------------------------------------------

const CONFIG_PLACEHOLDER = JSON.stringify(
  {
    mcpServers: {
      "my-remote-mcp": {
        type: "remote",
        url: "https://example.com/mcp",
      },
      "my-local-mcp": {
        type: "local",
        command: ["npx", "-y", "some-mcp-package@latest"],
        env: {
          API_KEY: "your-key-here",
        },
      },
    },
  },
  null,
  2,
);

function McpJsonEditor() {
  const { data, isLoading } = useMcpConfig();
  const save = useSaveMcpConfig();

  const [draft, setDraft] = useState<string>("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  // Initialise editor from fetched config
  useEffect(() => {
    if (data) {
      const text = JSON.stringify(data, null, 2);
      setDraft(text);
      setIsDirty(false);
    }
  }, [data]);

  const handleChange = useCallback((value: string) => {
    setDraft(value);
    setIsDirty(true);
    try {
      JSON.parse(value);
      setParseError(null);
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "JSON 格式错误");
    }
  }, []);

  const handleSave = useCallback(() => {
    try {
      const parsed = JSON.parse(draft) as { mcpServers?: Record<string, unknown> };
      if (!parsed || typeof parsed !== "object" || !("mcpServers" in parsed)) {
        setParseError('配置必须包含 "mcpServers" 字段');
        return;
      }
      save.mutate(parsed.mcpServers as Record<string, never>, {
        onSuccess: () => setIsDirty(false),
      });
    } catch (e) {
      setParseError(e instanceof Error ? e.message : "JSON 格式错误");
    }
  }, [draft, save]);

  const handleFormat = useCallback(() => {
    try {
      const parsed = JSON.parse(draft);
      setDraft(JSON.stringify(parsed, null, 2));
      setParseError(null);
    } catch {
      // ignore if invalid
    }
  }, [draft]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-8 text-[var(--text-secondary)]">
        <Loader2 className="h-4 w-4 animate-spin mr-2" />
        加载中...
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Format hint */}
      <div className="rounded-lg bg-[var(--surface-secondary)] px-4 py-3 text-xs text-[var(--text-secondary)] space-y-1">
        <p className="font-medium text-[var(--text-primary)]">配置格式说明</p>
        <p>
          • <code className="bg-[var(--surface-tertiary)] px-1 rounded">type: &quot;remote&quot;</code>
          {" "}— 填写 <code className="bg-[var(--surface-tertiary)] px-1 rounded">url</code>（SSE/HTTP 传输）
        </p>
        <p>
          • <code className="bg-[var(--surface-tertiary)] px-1 rounded">type: &quot;local&quot;</code>
          {" "}— 填写 <code className="bg-[var(--surface-tertiary)] px-1 rounded">command</code> 数组（stdio 传输，需要 Node.js/Python）
        </p>
        <p>
          • <code className="bg-[var(--surface-tertiary)] px-1 rounded">env</code> 字段为可选环境变量
        </p>
        <p className="text-[var(--text-tertiary)]">
          保存后立即生效，无需重启。配置持久化到{" "}
          <code className="bg-[var(--surface-tertiary)] px-1 rounded">.openyak/mcp-servers.json</code>
        </p>
      </div>

      {/* Textarea editor */}
      <textarea
        value={draft}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={CONFIG_PLACEHOLDER}
        spellCheck={false}
        className={cn(
          "w-full min-h-[320px] rounded-lg border px-4 py-3 font-mono text-xs leading-relaxed",
          "bg-[var(--surface-primary)] text-[var(--text-primary)]",
          "resize-y focus:outline-none focus:ring-2 focus:ring-[var(--brand-primary)]",
          parseError
            ? "border-red-500 focus:ring-red-500"
            : "border-[var(--border-primary)]",
        )}
      />

      {/* Error message */}
      {parseError && (
        <p className="text-xs text-red-500 flex items-center gap-1">
          <XCircle className="h-3.5 w-3.5 flex-shrink-0" />
          {parseError}
        </p>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={handleSave}
          disabled={!!parseError || save.isPending || !isDirty}
          className="gap-1.5"
        >
          {save.isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Save className="h-3.5 w-3.5" />
          )}
          保存并重载
        </Button>

        <Button
          size="sm"
          variant="outline"
          onClick={handleFormat}
          disabled={!!parseError}
          className="gap-1.5"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          格式化
        </Button>

        {!isDirty && !save.isPending && (
          <span className="text-xs text-[var(--text-secondary)] flex items-center gap-1 ml-1">
            <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
            已保存
          </span>
        )}
      </div>
    </div>
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

      {/* User-defined MCPs */}
      <section>
        <div className="mb-4">
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">自定义 MCP 服务器</h2>
        <p className="text-xs text-[var(--text-secondary)] mt-1">
          添加任意 MCP 服务器。修改后保存，无需重启软件即可生效。已加载的服务器可在下方直接启用/禁用。
        </p>
        </div>

        <McpJsonEditor />
      </section>

      {/* Active user-config connectors */}
      <UserConfigConnectors data={data?.connectors} />
    </div>
  );
}

function UserConfigConnectors({
  data,
}: {
  data: Record<string, ConnectorInfo> | undefined;
}) {
  const toggle = useConnectorToggle();
  const userConfigEntries = Object.entries(data ?? {}).filter(
    ([, c]) => c.source === "user-config",
  );

  if (userConfigEntries.length === 0) return null;

  return (
    <section>
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-[var(--text-primary)]">自定义服务器状态</h2>
        <p className="text-xs text-[var(--text-secondary)] mt-1">
          当前已加载的自定义 MCP 服务器连接状态。
        </p>
      </div>

      <div className="rounded-lg border border-[var(--border-primary)] px-4 divide-y divide-[var(--border-primary)]">
        {userConfigEntries.map(([id, connector]) => (
          <div key={id} className="flex items-start gap-3 py-3">
            <StatusDot status={connector.enabled ? connector.status : "disabled"} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-sm text-[var(--text-primary)]">
                  {connector.name || id}
                </span>
                {connector.type === "local" ? (
                  <Badge variant="outline" className="text-xs gap-1 py-0">
                    <Terminal className="h-3 w-3" />本地
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-xs gap-1 py-0">
                    <Globe className="h-3 w-3" />远程
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
                    <XCircle className="h-3 w-3 mr-1" />连接失败
                  </Badge>
                )}
              </div>
              {connector.description && (
                <p className="text-xs text-[var(--text-secondary)] mt-0.5">{connector.description}</p>
              )}
              {connector.url && (
                <p className="text-xs text-[var(--text-tertiary)] mt-0.5 font-mono truncate">{connector.url}</p>
              )}
            </div>
            <Switch
              checked={connector.enabled}
              disabled={toggle.isPending}
              onCheckedChange={(checked) => toggle.mutate({ id, enable: checked })}
            />
          </div>
        ))}
      </div>
    </section>
  );
}
