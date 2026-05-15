"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { ClientOnly } from "@/components/ui/client-only";
import { listVideos } from "@/lib/xflow-api";

function VideosContent() {
  const { t } = useTranslation("contentWorkbench");
  const [page, setPage] = useState(1);
  const { data, isLoading, error } = useQuery({
    queryKey: ["xflow", "videos", page],
    queryFn: () => listVideos({ page }),
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="py-8 text-center text-sm text-[var(--text-secondary)]">
        {t("loading")}
      </div>
    );
  }
  if (error) {
    return (
      <div className="py-8 text-center text-sm text-red-500">{t("error")}</div>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">{t("videos")}</h1>
      {!data?.items?.length ? (
        <p className="text-sm text-[var(--text-secondary)]">{t("noData")}</p>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {data.items.map((v) => (
            <div
              key={v.id}
              className="rounded-xl border border-[var(--border)] bg-[var(--surface-primary)] p-3 space-y-1"
            >
              <p className="font-medium text-sm">{v.title}</p>
              <p className="text-xs text-[var(--text-secondary)]">
                {v.status ?? "—"}
              </p>
              {v.url && (
                <a
                  href={v.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-[var(--brand-primary)] underline"
                >
                  {v.url}
                </a>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setPage((p) => Math.max(1, p - 1))}
          disabled={page <= 1}
        >
          {t("prevPage")}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setPage((p) => p + 1)}
          disabled={!data || data.items.length < 20}
        >
          {t("nextPage")}
        </Button>
      </div>
    </div>
  );
}

export default function VideosPage() {
  return (
    <ClientOnly>
      <VideosContent />
    </ClientOnly>
  );
}
