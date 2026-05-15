"use client";

import { useCallback, useEffect, useState } from "react";

import {
  clearXflowConfig,
  getXflowConfig,
  setXflowConfig,
  testXflowConnection,
} from "@/lib/xflow-api";

interface XflowConfigState {
  url: string;
  token: string;
  isConfigured: boolean;
}

interface UseXflowConfigReturn extends XflowConfigState {
  setUrl: (url: string) => void;
  setToken: (token: string) => void;
  save: () => void;
  clear: () => void;
  testConnection: () => Promise<{ ok: boolean; message: string }>;
}

export function useXflowConfig(): UseXflowConfigReturn {
  const [url, setUrl] = useState("");
  const [token, setToken] = useState("");

  useEffect(() => {
    const cfg = getXflowConfig();
    if (cfg) {
      setUrl(cfg.url);
      setToken(cfg.token);
    }
  }, []);

  const save = useCallback(() => {
    const trimmedUrl = url.trim();
    const trimmedToken = token.trim();
    if (trimmedUrl && trimmedToken) {
      setXflowConfig({ url: trimmedUrl, token: trimmedToken });
    }
  }, [url, token]);

  const clear = useCallback(() => {
    clearXflowConfig();
    setUrl("");
    setToken("");
  }, []);

  const testConnection = useCallback(async () => {
    const trimmedUrl = url.trim();
    const trimmedToken = token.trim();
    if (!trimmedUrl || !trimmedToken) {
      return { ok: false, message: "请先填写 URL 和 Token" };
    }
    return testXflowConnection(trimmedUrl, trimmedToken);
  }, [url, token]);

  const storedConfig = getXflowConfig();
  const isConfigured = Boolean(storedConfig?.url && storedConfig?.token);

  return {
    url,
    token,
    isConfigured,
    setUrl,
    setToken,
    save,
    clear,
    testConnection,
  };
}
