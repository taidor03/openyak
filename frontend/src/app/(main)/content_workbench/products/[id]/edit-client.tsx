"use client";
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ClientOnly } from "@/components/ui/client-only";
import { getProduct, updateProduct } from "@/lib/xflow-api";

function EditProductForm({ id }: { id: string }) {
  const { t } = useTranslation("contentWorkbench");
  const router = useRouter();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["xflow", "product", id], queryFn: () => getProduct(id) });
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");

  useEffect(() => { if (data) { setTitle(data.title); setPrice(String(data.price ?? "")); } }, [data]);

  const mut = useMutation({
    mutationFn: (d: { title: string; price?: number }) => updateProduct(id, d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["xflow", "products"] }); router.push("/content_workbench/products"); },
  });

  return (
    <div className="max-w-lg space-y-4">
      <h1 className="text-xl font-semibold">{t("edit")} {t("products")}</h1>
      <div className="space-y-2"><Label>{t("productTitle")}</Label><Input value={title} onChange={e => setTitle(e.target.value)} /></div>
      <div className="space-y-2"><Label>{t("productPrice")}</Label><Input type="number" value={price} onChange={e => setPrice(e.target.value)} /></div>
      <div className="flex gap-2">
        <Button onClick={() => mut.mutate({ title, price: price ? Number(price) : undefined })} disabled={!title || mut.isPending}>{t("save")}</Button>
        <Button variant="outline" onClick={() => router.back()}>{t("cancel")}</Button>
      </div>
    </div>
  );
}

export function EditProductClient() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  if (!id || id === "_") return null;
  return <ClientOnly><EditProductForm id={id} /></ClientOnly>;
}
