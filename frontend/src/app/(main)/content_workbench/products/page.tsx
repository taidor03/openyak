"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ClientOnly } from "@/components/ui/client-only";
import { listProducts, deleteProduct } from "@/lib/xflow-api";

function ProductsContent() {
  const { t } = useTranslation("contentWorkbench");
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["xflow", "products", page, search],
    queryFn: () => listProducts({ page, page_size: 20, search }),
    staleTime: 30_000,
  });

  const deleteMut = useMutation({
    mutationFn: deleteProduct,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["xflow", "products"] }),
  });

  if (isLoading) return <div className="py-8 text-center text-sm text-[var(--text-secondary)]">{t("loading")}</div>;
  if (error) return <div className="py-8 text-center text-sm text-red-500">{t("error")}</div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">{t("products")}</h1>
        <Button size="sm" asChild><Link href="/content_workbench/products/new"><Plus className="h-4 w-4 mr-1" />{t("new")}</Link></Button>
      </div>
      <Input placeholder={t("search")} value={search} onChange={e => setSearch(e.target.value)} className="max-w-xs" />
      {data?.items?.length === 0 ? (
        <p className="text-sm text-[var(--text-secondary)] py-4">{t("noData")}</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
          <table className="w-full text-sm">
            <thead className="bg-[var(--surface-secondary)]">
              <tr>
                <th className="text-left px-3 py-2 font-medium">{t("title_field")}</th>
                <th className="text-left px-3 py-2 font-medium">{t("price")}</th>
                <th className="text-left px-3 py-2 font-medium">{t("status")}</th>
                <th className="text-right px-3 py-2 font-medium">{t("actions")}</th>
              </tr>
            </thead>
            <tbody>
              {data?.items?.map(p => (
                <tr key={p.id} className="border-t border-[var(--border)]">
                  <td className="px-3 py-2">{p.title}</td>
                  <td className="px-3 py-2">{p.price != null ? `¥${p.price}` : "—"}</td>
                  <td className="px-3 py-2">{p.status ?? "—"}</td>
                  <td className="px-3 py-2 text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" className="h-7 w-7" asChild>
                        <Link href={`/content_workbench/products/${p.id}`}><Pencil className="h-3.5 w-3.5" /></Link>
                      </Button>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-red-500" onClick={() => confirm(t("deleteConfirm")) && deleteMut.mutate(p.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
        <Button variant="outline" size="sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page <= 1}>{t("prevPage")}</Button>
        <span>{t("page", { page })}</span>
        <Button variant="outline" size="sm" onClick={() => setPage(p => p + 1)} disabled={!data || data.items.length < 20}>{t("nextPage")}</Button>
        {data && <span className="ml-2">{t("totalItems", { total: data.total })}</span>}
      </div>
    </div>
  );
}

export default function ProductsPage() {
  return <ClientOnly><ProductsContent /></ClientOnly>;
}
