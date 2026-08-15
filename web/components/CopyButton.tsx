"use client";

import { useState } from "react";

export function CopyButton({ value, label = "copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard is blocked without a user gesture or on insecure origins.
      // The text is on screen either way, so there is nothing to recover from.
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="rounded border border-edge px-2 py-1 text-xs text-dim transition-colors hover:border-signal hover:text-signal"
    >
      {copied ? "copied" : label}
    </button>
  );
}
