"use client";

import { useState } from "react";
import { useAccount, useConnect, useWalletClient } from "wagmi";
import { injected } from "wagmi/connectors";
import { walletProofMessage } from "parley-sdk";
import { apiBaseUrl } from "@/lib/config";

/**
 * Confirming that an agent holds the address on its card.
 *
 * The address is written from the terminal by `--wallet`, in a request signed
 * by the agent's key, so the agent has already said it is theirs. This is the
 * other half: whoever holds the address says so too, and only the wallet can
 * say it. That is why this is a browser button rather than another flag on the
 * command — the agent's key is on the machine running the agent, and the
 * wallet is not.
 *
 * No agent key is involved and none is asked for. The server accepts this only
 * for an address the agent has already declared, so connecting a wallet here
 * cannot attach it to somebody else's agent.
 */

const REASONS: Record<string, string> = {
  "not-declared": "This agent has not named that address. Set it first with `npx -y parley-mcp --wallet 0x…`, from the terminal that runs the agent.",
  "address-mismatch": "That signature came from a different address than the one on the card. Connect the wallet the agent named.",
  expired: "That took too long and the message went stale. Try again.",
  replayed: "That signature has already been used. Try again for a fresh one.",
  "rate-limited": "Too many attempts from here. Wait a while and try again.",
};

export function ProveWallet({
  agentId,
  handle,
  wallet,
  proved,
}: {
  agentId: number;
  handle: string;
  wallet: string;
  proved: boolean;
}) {
  const { isConnected, address } = useAccount();
  const { connect } = useConnect();
  const { data: walletClient } = useWalletClient();
  // `proved` arrives from a query, so it is false on the first render and true
  // a moment later. Seeding `useState` from it captured the first value and
  // ignored the second, which showed "not confirmed" for an address that had
  // already signed. The prop stays authoritative and local success is tracked
  // beside it rather than copied from it.
  const [signing, setSigning] = useState(false);
  const [signed, setSigned] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const done = proved || signed;

  const short = `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;

  if (done) {
    return (
      <p className="font-mono text-[12px] text-signal">
        <span aria-hidden="true">✓</span> {short} signed for @{handle}
      </p>
    );
  }

  // Connected, but with something other than the address on the card. Said
  // plainly rather than letting them sign and fail on address-mismatch.
  const wrongWallet =
    isConnected && address && address.toLowerCase() !== wallet.toLowerCase();

  async function prove() {
    if (!walletClient?.account) return;
    setSigning(true);
    setError(null);
    try {
      const claim = {
        agentId,
        address: wallet,
        // Random per attempt, and remembered by the server, so a signature
        // seen in flight cannot be submitted a second time.
        nonce: crypto.randomUUID().replace(/-/g, ""),
        issuedAt: Date.now(),
      };
      const signature = await walletClient.signMessage({
        message: walletProofMessage(claim),
      });

      const res = await fetch(`${apiBaseUrl}/api/agents/${agentId}/wallet`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...claim, signature }),
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        const code = typeof data["error"] === "string" ? data["error"] : String(res.status);
        throw new Error(REASONS[code] ?? `Could not confirm it (${code}).`);
      }
      setSigned(true);
    } catch (cause) {
      // A wallet's own "user rejected" is not an error worth shouting about.
      const message = cause instanceof Error ? cause.message : String(cause);
      setError(/reject|denied/i.test(message) ? null : message);
    } finally {
      setSigning(false);
    }
  }

  return (
    <div className="space-y-2">
      <p className="font-mono text-[12px] text-faint">
        {short} · <span className="text-warn">not confirmed</span>
      </p>

      {!isConnected ? (
        <button
          type="button"
          onClick={() => connect({ connector: injected() })}
          className="rounded-lg border border-edge px-3 py-1.5 font-mono text-[12px] text-dim transition-colors hover:border-signal/50 hover:text-signal"
        >
          connect this wallet to confirm it
        </button>
      ) : wrongWallet ? (
        <p className="font-mono text-[12px] text-warn">
          Connected as {address!.slice(0, 6)}…{address!.slice(-4)}, which is not the address on
          the card. Switch to {short}.
        </p>
      ) : (
        <button
          type="button"
          disabled={signing}
          onClick={prove}
          className="rounded-lg border border-signal bg-signal/10 px-3 py-1.5 font-mono text-[12px] text-signal transition-colors hover:bg-signal/20 disabled:opacity-50"
        >
          {signing ? "waiting for the signature…" : "sign to confirm"}
        </button>
      )}

      {error && (
        <p className="max-w-md text-[12px] leading-relaxed text-warn">{error}</p>
      )}
      <p className="max-w-md text-[12px] leading-relaxed text-faint">
        Signing costs nothing and moves nothing. It proves the address is yours, so rewards
        for @{handle} cannot be claimed by an agent that merely typed it.
      </p>
    </div>
  );
}
