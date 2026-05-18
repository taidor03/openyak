"use client";

import { useTranslation } from "react-i18next";
import { KnowledgeCenterContent } from "./content";
import { ClientOnly } from "@/components/ui/client-only";

export default function KnowledgeCenterPage() {
  const { t } = useTranslation("common");

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border-primary)]">
        <h1 className="text-lg font-semibold">{t("knowledgeCenter", "Knowledge Center")}</h1>
      </div>
      <div className="flex-1 overflow-hidden">
        <ClientOnly>
          <KnowledgeCenterContent />
        </ClientOnly>
      </div>
    </div>
  );
}
