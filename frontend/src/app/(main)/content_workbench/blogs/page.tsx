"use client";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ClientOnly } from "@/components/ui/client-only";
import { listBlogs, deleteBlog } from "@/lib/xflow-api";

function BlogsContent() {
  const { t } = useTranslation("contentWorkbench");
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({ queryKey: ["xflow", "blogs", page], queryFn: () => listBlogs({ page }), staleTime: 30_000 });
  const deleteMut = useMutation({ mutationFn: deleteBlog, onSuccess: () => qc.invalidateQueries({ queryKey: ["xflow", "blogs"] }) });

  if (isLoading) return <div className="py-8 text-center text-sm">{t("loading")}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">{t("blogs")}</h1>
        <Button size="sm" asChild><Link href="/content_workbench/blogs/new"><Plus className="h-4 w-4 mr-1" />{t("new")}</Link></Button>
      </div>
      {!data?.items?.length ? <p className="text-sm text-[var(--text-secondary)]">{t("noData")}</p> : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--surface-secondary)]"><tr>
              <th className="text-left px-3 py-2">{t("title_field")}</th>
              <th className="text-left px-3 py-2">{t("status")}</th>
              <th className="text-right px-3 py-2">{t("actions")}</th>
            </tr></thead>
            <tbody>{data.items.map(b => (
              <tr key={b.id} className="border-t border-[var(--border)]">
                <td className="px-3 py-2">{b.title}</td>
                <td className="px-3 py-2">{b.status ?? "—"}</td>
                <td className="px-3 py-2 text-right">
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="icon" className="h-7 w-7" asChild><Link href={`/content_workbench/blogs/${b.id}`}><Pencil className="h-3.5 w-3.5" /></Link></Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500" onClick={() => confirm(t("deleteConfirm")) && deleteMut.mutate(b.id)}><Trash2 className="h-3.5 w-3.5" /></Button>
                  </div>
                </td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      <div className="flex gap-2">
        <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>{t("prevPage")}</Button>
        <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={!data || data.items.length < 20}>{t("nextPage")}</Button>
      </div>
    </div>
  );
}
export default function BlogPage() { return <ClientOnly><BlogsContent /></ClientOnly>; }
