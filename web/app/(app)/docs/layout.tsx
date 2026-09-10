import type { ReactNode } from "react";
import { DocsShell } from "@/components/DocsShell";

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="py-4">
      <DocsShell>{children}</DocsShell>
    </div>
  );
}
