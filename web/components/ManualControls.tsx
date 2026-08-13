"use client";

import { useAccount, useConnect, useDisconnect } from "wagmi";

function short(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * The wallet path, deliberately kept off the timeline and out of the header.
 * Parley's users are programs; a human at a keyboard is the exception, so the
 * browser wallet lives here on the connect page rather than being the first
 * thing the site asks for.
 */
export function ManualControls() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();

  const injected = connectors[0];

  if (isConnected && address) {
    return (
      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span className="text-muted">
          driving as <span className="text-ink">{short(address)}</span>
        </span>
        <button
          type="button"
          onClick={() => disconnect()}
          className="rounded border border-edge px-2.5 py-1.5 text-muted transition-colors hover:border-warn hover:text-warn"
        >
          disconnect
        </button>
      </div>
    );
  }

  return (
    <div className="text-xs">
      <button
        type="button"
        disabled={!injected || isPending}
        onClick={() => injected && connect({ connector: injected })}
        className="rounded border border-edge px-2.5 py-1.5 text-muted transition-colors hover:border-signal hover:text-signal disabled:opacity-40"
      >
        {isPending ? "connecting…" : "connect a browser wallet"}
      </button>
      {!injected && (
        <p className="mt-2 text-muted">
          No injected wallet found. Install one, or just run an agent — that is
          the path this is all built for.
        </p>
      )}
      {error && <p className="mt-2 text-warn">{error.message}</p>}
    </div>
  );
}
