"use client";

import { type ReactNode, useCallback, useEffect, useState } from "react";
import { MotionConfig } from "framer-motion";
import { ThemeProvider } from "./theme-provider";
import { QueryProvider } from "./query-provider";
import { BackendReadyProvider } from "./backend-ready-provider";
import { ErrorBoundary } from "@/components/ui/error-boundary";
import { Toaster } from "sonner";
import { getBackendUrl, IS_DESKTOP } from "@/lib/constants";
import { AppearanceInjector } from "@/components/layout/appearance-injector";
import { getClientLanguagePreference } from "@/i18n/config";
import { useTranslation } from "react-i18next";

function LanguageSync({ onReady }: { onReady: () => void }) {
  const { i18n } = useTranslation();

  useEffect(() => {
    let mounted = true;
    const handler = (lng: string) => {
      document.documentElement.lang = lng;
    };
    i18n.on("languageChanged", handler);

    const preferredLanguage = getClientLanguagePreference();
    const applyLanguage = async () => {
      if (i18n.language !== preferredLanguage) {
        await i18n.changeLanguage(preferredLanguage);
      }
      if (!mounted) return;
      document.documentElement.lang = i18n.language;
      onReady();
    };
    void applyLanguage();

    return () => {
      mounted = false;
      i18n.off("languageChanged", handler);
    };
  }, [i18n, onReady]);

  return null;
}

/** Retry interval for polling the backend URL during startup. */
const BACKEND_URL_RETRY_MS = 500;

export function AppProviders({ children }: { children: ReactNode }) {
  const [backendReady, setBackendReady] = useState(!IS_DESKTOP);
  const [languageReady, setLanguageReady] = useState(false);
  const handleLanguageReady = useCallback(() => setLanguageReady(true), []);

  // In desktop mode the backend may not be ready when the window first
  // appears (the shell shows the window immediately and starts the
  // backend in the background).  Poll getBackendUrl() until it resolves
  // successfully — the Rust side returns an error while the port is 0.
  useEffect(() => {
    if (!IS_DESKTOP) return;
    let mounted = true;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const tryResolve = async () => {
      try {
        await getBackendUrl();
        // Backend URL resolved — backend is up.
        if (mounted) setBackendReady(true);
      } catch {
        // Backend not ready yet — retry after a short delay.
        if (mounted) {
          timeoutId = setTimeout(tryResolve, BACKEND_URL_RETRY_MS);
        }
      }
    };

    void tryResolve();

    return () => {
      mounted = false;
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, []);

  if (!backendReady || !languageReady) {
    return <LanguageSync onReady={handleLanguageReady} />;
  }

  return (
    <MotionConfig reducedMotion="user">
      <ThemeProvider>
        <QueryProvider>
          <BackendReadyProvider>
            <LanguageSync onReady={handleLanguageReady} />
            <AppearanceInjector />
            <ErrorBoundary>{children}</ErrorBoundary>
            <Toaster
              position="top-right"
              richColors
              closeButton
              toastOptions={{
                style: {
                  background: "var(--surface-secondary)",
                  color: "var(--text-primary)",
                  border: "1px solid var(--border-default)",
                },
              }}
            />
          </BackendReadyProvider>
        </QueryProvider>
      </ThemeProvider>
    </MotionConfig>
  );
}
