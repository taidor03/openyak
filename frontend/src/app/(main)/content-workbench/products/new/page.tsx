"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ClientOnly } from "@/components/ui/client-only";
import { createProduct } from "@/lib/xflow-api";

function NewProductForm() {
  const { t } = useTranslation("contentWorkbench");
  const router = useRouter();
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const [price, setPrice] = useState("");

  const mut = useMutation({
    mutationFn: createProduct,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["xflow", "products"] }); router.push("/content-workbench/products"); },
  });

  return (
    <div className="max-w-lg space-y-4">
      <h1 className="text-xl font-semibold">{t("new")} {t("products")}</h1>
      <div className="space-y-2"><Label>{t("productTitle")}</Label><Input value={title} onChange={e => setTitle(e.target.value)} /></div>
      <div className="space-y-2"><Label>{t("productPrice")}</Label><Input type="number" value={price} onChange={e => setPrice(e.target.value)} /></div>
      <div className="flex gap-2">
        <Button onClick={() => mut.mutate({ title, price: price ? Number(price) : undefined })} disabled={!title || mut.isPending}>{t("save")}</Button>
        <Button variant="outline" onClick={() => router.back()}>{t("cancel")}</Button>
      </div>
      {mut.error && <p className="text-sm text-red-500">{String(mut.error)}</p>}
    </div>
  );
}

export default function NewProductPage() { return <ClientOnly><NewProductForm /></ClientOnly>; }
