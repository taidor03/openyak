"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { API, queryKeys } from "@/lib/constants";

export interface McpServerConfig {
  type?: "remote" | "local";
  url?: string;
  command?: string[];
  env?: Record<string, string>;
  headers?: Record<string, string>;
  name?: string;
  description?: string;
  category?: string;
}

export interface McpUserConfig {
  mcpServers: Record<string, McpServerConfig>;
}

export function useMcpConfig() {
  return useQuery({
    queryKey: queryKeys.mcpConfig,
    queryFn: () => api.get<McpUserConfig>(API.MCP.USER_CONFIG),
    staleTime: 30_000,
    meta: { persist: true },
  });
}

export function useSaveMcpConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (mcpServers: Record<string, McpServerConfig>) =>
      api.put<{ success: boolean; connectors: unknown }>(API.MCP.USER_CONFIG, { mcpServers }),
    onSuccess: (_data, mcpServers) => {
      // Immediately update the MCP config cache with the saved data
      queryClient.setQueryData<McpUserConfig>(queryKeys.mcpConfig, {
        mcpServers,
      });
      // Background refresh to sync with server truth
      queryClient.invalidateQueries({ queryKey: queryKeys.mcpConfig });
      queryClient.invalidateQueries({ queryKey: queryKeys.connectors });
      toast.success("MCP 配置已保存，连接器已热重载");
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(`保存失败: ${msg}`);
    },
  });
}
