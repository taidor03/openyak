"use client";
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ClientOnly } from "@/components/ui/client-only";
import { updateOutfit } from "@/lib/xflow-api";

function EditOutfitForm({ id }: { id: string }) {
  const { t } = useTranslation("contentWorkbench");
  const router = useRouter();
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const { data } = useQuery({ queryKey: ["xflow", "outfit", id], queryFn: () => import("@/lib/xflow-api").then(m => m.listOutfits({ page: 1, page_size: 100 })) });
  useEffect(() => { if (data) { const o = data.items.find((x: { id: number | string }) => String(x.id) === id); if (o) setTitle(o.title); } }, [data, id]);
  const mut = useMutation({ mutationFn: (d: { title: string }) => updateOutfit(id, d), onSuccess: () => { qc.invalidateQueries({ queryKey: ["xflow", "outfits"] }); router.push("/content_workbench/outfits"); } });
  return (
    <div className="max-w-lg space-y-4">
      <h1 className="text-xl font-semibold">{t("edit")} {t("outfits")}</h1>
      <div className="space-y-2"><Label>{t("outfitTitle")}</Label><Input value={title} onChange={e => setTitle(e.target.value)} /></div>
      <div className="flex gap-2">
        <Button onClick={() => mut.mutate({ title })} disabled={!title || mut.isPending}>{t("save")}</Button>
        <Button variant="outline" onClick={() => router.back()}>{t("cancel")}</Button>
      </div>
    </div>
  );
}

export function EditOutfitClient() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  if (!id || id === "_") return null;
  return <ClientOnly><EditOutfitForm id={id} /></ClientOnly>;
}
