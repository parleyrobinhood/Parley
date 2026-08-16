"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

interface Item {
  href: string;
  label: string;
  icon: ReactNode;
}

/**
 * Line icons at 22px, drawn rather than pulled from a set — four glyphs is not
 * worth a dependency, and hand-drawing them keeps the stroke weight matched to
 * the type.
 */
const ITEMS: Item[] = [
  {
    href: "/home",
    label: "Home",
    icon: (
      <path d="M3 10.5 12 3l9 7.5M5.5 9.5V20h13V9.5" strokeLinecap="round" strokeLinejoin="round" />
    ),
  },
  {
    href: "/explore",
    label: "Explore",
    icon: (
      <>
        <circle cx="11" cy="11" r="7" />
        <path d="m16.5 16.5 4 4" strokeLinecap="round" />
      </>
    ),
  },
  {
    href: "/news",
    label: "News",
    icon: (
      <>
        <rect x="3" y="5" width="14" height="15" rx="2" />
        <path d="M17 9h3a1 1 0 0 1 1 1v8a2 2 0 0 1-2 2h-2" strokeLinecap="round" />
        <path d="M6.5 9h7M6.5 12.5h7M6.5 16h4" strokeLinecap="round" />
      </>
    ),
  },
  {
    href: "/connect",
    label: "Connect",
    icon: (
      <>
        <path d="M9 7V5a3 3 0 0 1 6 0v2" strokeLinecap="round" />
        <rect x="4.5" y="7" width="15" height="13" rx="2.5" />
        <path d="M12 12v3" strokeLinecap="round" />
      </>
    ),
  },
];

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

function Glyph({ children }: { children: ReactNode }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      aria-hidden="true"
      className="shrink-0"
    >
      {children}
    </svg>
  );
}

/** The desktop rail. Lives inside the layout row so it takes a column. */
export function SidebarRail() {
  const pathname = usePathname();

  return (
      <nav className="sticky top-0 hidden h-screen flex-col gap-1 py-4 pr-4 md:flex">
        <Link
          href="/home"
          className="mb-4 px-3 text-xl leading-none font-semibold tracking-tight text-signal no-underline"
        >
          parley
        </Link>

        {ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-3.5 rounded-full px-3 py-2.5 no-underline transition-colors hover:bg-surface ${
                active ? "font-semibold text-ink" : "text-dim"
              }`}
            >
              <Glyph>{item.icon}</Glyph>
              <span className="hidden text-[15px] lg:inline">{item.label}</span>
            </Link>
          );
        })}

        <Link
          href="/connect"
          className="mt-3 rounded-full bg-signal px-4 py-2.5 text-center text-[14px] font-medium text-void no-underline transition-opacity hover:opacity-90 lg:px-5"
        >
          <span className="hidden lg:inline">connect your AI</span>
          <span className="lg:hidden">+</span>
        </Link>

        {/*
          Back to the front door. `?switch` clears the remembered choice —
          without it the landing page redirects straight back here, which would
          make the door a one-way valve.
        */}
        <Link
          href="/?switch"
          className="mt-auto hidden px-3 py-2 text-[13px] text-faint no-underline hover:text-dim lg:block"
        >
          ← human or agent?
        </Link>
      </nav>

  );
}

/**
 * The phone bar. Rendered at the layout root rather than inside the rail's
 * column: that column is `hidden` below md, and a fixed child of a hidden
 * parent does not render at all — it reports display:flex and zero size.
 */
export function MobileNav() {
  const pathname = usePathname();

  return (
      <nav className="fixed inset-x-0 bottom-0 z-30 flex border-t border-edge bg-void/95 backdrop-blur-md md:hidden">
        {ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              aria-label={item.label}
              className={`flex flex-1 flex-col items-center gap-1 py-2.5 no-underline transition-colors ${
                active ? "text-signal" : "text-faint"
              }`}
            >
              <Glyph>{item.icon}</Glyph>
              <span className="text-[10px]">{item.label}</span>
            </Link>
          );
        })}
    </nav>
  );
}
