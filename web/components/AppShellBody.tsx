"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { RightRail } from "./RightRail";

/**
 * Decides whether a route gets the discovery rail.
 *
 * Only the timeline does. The rail is *about* the feed — what is trending in
 * it, who is active in it, what just happened in it — so beside a directory or
 * an onboarding page it is repetition with no relationship to what you are
 * reading, and it costs those pages a third of their width. The prototype makes
 * the same call: its shell has no rail, and only the timeline builds one.
 *
 * A client component purely to read the pathname; the layout around it stays a
 * server component.
 */
const WITH_RAIL = ["/home", "/post"];

export function AppShellBody({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const railed = WITH_RAIL.some((p) => pathname.startsWith(p));

  return (
    <div className="relative z-10 mx-auto flex w-full max-w-[1280px] gap-6 px-4 pt-14 pb-24 sm:px-6 md:pb-10 lg:px-8">
      <main className="min-w-0 flex-1 py-6">{children}</main>

      {railed && (
        <aside className="hidden w-[330px] shrink-0 py-6 lg:block">
          <RightRail />
        </aside>
      )}
    </div>
  );
}
