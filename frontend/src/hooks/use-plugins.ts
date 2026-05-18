"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { API, queryKeys } from "@/lib/constants";
import type {
  PluginsStatusResponse,
  PluginDetail,
  SkillInfo,
  StoreSearchResponse,
} from "@/types/plugins";

/** Update a single plugin's enabled state in the cached PluginsStatusResponse */
function updatePluginInCache(
  queryClient: ReturnType<typeof useQueryClient>,
  pluginName: string,
  enabled: boolean,
) {
  queryClient.setQueryData<PluginsStatusResponse>(queryKeys.plugins.all, (old) => {
    if (!old) return old;
    const plugin = old.plugins[pluginName];
    if (!plugin) return old;
    return {
      ...old,
      plugins: {
        ...old.plugins,
        [pluginName]: { ...plugin, enabled },
      },
    };
  });
}

/** Update a single skill's enabled state in the cached SkillInfo[] */
function updateSkillInCache(
  queryClient: ReturnType<typeof useQueryClient>,
  skillName: string,
  enabled: boolean,
) {
  queryClient.setQueryData<SkillInfo[]>(queryKeys.skills, (old) => {
    if (!old) return old;
    return old.map((s) =>
      s.name === skillName ? { ...s, enabled } : s,
    );
  });
}

export function usePluginsStatus() {
  return useQuery({
    queryKey: queryKeys.plugins.all,
    queryFn: () => api.get<PluginsStatusResponse>(API.PLUGINS.STATUS),
    staleTime: 30_000,
    refetchInterval: 60_000,
    meta: { persist: true },
  });
}

export function usePluginDetail(name: string | null) {
  return useQuery({
    queryKey: queryKeys.plugins.detail(name ?? ""),
    queryFn: () => api.get<PluginDetail>(API.PLUGINS.DETAIL(name!)),
    enabled: !!name,
    staleTime: 60_000,
  });
}

export function useSkills(workspacePath?: string | null) {
  return useQuery({
    queryKey: [...queryKeys.skills, workspacePath ?? ""],
    queryFn: () => {
      const params = workspacePath ? `?workspace_path=${encodeURIComponent(workspacePath)}` : "";
      return api.get<SkillInfo[]>(`${API.SKILLS.LIST}${params}`);
    },
    staleTime: 30_000,
    refetchInterval: 60_000,
    meta: { persist: true },
  });
}

export function usePluginToggle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, enable }: { name: string; enable: boolean }) =>
      api.post<{ success: boolean; plugins: PluginsStatusResponse["plugins"] }>(
        enable ? API.PLUGINS.ENABLE(name) : API.PLUGINS.DISABLE(name),
      ),
    onSuccess: (_data, { name, enable }) => {
      // Optimistic cache update: instantly reflect enabled/disabled state
      updatePluginInCache(queryClient, name, enable);
      // Background refresh to sync with server truth
      queryClient.invalidateQueries({ queryKey: queryKeys.plugins.all });
      queryClient.invalidateQueries({ queryKey: queryKeys.skills });
    },
  });
}

export function useSkillToggle() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, enable }: { name: string; enable: boolean }) =>
      api.post<{ success: boolean; skills: SkillInfo[] }>(
        enable ? API.SKILLS.ENABLE(name) : API.SKILLS.DISABLE(name),
      ),
    onSuccess: (_data, { name, enable }) => {
      // Optimistic cache update: instantly reflect enabled/disabled state
      updateSkillInCache(queryClient, name, enable);
      // Background refresh to sync with server truth
      queryClient.invalidateQueries({ queryKey: queryKeys.skills });
    },
  });
}

// ─── Store ─────────────────────────────────────────────────────────────

export function useSkillStoreSearch(
  q: string,
  sort: "stars" | "recent" = "stars",
  page = 1,
  enabled = true,
) {
  return useQuery({
    queryKey: queryKeys.skillStore(q, sort, page),
    queryFn: () => {
      const params = new URLSearchParams({
        q,
        sort,
        page: String(page),
        limit: "20",
      });
      return api.get<StoreSearchResponse>(
        `${API.SKILLS.STORE_SEARCH}?${params.toString()}`,
      );
    },
    enabled,
    staleTime: 30_000,
  });
}

export function useInstallSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ github_url, name }: { github_url: string; name?: string }) =>
      api.post<{ success: boolean; location: string; skills: SkillInfo[] }>(
        API.SKILLS.INSTALL,
        { github_url, name },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.skills });
    },
  });
}

// ─── Skill CRUD ───────────────────────────────────────────────────────

export interface CreateSkillPayload {
  name: string;
  description: string;
  content?: string;
  target?: "project" | "agents" | string;
  workspacePath?: string | null;
}

export function useCreateSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateSkillPayload) =>
      api.post<{ success: boolean; skill: SkillInfo }>(API.SKILLS.CREATE, {
        name: payload.name,
        description: payload.description,
        content: payload.content ?? "",
        target: payload.target ?? "project",
        workspace_path: payload.workspacePath ?? undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.skills });
    },
  });
}

export function useUpdateSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, content }: { name: string; content: string }) =>
      api.put<{ success: boolean; skill: SkillInfo | null }>(API.SKILLS.UPDATE(name), { content }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.skills });
    },
  });
}

export function useDeleteSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      api.delete<{ success: boolean; skills: SkillInfo[] }>(API.SKILLS.DELETE(name)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.skills });
    },
  });
}

export function useSkillDetail(name: string | null) {
  return useQuery({
    queryKey: [...queryKeys.skills, "detail", name ?? ""],
    queryFn: () => api.get<SkillInfo & { content: string }>(API.SKILLS.DETAIL(name!)),
    enabled: !!name,
    staleTime: 30_000,
  });
}
