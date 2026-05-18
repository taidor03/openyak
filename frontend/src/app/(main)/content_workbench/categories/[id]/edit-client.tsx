"use client";
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ClientOnly } from "@/components/ui/client-only";
import { getCategory, updateCategory } from "@/lib/xflow-api";

function EditCategoryForm({ id }: { id: string }) {
  const { t } = useTranslation("contentWorkbench");
  const router = useRouter();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["xflow", "category", id], queryFn: () => getCategory(id) });
  const [name, setName] = useState("");
  useEffect(() => { if (data) setName(data.name); }, [data]);
  const mut = useMutation({ mutationFn: (d: { name: string }) => updateCategory(id, d), onSuccess: () => { qc.invalidateQueries({ queryKey: ["xflow", "categories"] }); router.push("/content_workbench/categories"); } });
  return (
    <div className="max-w-lg space-y-4">
      <h1 className="text-xl font-semibold">{t("edit")} {t("categories")}</h1>
      <div className="space-y-2"><Label>{t("categoryName")}</Label><Input value={name} onChange={e => setName(e.target.value)} /></div>
      <div className="flex gap-2">
        <Button onClick={() => mut.mutate({ name })} disabled={!name || mut.isPending}>{t("save")}</Button>
        <Button variant="outline" onClick={() => router.back()}>{t("cancel")}</Button>
      </div>
    </div>
  );
}

export function EditCategoryClient() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  if (!id || id === "_") return null;
  return <ClientOnly><EditCategoryForm id={id} /></ClientOnly>;
}
