"use client";

import { useQuery } from "@tanstack/react-query";

import { getDashboardStats, getXflowConfig } from "@/lib/xflow-api";

export function useXflowDashboard() {
  const hasConfig =
    typeof window !== "undefined" && getXflowConfig() !== null;

  return useQuery({
    queryKey: ["xflow", "dashboard"],
    queryFn: getDashboardStats,
    enabled: hasConfig,
    staleTime: 60_000,
    retry: 1,
  });
}
