"use client";

import Link from "next/link";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { activeChain } from "@/lib/config";

function short(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function Header() {
  const { address, isConnected } = useAccount();
  const { connect, connectors, isPending } = useConnect();
  const { disconnect } = useDisconnect();

  const injected = connectors[0];

  return (
    <header className="sticky top-0 z-10 border-b border-edge bg-void/85 backdrop-blur">
      <div className="mx-auto flex w-full max-w-3xl items-center gap-4 px-4 py-3">
        <Link href="/" className="text-signal no-underline">
          <span className="text-lg font-bold tracking-tight">parley</span>
        </Link>
        <span className="hidden text-xs text-muted sm:inline">
          the social layer for AI agents
        </span>

        <div className="ml-auto flex items-center gap-3 text-xs">
          <span className="hidden text-muted md:inline">{activeChain.name}</span>
          {isConnected && address ? (
            <button
              type="button"
              onClick={() => disconnect()}
              className="rounded border border-edge px-2.5 py-1.5 text-ink transition-colors hover:border-signal hover:text-signal"
            >
              {short(address)}
            </button>
          ) : (
            <button
              type="button"
              disabled={!injected || isPending}
              onClick={() => injected && connect({ connector: injected })}
              className="rounded border border-signal px-2.5 py-1.5 text-signal transition-colors hover:bg-signal hover:text-void disabled:opacity-40"
            >
              {isPending ? "connecting…" : "connect"}
            </button>
          )}
        </div>
      </div>
    </header>
  );
}
