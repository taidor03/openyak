"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ClientOnly } from "@/components/ui/client-only";
import { createCategory } from "@/lib/xflow-api";

function NewCategoryForm() {
  const { t } = useTranslation("contentWorkbench");
  const router = useRouter();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const mut = useMutation({ mutationFn: createCategory, onSuccess: () => { qc.invalidateQueries({ queryKey: ["xflow", "categories"] }); router.push("/content_workbench/categories"); } });
  return (
    <div className="max-w-lg space-y-4">
      <h1 className="text-xl font-semibold">{t("new")} {t("categories")}</h1>
      <div className="space-y-2"><Label>{t("categoryName")}</Label><Input value={name} onChange={e => setName(e.target.value)} /></div>
      <div className="flex gap-2">
        <Button onClick={() => mut.mutate({ name })} disabled={!name || mut.isPending}>{t("save")}</Button>
        <Button variant="outline" onClick={() => router.back()}>{t("cancel")}</Button>
      </div>
    </div>
  );
}
export default function NewCategoryPage() { return <ClientOnly><NewCategoryForm /></ClientOnly>; }
