"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { useState, type ReactNode } from "react";
import {
  localStoragePersister,
  dehydrateOptions,
  PERSIST_MAX_AGE_MS,
} from "@/lib/query-persister";

export function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000,
            // Keep persisted queries alive while the backend is starting up.
            gcTime: PERSIST_MAX_AGE_MS,
            retry: 1,
            refetchOnWindowFocus: false,
            structuralSharing: true,
          },
        },
      }),
  );

  // Graceful fallback when localStorage is unavailable (SSR / private browsing)
  if (!localStoragePersister) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }

  return (
    <PersistQueryClientProvider
      client={queryClient}
      persistOptions={{
        persister: localStoragePersister,
        maxAge: PERSIST_MAX_AGE_MS,
        dehydrateOptions,
      }}
    >
      {children}
    </PersistQueryClientProvider>
  );
}
