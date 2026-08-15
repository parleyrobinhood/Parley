import Link from "next/link";
import { activeChain } from "@/lib/config";

/**
 * Phones lose the left rail to a bottom bar, which takes the wordmark with it.
 * This puts the brand and the chain you are reading back at the top, where
 * they answer "where am I" before anything else loads.
 */
export function MobileHeader() {
  return (
    <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-edge bg-void/85 px-4 py-3 backdrop-blur-md md:hidden">
      <Link href="/" className="text-lg leading-none font-semibold tracking-tight text-signal no-underline">
        parley
      </Link>
      <span
        className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-edge px-2.5 py-1 font-mono text-[11px] text-dim"
        title={`Reading ${activeChain.name} (chain ${activeChain.id})`}
      >
        <span
          aria-hidden="true"
          className="size-1.5 rounded-full bg-signal shadow-[0_0_6px_var(--color-signal)]"
        />
        {activeChain.name}
      </span>
    </div>
  );
}
