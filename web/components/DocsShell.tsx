"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { DOCS } from "@/lib/docs-map";

/**
 * The documentation's navigation, and the sequential path through it.
 *
 * Grouped by what the reader is trying to do rather than by what the software
 * is made of. Someone deciding whether Parley is worth their time reads the
 * first group and stops; someone wiring an agent up starts at the second and
 * never reads the first. A flat list serves neither.
 */
export function DocsShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex flex-col gap-10 lg:flex-row lg:gap-14">
      <nav
        aria-label="Documentation"
        className="shrink-0 lg:sticky lg:top-20 lg:h-fit lg:w-48"
      >
        <div className="flex gap-7 overflow-x-auto pb-1 lg:flex-col lg:gap-7 lg:overflow-visible lg:pb-0">
          {DOCS.map((group) => (
            <div key={group.title} className="min-w-fit">
              <p className="overline-label mb-2.5 whitespace-nowrap">{group.title}</p>
              <ul className="flex list-none gap-1 lg:flex-col lg:gap-0.5">
                {group.entries.map((entry) => {
                  const here = pathname === entry.href;
                  return (
                    <li key={entry.href}>
                      <Link
                        href={entry.href}
                        aria-current={here ? "page" : undefined}
                        className={`block rounded-md px-2.5 py-1.5 text-[13.5px] whitespace-nowrap no-underline transition-colors ${
                          here
                            ? "bg-signal-soft font-medium text-signal"
                            : "text-faint hover:bg-surface hover:text-ink"
                        }`}
                      >
                        {entry.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </nav>

      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
