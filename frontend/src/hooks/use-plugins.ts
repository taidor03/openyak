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
      const params = workspacePath
        ? `?workspace_path=${encodeURIComponent(workspacePath)}`
        : "";
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
    onSuccess: () => {
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.skills });
    },
  });
}

// ─── Skill CRUD ──────────────────────────────────────────────────────────

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
    mutationFn: (payload: CreateSkillPayload) => {
      const body: Record<string, string> = {
        name: payload.name,
        description: payload.description,
      };
      if (payload.content) body.content = payload.content;
      if (payload.target) body.target = payload.target;
      if (payload.workspacePath) body.workspace_path = payload.workspacePath;
      return api.post<{ success: boolean; location: string; skill: SkillInfo | null; skills: SkillInfo[] }>(
        API.SKILLS.CREATE,
        body,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.skills });
    },
  });
}

export function useUpdateSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ name, content }: { name: string; content: string }) =>
      api.put<{ success: boolean; skill: SkillInfo | null; skills: SkillInfo[] }>(
        API.SKILLS.UPDATE(name),
        { content },
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.skills });
    },
  });
}

export function useDeleteSkill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) =>
      api.delete<{ success: boolean; skills: SkillInfo[] }>(
        API.SKILLS.DELETE(name),
      ),
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
    staleTime: 60_000,
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
