/** Connector (individual MCP server connection) types */

export interface ConnectorInfo {
  id: string;
  name: string;
  url: string;
  type: "remote" | "local";
  description: string;
  category: string;
  enabled: boolean;
  connected: boolean;
  status: "connected" | "disconnected" | "needs_auth" | "failed" | "disabled";
  error: string | null;
  tools_count: number;
  source: "builtin" | "custom" | "user-config";
  no_auth_required?: boolean;
  headers?: Record<string, string>;
  referenced_by: string[];
}

export interface ConnectorsResponse {
  connectors: Record<string, ConnectorInfo>;
}

/** MCP server configuration for user-config (mcp-servers.json) */
export interface McpServerConfig {
  id?: string;
  name?: string;
  type: "remote" | "local";
  url?: string;           // remote type
  command?: string | string[];  // local stdio type (string[] for Claude Desktop compat)
  args?: string[];        // local stdio arguments (when command is a string)
  enabled?: boolean;
  headers?: Record<string, string>;
  description?: string;
  category?: string;
  env?: Record<string, string>;        // Claude Desktop format
  environment?: Record<string, string>; // OpenYak internal format
}

/** Response from GET /api/mcp/user-config */
export interface McpUserConfigResponse {
  config: Record<string, McpServerConfig>;
}
