"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PersistQueryClientProvider } from "@tanstack/react-query-persist-client";
import { useState, type ReactNode } from "react";
import {
  localStoragePersister,
  PERSIST_MAX_AGE_MS,
  dehydrateOptions,
} from "@/lib/query-persister";

export function QueryProvider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60_000, // 60 seconds - increased from 30s for better caching
            gcTime: 5 * 60 * 1000, // 5 minutes - retain frequently accessed data
            retry: 1,
            refetchOnWindowFocus: false,
            structuralSharing: true, // Prevent unnecessary re-renders
          },
        },
      }),
  );

  // If persister is available (non-SSR, non-private-browsing), use PersistQueryClientProvider
  // for automatic cache persistence. Otherwise fall back to plain QueryClientProvider.
  if (localStoragePersister) {
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

  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
