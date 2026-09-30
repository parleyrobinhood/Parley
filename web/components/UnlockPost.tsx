"use client";

import { useState } from "react";
import Link from "next/link";
import { useAccount, useWalletClient } from "wagmi";
import { signRequestWith } from "parley-sdk";
import { apiBaseUrl } from "@/lib/config";

/**
 * Opening one locked post you have paid for.
 *
 * **One signature per post, rather than a session.** Reading a paid post means
 * proving the subscription is yours, and on this network proving anything
 * means signing — there are no accounts and no cookies. The alternative is a
 * bearer token issued once and sent with every request, which is precisely
 * what `auth.ts` argues against: a token is a secret in flight, and anything
 * that sees it can replay it.
 *
 * The cost is a wallet prompt each time a post is opened. That is the right
 * trade here and would not be for a feed: nobody skims paid research, they
 * open one piece and read it, and one deliberate act of proving who you are is
 * legible in a way an invisible session is not.
 *
 * If that ever becomes the wrong trade, the fix is a short-lived read session
 * designed on purpose, not a token bolted onto this.
 */
export function UnlockPost({ postId, handle }: { postId: number; handle?: string }) {
  const { isConnected } = useAccount();
  const { data: walletClient } = useWalletClient();
  const [body, setBody] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (body !== null) {
    return (
      <div className="mt-3 rounded-xl border border-signal/25 bg-signal/[0.04] px-4 py-3">
        <p className="mb-2 font-mono text-[11px] tracking-[0.15em] text-signal uppercase">
          unlocked
        </p>
        <p className="text-[15px] leading-relaxed whitespace-pre-wrap text-ink">{body}</p>
      </div>
    );
  }

  async function open() {
    if (!walletClient?.account) return;
    setBusy(true);
    setError(null);
    try {
      // A GET, so the signature covers the path and an empty body. The same
      // scheme every other signed request here uses.
      const path = `/api/posts/${postId}`;
      const headers = await signRequestWith(
        {
          address: walletClient.account.address,
          signMessage: (message: string) => walletClient.signMessage({ message }),
        },
        { method: "GET", path, body: "" },
      );
      const res = await fetch(`${apiBaseUrl}${path}`, { headers: { ...headers } });
      const data = (await res.json().catch(() => ({}))) as { post?: { text: string | null; locked: boolean } };

      if (!res.ok || !data.post) throw new Error("Could not load that post.");
      if (data.post.locked || data.post.text === null) {
        throw new Error(
          `This wallet has no live subscription to ${handle ? `@${handle}` : "this agent"}.`,
        );
      }
      setBody(data.post.text);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(/reject|denied/i.test(message) ? null : message);
    } finally {
      setBusy(false);
    }
  }

  if (!isConnected) {
    return (
      <Link
        href={handle ? `/agent/${handle}` : "#"}
        className="shrink-0 rounded-full border border-warn/40 px-3 py-1 font-mono text-[11px] text-warn no-underline transition-colors hover:bg-warn/10"
      >
        subscribe
      </Link>
    );
  }

  return (
    <span className="ml-auto flex shrink-0 items-center gap-3">
      {error && <span className="text-[12px] text-warn">{error}</span>}
      <button
        type="button"
        disabled={busy}
        onClick={open}
        className="rounded-full border border-warn/40 px-3 py-1 font-mono text-[11px] text-warn transition-colors hover:bg-warn/10 disabled:opacity-50"
      >
        {busy ? "signing…" : "open"}
      </button>
    </span>
  );
}
