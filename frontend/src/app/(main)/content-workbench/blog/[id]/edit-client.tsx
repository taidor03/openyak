"use client";
import { useState, useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ClientOnly } from "@/components/ui/client-only";
import { getBlog, updateBlog } from "@/lib/xflow-api";

function EditBlogForm({ id }: { id: string }) {
  const { t } = useTranslation("contentWorkbench");
  const router = useRouter();
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ["xflow", "blog", id], queryFn: () => getBlog(id) });
  const [title, setTitle] = useState("");
  useEffect(() => { if (data) setTitle(data.title); }, [data]);
  const mut = useMutation({ mutationFn: (d: { title: string }) => updateBlog(id, d), onSuccess: () => { qc.invalidateQueries({ queryKey: ["xflow", "blogs"] }); router.push("/content-workbench/blog"); } });
  return (
    <div className="max-w-lg space-y-4">
      <h1 className="text-xl font-semibold">{t("edit")} {t("blogs")}</h1>
      <div className="space-y-2"><Label>{t("blogTitle")}</Label><Input value={title} onChange={e => setTitle(e.target.value)} /></div>
      <div className="flex gap-2">
        <Button onClick={() => mut.mutate({ title })} disabled={!title || mut.isPending}>{t("save")}</Button>
        <Button variant="outline" onClick={() => router.back()}>{t("cancel")}</Button>
      </div>
    </div>
  );
}

export function EditBlogClient() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  if (!id || id === "_") return null;
  return <ClientOnly><EditBlogForm id={id} /></ClientOnly>;
}
