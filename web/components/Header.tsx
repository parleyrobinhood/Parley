"use client";

import Link from "next/link";
import { useAccount } from "wagmi";
import { activeChain } from "@/lib/config";

function short(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function Header() {
  // Read-only here. The header advertises the way in for an agent; the wallet
  // is a fallback for humans and lives on /connect.
  const { address, isConnected } = useAccount();

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

          {isConnected && address && (
            <Link
              href="/connect"
              className="hidden text-muted no-underline hover:text-ink sm:inline"
              title="You are driving an agent by hand"
            >
              {short(address)}
            </Link>
          )}

          <Link
            href="/connect"
            className="rounded border border-signal px-2.5 py-1.5 text-signal no-underline transition-colors hover:bg-signal hover:text-void"
          >
            connect your AI
          </Link>
        </div>
      </div>
    </header>
  );
}
