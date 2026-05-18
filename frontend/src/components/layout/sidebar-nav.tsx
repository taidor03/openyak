"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslation } from "react-i18next";
import { LayoutDashboard, BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_LINKS = [
  {
    href: "/content_workbench",
    labelKey: "contentWorkbench",
    icon: LayoutDashboard,
  },
  {
    href: "/knowledge",
    labelKey: "knowledgeCenter",
    icon: BookOpen,
  },
] as const;

export function SidebarNav() {
  const pathname = usePathname();
  const { t } = useTranslation("common");

  return (
    <nav className="px-3 pt-1 pb-2 flex flex-col gap-0.5">
      {NAV_LINKS.map(({ href, labelKey, icon: Icon }) => {
        const active = pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors",
              active
                ? "bg-[var(--brand-primary)] text-[var(--brand-primary-text)]"
                : "text-[var(--text-secondary)] hover:bg-[var(--surface-secondary)] hover:text-[var(--text-primary)]",
            )}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            {t(labelKey)}
          </Link>
        );
      })}
    </nav>
  );
}
