"use client";

import { useTranslation } from "react-i18next";
import Link from "next/link";
import { useXflowDashboard } from "@/hooks/use-xflow-dashboard";
import { getXflowConfig } from "@/lib/xflow-api";
import { ClientOnly } from "@/components/ui/client-only";

function DashboardContent() {
  const { t } = useTranslation("contentWorkbench");
  const { data, isLoading, error } = useXflowDashboard();
  const isConfigured = Boolean(getXflowConfig());

  if (!isConfigured) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center gap-4">
        <p className="text-lg font-medium">{t("notConfigured")}</p>
        <p className="text-sm text-[var(--text-secondary)]">{t("notConfiguredDesc")}</p>
        <Link href="/settings?tab=xflow" className="text-sm text-[var(--brand-primary)] underline">{t("goToSettings")}</Link>
      </div>
    );
  }

  if (isLoading) {
    return <div className="py-8 text-center text-sm text-[var(--text-secondary)]">{t("loading")}</div>;
  }

  if (error) {
    return <div className="py-8 text-center text-sm text-red-500">{t("error")}: {String(error)}</div>;
  }

  const sections = [
    { key: "products", label: t("products"), data: data?.products },
    { key: "blogs", label: t("blogs"), data: data?.blogs },
    { key: "categories", label: t("categories"), data: { total: data?.categories?.total, published: data?.categories?.total, draft: 0 } },
    { key: "outfits", label: t("outfits"), data: data?.outfits },
    { key: "videos", label: t("videos"), data: data?.videos },
  ];

  return (
    <div>
      <h1 className="text-xl font-semibold mb-6">{t("dashboard")}</h1>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {sections.map(({ key, label, data: d }) => (
          <div key={key} className="rounded-xl border border-[var(--border)] bg-[var(--surface-primary)] p-4 space-y-2">
            <p className="text-sm font-medium text-[var(--text-secondary)]">{label}</p>
            <p className="text-2xl font-bold">{d?.total ?? "—"}</p>
            {d && "published" in d && (
              <div className="flex gap-3 text-xs text-[var(--text-secondary)]">
                <span>{t("published")}: {d.published}</span>
                <span>{t("draft")}: {d.draft}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ContentWorkbenchPage() {
  return <ClientOnly><DashboardContent /></ClientOnly>;
}
