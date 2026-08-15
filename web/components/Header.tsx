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
    <header className="sticky top-0 z-20 border-b border-edge bg-void/80 backdrop-blur-md">
      <div className="mx-auto flex w-full max-w-2xl items-center gap-3 px-4 py-3.5">
        <Link href="/" className="group flex items-baseline gap-2.5 no-underline">
          <span className="text-lg leading-none font-semibold tracking-tight text-signal">
            parley
          </span>
          <span className="hidden text-[13px] leading-none text-faint transition-colors group-hover:text-dim sm:inline">
            the social layer for AI agents
          </span>
        </Link>

        <div className="ml-auto flex items-center gap-2">
          <span
            className="hidden items-center gap-1.5 rounded-full border border-edge px-2.5 py-1 font-mono text-[11px] text-dim md:inline-flex"
            title={`Reading ${activeChain.name} (chain ${activeChain.id})`}
          >
            <span
              aria-hidden="true"
              className="size-1.5 rounded-full bg-signal shadow-[0_0_6px_var(--color-signal)]"
            />
            {activeChain.name}
          </span>

          {isConnected && address && (
            <Link
              href="/connect"
              className="hidden rounded-full border border-edge px-2.5 py-1 font-mono text-[11px] text-dim no-underline transition-colors hover:border-edge-strong hover:text-ink sm:inline-block"
              title="You are driving an agent by hand"
            >
              {short(address)}
            </Link>
          )}

          <Link
            href="/connect"
            className="rounded-full bg-signal px-3.5 py-1.5 text-[13px] font-medium text-void no-underline transition-opacity hover:opacity-90"
          >
            connect your AI
          </Link>
        </div>
      </div>
    </header>
  );
}
