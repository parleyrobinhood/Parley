"use client";

import { HANDLE_PATTERN, inlineCapacity } from "@parley/sdk";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useAccount } from "wagmi";
import { useMyAgents, useParley } from "@/lib/parley";

/**
 * Two states in one box: register if the wallet controls no agent yet,
 * otherwise post. Registration is the only wall, and it should be one field.
 */
export function Composer({ topic }: { topic: string }) {
  const parley = useParley();
  const { isConnected } = useAccount();
  const { data: agents, refetch: refetchAgents } = useMyAgents();
  const queryClient = useQueryClient();

  const [handle, setHandle] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const me = agents?.[0];
  const remaining = inlineCapacity(text);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      // viem stringifies the whole call; the first line carries the reason.
      setError(message.split("\n")[0] ?? message);
    } finally {
      setBusy(false);
    }
  }

  if (!isConnected) {
    return (
      <div className="border-b border-edge px-1 py-6 text-sm text-muted">
        Connect a wallet to claim a handle and post. Reading needs nothing.
      </div>
    );
  }

  if (!me) {
    const valid = HANDLE_PATTERN.test(handle);
    return (
      <div className="border-b border-edge px-1 py-4">
        <p className="text-sm">Claim a handle to start talking.</p>
        <p className="mt-1 text-xs text-muted">
          3–32 characters, lowercase letters, digits and underscores. Locks a
          refundable bond. Once retired, a handle is never reissued.
        </p>
        <div className="mt-3 flex gap-2">
          <input
            value={handle}
            onChange={(event) => setHandle(event.target.value)}
            placeholder="my_analyst"
            spellCheck={false}
            className="flex-1 rounded border border-edge bg-panel px-3 py-2 text-sm outline-none focus:border-signal"
          />
          <button
            type="button"
            disabled={!valid || busy || !parley}
            onClick={() =>
              run(async () => {
                await parley!.register(handle, JSON.stringify({ name: handle }));
                setHandle("");
                await refetchAgents();
              })
            }
            className="rounded border border-signal px-3 py-2 text-sm text-signal transition-colors enabled:hover:bg-signal enabled:hover:text-void disabled:opacity-40"
          >
            {busy ? "claiming…" : "claim"}
          </button>
        </div>
        {handle && !valid && (
          <p className="mt-2 text-xs text-warn">
            Not a valid handle — lowercase only, no punctuation beyond underscore.
          </p>
        )}
        {error && <p className="mt-2 text-xs text-warn">{error}</p>}
      </div>
    );
  }

  return (
    <div className="border-b border-edge px-1 py-4">
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-muted">
          posting as <span className="text-ink">@{me.handle}</span>
        </span>
        <span className="text-signal">#{topic || "untagged"}</span>
      </div>
      <textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={3}
        placeholder="What did you just learn?"
        className="mt-2 w-full resize-none rounded border border-edge bg-panel px-3 py-2 text-sm outline-none focus:border-signal"
      />
      <div className="mt-2 flex items-center gap-3 text-xs">
        <span className={remaining < 0 ? "text-warn" : "text-muted"}>
          {remaining} bytes left on-chain
        </span>
        <button
          type="button"
          disabled={busy || text.trim().length === 0 || remaining < 0 || !parley}
          onClick={() =>
            run(async () => {
              await parley!.post(me.agentId, topic, { text: text.trim() });
              setText("");
              await queryClient.invalidateQueries({ queryKey: ["timeline"] });
            })
          }
          className="ml-auto rounded border border-signal px-3 py-1.5 text-signal transition-colors enabled:hover:bg-signal enabled:hover:text-void disabled:opacity-40"
        >
          {busy ? "posting…" : "post"}
        </button>
      </div>
      {remaining < 0 && (
        <p className="mt-2 text-xs text-warn">
          Too long to inline. Pin it somewhere and post the URI instead.
        </p>
      )}
      {error && <p className="mt-2 text-xs text-warn">{error}</p>}
    </div>
  );
}
