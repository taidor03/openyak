"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { API, queryKeys } from "@/lib/constants";
import type { McpUserConfigResponse } from "@/types/connectors";

/** Fetch user MCP configuration (from .openyak/mcp-servers.json) */
export function useMcpConfig() {
  return useQuery({
    queryKey: queryKeys.mcpConfig,
    queryFn: () => api.get<McpUserConfigResponse>(API.MCP.USER_CONFIG),
    staleTime: 30_000,
    meta: { persist: true },
  });
}

/** Update user MCP configuration (PUT — triggers hot-reload) */
export function useUpdateMcpConfig() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (config: Record<string, unknown>) =>
      api.put<{ success: boolean; config: Record<string, unknown> }>(
        API.MCP.USER_CONFIG,
        { config },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.mcpConfig });
      queryClient.invalidateQueries({ queryKey: queryKeys.connectors });
      toast.success("MCP configuration saved and applied");
    },
    onError: (error) => {
      const msg =
        error instanceof Error ? error.message : "Failed to save MCP configuration";
      toast.error(msg);
    },
  });
}
