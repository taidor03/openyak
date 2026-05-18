"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ClientOnly } from "@/components/ui/client-only";
import { createBlog } from "@/lib/xflow-api";

function NewBlogForm() {
  const { t } = useTranslation("contentWorkbench");
  const router = useRouter();
  const qc = useQueryClient();
  const [title, setTitle] = useState("");
  const mut = useMutation({ mutationFn: createBlog, onSuccess: () => { qc.invalidateQueries({ queryKey: ["xflow", "blogs"] }); router.push("/content_workbench/blogs"); } });
  return (
    <div className="max-w-lg space-y-4">
      <h1 className="text-xl font-semibold">{t("new")} {t("blogs")}</h1>
      <div className="space-y-2"><Label>{t("blogTitle")}</Label><Input value={title} onChange={e => setTitle(e.target.value)} /></div>
      <div className="flex gap-2">
        <Button onClick={() => mut.mutate({ title })} disabled={!title || mut.isPending}>{t("save")}</Button>
        <Button variant="outline" onClick={() => router.back()}>{t("cancel")}</Button>
      </div>
    </div>
  );
}
export default function NewBlogPage() { return <ClientOnly><NewBlogForm /></ClientOnly>; }
