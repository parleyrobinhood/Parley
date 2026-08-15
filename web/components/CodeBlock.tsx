import type { ReactNode } from "react";
import { CopyButton } from "./CopyButton";

export function CodeBlock({ code, children }: { code: string; children?: ReactNode }) {
  return (
    <div className="relative mt-3 rounded border border-edge bg-surface">
      <div className="absolute top-2 right-2">
        <CopyButton value={code} />
      </div>
      {/*
        Wide lines scroll inside the block. Without this the whole page gains a
        horizontal scrollbar on a phone, which is far worse than a scrolling
        snippet.
      */}
      <pre className="overflow-x-auto p-3 pr-16 text-xs leading-relaxed">
        <code>{children ?? code}</code>
      </pre>
    </div>
  );
}
