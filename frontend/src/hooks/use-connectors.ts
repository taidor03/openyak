"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { API, queryKeys } from "@/lib/constants";
import type { ConnectorsResponse, ConnectorInfo } from "@/types/connectors";

function errorDetail(error: unknown, fallback: string) {
  if (
    typeof error === "object" &&
    error &&
    "body" in error &&
    typeof (error as { body?: unknown }).body === "object" &&
    (error as { body?: Record<string, unknown> }).body
  ) {
    const detail = (error as { body?: Record<string, unknown> }).body?.detail;
    if (typeof detail === "string" && detail.trim()) return detail;
  }
  if (error instanceof Error) return error.message || fallback;
  return fallback;
}

/** Update a single connector in the cached ConnectorsResponse */
function updateConnectorInCache(
  queryClient: ReturnType<typeof useQueryClient>,
  connectorId: string,
  updater: (c: ConnectorInfo) => ConnectorInfo,
) {
  queryClient.setQueryData<ConnectorsResponse>(queryKeys.connectors, (old) => {
    if (!old) return old;
    const connector = old.connectors[connectorId];
    if (!connector) return old;
    return {
      ...old,
      connectors: {
        ...old.connectors,
        [connectorId]: updater(connector),
      },
    };
  });
}

/** Remove a connector from the cached ConnectorsResponse */
function removeConnectorFromCache(
  queryClient: ReturnType<typeof useQueryClient>,
  connectorId: string,
) {
  queryClient.setQueryData<ConnectorsResponse>(queryKeys.connectors, (old) => {
    if (!old) return old;
    const { [connectorId]: _, ...rest } = old.connectors;
    return { ...old, connectors: rest };
  });
}

export function useConnectors() {
  return useQuery({
    queryKey: queryKeys.connectors,
    queryFn: () => api.get<ConnectorsResponse>(API.CONNECTORS.LIST),
    staleTime: 30_000,
    refetchInterval: 60_000,
    meta: { persist: true },
  });
}

export function useConnectorToggle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, enable }: { id: string; enable: boolean }) =>
      api.post<{ success: boolean }>(
        enable ? API.CONNECTORS.ENABLE(id) : API.CONNECTORS.DISABLE(id),
      ),
    onSuccess: (_data, { id, enable }) => {
      // Optimistic cache update: instantly reflect enabled/disabled state
      updateConnectorInCache(queryClient, id, (c) => ({
        ...c,
        enabled: enable,
        status: enable ? "disconnected" : "disabled",
        connected: enable ? c.connected : false,
      }));
      // Background refresh to sync with server truth
      queryClient.invalidateQueries({ queryKey: queryKeys.connectors });
    },
  });
}

export function useConnectorConnect() {
  return useMutation({
    mutationFn: (id: string) =>
      api.post<{ success: boolean; auth_url?: string; state?: string; error?: string }>(
        API.CONNECTORS.CONNECT(id),
      ),
    onError: (error) => {
      toast.error(errorDetail(error, "Failed to connect connector"));
    },
  });
}

export function useConnectorDisconnect() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<{ success: boolean }>(API.CONNECTORS.DISCONNECT(id)),
    onSuccess: (_data, id) => {
      updateConnectorInCache(queryClient, id, (c) => ({
        ...c,
        connected: false,
        status: "disconnected",
      }));
      queryClient.invalidateQueries({ queryKey: queryKeys.connectors });
    },
  });
}

export function useConnectorReconnect() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<{ success: boolean }>(API.CONNECTORS.RECONNECT(id)),
    onSuccess: (_data, id) => {
      updateConnectorInCache(queryClient, id, (c) => ({
        ...c,
        connected: true,
        status: "connected",
        error: null,
      }));
      queryClient.invalidateQueries({ queryKey: queryKeys.connectors });
    },
    onError: (error) => {
      toast.error(errorDetail(error, "Failed to reconnect connector"));
    },
  });
}

export function useSetConnectorToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, token }: { id: string; token: string }) =>
      api.post<{ success: boolean }>(API.CONNECTORS.SET_TOKEN(id), { token }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.connectors });
    },
    onError: (error) => {
      toast.error(errorDetail(error, "Failed to save connector token"));
    },
  });
}

export function useAddCustomConnector() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { id: string; name: string; url: string; description?: string; category?: string }) =>
      api.post<{ success: boolean }>(API.CONNECTORS.ADD, body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.connectors });
    },
  });
}

export function useRemoveConnector() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.delete<{ success: boolean }>(API.CONNECTORS.REMOVE(id)),
    onSuccess: (_data, id) => {
      // Immediately remove from cache
      removeConnectorFromCache(queryClient, id);
      queryClient.invalidateQueries({ queryKey: queryKeys.connectors });
    },
  });
}
