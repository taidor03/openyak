"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { LayoutDashboard, Package, FileText, Tag, Layers, Video } from "lucide-react";

const NAV_ITEMS = [
  { href: "/content_workbench", label: "dashboard", icon: LayoutDashboard, exact: true },
  { href: "/content_workbench/products", label: "products", icon: Package, exact: false },
  { href: "/content_workbench/blogs", label: "blogs", icon: FileText, exact: false },
  { href: "/content_workbench/categories", label: "categories", icon: Tag, exact: false },
  { href: "/content_workbench/outfits", label: "outfits", icon: Layers, exact: false },
  { href: "/content_workbench/videos", label: "videos", icon: Video, exact: false },
] as const;

export function ContentWorkbenchNav() {
  const pathname = usePathname();
  const { t } = useTranslation("contentWorkbench");
  return (
    <nav className="flex gap-1 px-4 pt-4 pb-2 border-b border-[var(--border)] overflow-x-auto shrink-0">
      {NAV_ITEMS.map(({ href, label, icon: Icon, exact }) => {
        const active = exact ? pathname === href : pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-medium transition-colors shrink-0",
              active
                ? "bg-[var(--brand-primary)] text-[var(--brand-primary-text)]"
                : "text-[var(--text-secondary)] hover:bg-[var(--surface-secondary)]",
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {t(label)}
          </Link>
        );
      })}
    </nav>
  );
}
