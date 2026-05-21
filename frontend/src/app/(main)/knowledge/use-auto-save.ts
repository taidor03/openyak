/**
 * useAutoSave — 自动保存草稿到 localStorage，支持恢复。
 *
 * 设计：
 * - 30s 定时保存 + 5s debounce（最后一次变更后 5s 立即保存）
 * - 每次变更重置 30s 定时器
 * - 提供 `loadDraft()` 恢复上次的草稿
 * - 提供 `clearDraft()` 清除草稿
 * - 提供 `hasDraft` 判断是否有可恢复的草稿
 */
"use client";

import { useState, useEffect, useRef, useCallback } from "react";

export type AutoSaveStatus = "saved" | "saving" | "unsaved";

export interface AutoSaveDraft {
  title: string;
  content: string;
  category: string;
  savedAt: string;
}

export interface UseAutoSaveOptions {
  /** 保存的 key 前缀，默认 "wiki-draft" */
  keyPrefix?: string;
  /** debounce 延迟（ms），默认 5000 */
  debounceMs?: number;
  /** 定时保存间隔（ms），默认 30000 */
  intervalMs?: number;
}

export interface UseAutoSaveReturn {
  status: AutoSaveStatus;
  hasDraft: boolean;
  loadDraft: () => AutoSaveDraft | null;
  clearDraft: () => void;
  draftSavedAt: string | null;
}

export function useAutoSave(
  title: string,
  content: string,
  category: string,
  options: UseAutoSaveOptions = {},
): UseAutoSaveReturn {
  const { keyPrefix = "wiki-draft", debounceMs = 5000, intervalMs = 30000 } = options;
  const [status, setStatus] = useState<AutoSaveStatus>("saved");
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSavedRef = useRef<string>("");

  // Compute the localStorage key
  const draftKey = `${keyPrefix}-${title || "untitled"}`;

  // Check if draft exists
  const hasDraft = typeof window !== "undefined" && !!localStorage.getItem(draftKey);

  // Save function
  const saveDraft = useCallback(() => {
    if (!title.trim() && !content.trim()) return;

    setStatus("saving");
    try {
      const draft: AutoSaveDraft = {
        title,
        content,
        category,
        savedAt: new Date().toISOString(),
      };
      const serialized = JSON.stringify(draft);
      const currentKey = `${keyPrefix}-${title || "untitled"}`;
      localStorage.setItem(currentKey, serialized);
      lastSavedRef.current = serialized;
      setDraftSavedAt(draft.savedAt);
      setStatus("saved");
    } catch {
      setStatus("unsaved");
    }
  }, [title, content, category, keyPrefix]);

  // Load draft function
  const loadDraft = useCallback((): AutoSaveDraft | null => {
    try {
      const currentKey = `${keyPrefix}-${title || "untitled"}`;
      const raw = localStorage.getItem(currentKey);
      if (!raw) return null;
      return JSON.parse(raw) as AutoSaveDraft;
    } catch {
      return null;
    }
  }, [keyPrefix, title]);

  // Clear draft function
  const clearDraft = useCallback(() => {
    try {
      const currentKey = `${keyPrefix}-${title || "untitled"}`;
      localStorage.removeItem(currentKey);
      setDraftSavedAt(null);
    } catch {
      // Ignore
    }
  }, [keyPrefix, title]);

  // Debounced save — triggered on every content change
  useEffect(() => {
    // Clear previous debounce timer
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }

    // Only auto-save if there's content
    if (!title.trim() && !content.trim()) {
      return;
    }

    // Check if content actually changed vs last saved
    const currentSerialized = JSON.stringify({ title, content, category });
    if (currentSerialized === lastSavedRef.current) {
      return;
    }

    setStatus("unsaved");

    // Debounced auto-save (after last change)
    debounceRef.current = setTimeout(() => {
      saveDraft();
    }, debounceMs);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [title, content, category, debounceMs, saveDraft]);

  // Periodic save every intervalMs
  useEffect(() => {
    // Clear previous interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }

    if (!title.trim() && !content.trim()) {
      return;
    }

    intervalRef.current = setInterval(() => {
      const currentSerialized = JSON.stringify({ title, content, category });
      if (currentSerialized !== lastSavedRef.current) {
        saveDraft();
      }
    }, intervalMs);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [title, content, category, intervalMs, saveDraft]);

  // Load draftSavedAt on mount
  useEffect(() => {
    const draft = loadDraft();
    if (draft) {
      setDraftSavedAt(draft.savedAt);
    }
  }, [loadDraft]);

  return {
    status,
    hasDraft,
    loadDraft,
    clearDraft,
    draftSavedAt,
  };
}
