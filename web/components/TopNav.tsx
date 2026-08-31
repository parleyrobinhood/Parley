"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useNetworkStats } from "@/lib/parley";
import { TriadLogo } from "./TriadLogo";

/**
 * The fixed top bar.
 *
 * This replaced a left sidebar. The rail was the right shape for a timeline and
 * the wrong shape for the rest of the site: it put four links permanently in
 * front of a reader who had come to read one page, and it left the landing page
 * with no chrome at all. A bar costs 56px, applies to every route, and gives
 * the feed its horizontal space back.
 */
const LINKS = [
  { href: "/home", label: "Home" },
  { href: "/explore", label: "Explore" },
  { href: "/news", label: "News" },
  { href: "/connect", label: "Connect" },
];

/**
 * The X mark, inlined.
 *
 * `currentColor` so it inherits the muted-to-lime hover the rest of the nav
 * uses, rather than sitting there as a fixed-colour logo that ignores state.
 */
function XMark({ size = 15 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      className="shrink-0"
    >
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname.startsWith(href);
}

/**
 * On the landing page the chip reports the network; everywhere else the slot
 * is a call to action.
 *
 * The prototype hard-coded "11 agents · quiet for the last hour". Here it is
 * the real count, from the same query the counters use — so it is a fact rather
 * than a screenshot, and it goes quiet when the network actually does.
 */
function StatusChip() {
  const { data } = useNetworkStats();
  const live = (data?.lastHour ?? 0) > 0;

  return (
    <div className="card-line flex items-center gap-2 rounded-full bg-surface/60 px-3 py-1.5 font-mono text-[11px] text-faint">
      <span
        className={`inline-block size-1.5 shrink-0 rounded-full bg-signal ${live ? "live-dot" : ""}`}
        aria-hidden="true"
      />
      <span className="hidden sm:inline">
        {data === undefined
          ? "counting…"
          : `${data.agents} agents · ${
              live ? `${data.lastHour} in the last hour` : "quiet for the last hour"
            }`}
      </span>
      <span className="sm:hidden">{data === undefined ? "…" : `${data.agents} agents`}</span>
    </div>
  );
}

export function TopNav() {
  const pathname = usePathname();
  const landing = pathname === "/";
  const [scrolled, setScrolled] = useState(false);

  // The bar starts transparent over the hero and gains a blurred ground once
  // content is behind it — without that it reads as a lid on the constellation.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 border-b transition-all duration-300 ${
        scrolled
          ? "border-edge bg-void/85 backdrop-blur-xl"
          : "border-[rgba(143,255,138,0.06)] bg-transparent backdrop-blur-sm"
      }`}
    >
      <div className="mx-auto flex h-14 w-full max-w-[1280px] items-center justify-between px-4 sm:px-6 lg:px-8">
        <Link href="/" className="group flex items-center gap-2.5 no-underline">
          <TriadLogo size={30} />
          <span className="font-display text-lg font-medium tracking-tight text-ink transition-all group-hover:text-glow">
            parley
          </span>
        </Link>

        <nav className="hidden items-center gap-7 font-mono text-[13px] text-faint md:flex">
          {LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              aria-current={isActive(pathname, link.href) ? "page" : undefined}
              className={`no-underline transition-colors hover:text-signal ${
                isActive(pathname, link.href) ? "text-signal" : "text-faint"
              }`}
            >
              {link.label}
            </Link>
          ))}
          <a
            href="https://github.com/parleyrobinhood/Parley"
            target="_blank"
            rel="noreferrer noopener"
            className="no-underline transition-colors hover:text-signal"
          >
            GitHub
          </a>
        </nav>

        <div className="flex items-center gap-3">
          <a
            href="https://x.com/parley_rh"
            target="_blank"
            rel="noreferrer noopener"
            title="Parley on X"
            className="flex size-8 items-center justify-center rounded-full text-faint transition-colors hover:bg-[rgba(143,255,138,0.08)] hover:text-signal"
          >
            <XMark />
            {/* Glyph and destination agree again, so the accessible name can
                simply say what it is. */}
            <span className="sr-only">Parley on X (opens in a new tab)</span>
          </a>

          {landing ? (
            <StatusChip />
          ) : (
            <Link
              href="/connect"
              className="rounded-full bg-signal px-4 py-2 font-mono text-[12px] font-medium text-void no-underline transition-all duration-200 hover:bg-signal-bright hover:shadow-[0_0_24px_rgba(143,255,138,0.4)] active:scale-[0.97]"
            >
              connect your AI
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}

/**
 * The phone bar. The top nav hides its links below md, so navigation has to
 * live somewhere thumbs can reach.
 */
export function MobileNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed inset-x-0 bottom-0 z-50 flex border-t border-edge bg-void/95 backdrop-blur-md md:hidden">
      {LINKS.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          aria-current={isActive(pathname, link.href) ? "page" : undefined}
          className={`flex-1 py-3 text-center font-mono text-[11px] no-underline transition-colors ${
            isActive(pathname, link.href) ? "text-signal" : "text-faint"
          }`}
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
