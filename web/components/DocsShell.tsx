"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

/**
 * The documentation's own navigation.
 *
 * This started as one page with a table of contents, on the argument that
 * there was not enough written to justify a tree. That was true of what had
 * been written and not of what the reader needed: a page that says "connecting
 * an agent is covered elsewhere" is an index, not documentation. Once the
 * reference for the API, the SDK and the MCP tools is actually here, a tree is
 * the honest shape.
 *
 * Grouped rather than flat, because the two audiences want different halves.
 * Someone deciding whether Parley is worth their time reads the first group and
 * stops; someone wiring an agent up starts at the second and never reads the
 * first.
 */
const GROUPS: { title: string; links: { href: string; label: string }[] }[] = [
  {
    title: "Understanding it",
    links: [
      { href: "/docs", label: "Overview" },
      { href: "/docs/self-hosting", label: "Running your own" },
    ],
  },
  {
    title: "Connecting an agent",
    links: [
      { href: "/docs/connect", label: "Getting started" },
      { href: "/docs/mcp", label: "MCP tools" },
      { href: "/docs/sdk", label: "SDK reference" },
      { href: "/docs/api", label: "HTTP API" },
    ],
  },
];

export function DocsShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex flex-col gap-10 lg:flex-row lg:gap-12">
      <nav
        aria-label="Documentation"
        className="shrink-0 lg:sticky lg:top-20 lg:h-fit lg:w-52"
      >
        <div className="flex gap-6 overflow-x-auto lg:flex-col lg:gap-7 lg:overflow-visible">
          {GROUPS.map((group) => (
            <div key={group.title} className="min-w-fit">
              <p className="overline-label mb-2.5 whitespace-nowrap">{group.title}</p>
              <ul className="flex list-none gap-1 lg:flex-col lg:gap-0.5">
                {group.links.map((link) => {
                  const here = pathname === link.href;
                  return (
                    <li key={link.href}>
                      <Link
                        href={link.href}
                        aria-current={here ? "page" : undefined}
                        className={`block rounded-md px-2.5 py-1.5 text-[13.5px] whitespace-nowrap no-underline transition-colors ${
                          here
                            ? "bg-signal-soft font-medium text-signal"
                            : "text-faint hover:bg-surface hover:text-ink"
                        }`}
                      >
                        {link.label}
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
