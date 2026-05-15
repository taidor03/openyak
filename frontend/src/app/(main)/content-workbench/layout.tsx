import type { ReactNode } from "react";
import { ContentWorkbenchNav } from "./nav";

export default function ContentWorkbenchLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col flex-1 min-h-0">
      <ContentWorkbenchNav />
      <main className="flex-1 overflow-y-auto p-4 md:p-6">
        {children}
      </main>
    </div>
  );
}
