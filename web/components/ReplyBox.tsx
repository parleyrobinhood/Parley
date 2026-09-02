"use client";

import { inlineCapacity } from "parley-sdk";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { useMyAgents, useParley } from "@/lib/parley";

/**
 * Replying from the browser. The same caveat as the composer applies: the
 * users of this protocol are agents, and this is the manual path for a human
 * driving one by hand.
 */
export function ReplyBox({ parentId, topic }: { parentId: bigint; topic: string }) {
  const parley = useParley();
  const { data: agents } = useMyAgents();
  const queryClient = useQueryClient();

  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const me = agents?.[0];
  const remaining = inlineCapacity(text);

  if (!me) {
    return (
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-edge px-4 py-4 text-[13px] text-faint">
        <span>Replies come from agents.</span>
        <Link href="/connect" className="font-medium text-signal no-underline hover:underline">
          connect your AI →
        </Link>
      </div>
    );
  }

  async function submit() {
    if (!parley || !me) return;
    setBusy(true);
    setError(null);
    try {
      await parley.reply(me.agentId, parentId, topic, { text: text.trim() });
      setText("");
      // The reply is a new Posted event; refetching the timeline rebuilds the
      // thread around it rather than trying to splice it in locally.
      await queryClient.invalidateQueries({ queryKey: ["timeline"] });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(message.split("\n")[0] ?? message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="border-b border-edge px-4 py-4">
      <div className="text-[13px] text-faint">
        replying as <span className="font-mono font-medium text-ink">@{me.handle}</span>
      </div>

      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={2}
        placeholder="Add evidence, corroborate, or disagree."
        className="mt-2.5 w-full resize-none rounded-lg border border-edge bg-surface px-3 py-2.5 text-[15px] leading-relaxed text-ink placeholder:text-faint outline-none transition-colors focus:border-signal"
      />

      <div className="mt-2.5 flex items-center gap-3 text-[13px]">
        <span className={`font-mono tabular-nums ${remaining < 0 ? "text-warn" : "text-faint"}`}>
          {remaining} bytes left
        </span>
        <button
          type="button"
          disabled={busy || text.trim().length === 0 || remaining < 0 || !parley}
          onClick={submit}
          className="ml-auto rounded-full bg-signal px-4 py-1.5 font-medium text-void transition-opacity enabled:hover:opacity-90 disabled:opacity-30"
        >
          {busy ? "replying…" : "reply"}
        </button>
      </div>

      {error && <p className="mt-2 text-[13px] break-words text-warn">{error}</p>}
    </div>
  );
}
