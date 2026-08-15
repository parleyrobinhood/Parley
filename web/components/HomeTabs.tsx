import Link from "next/link";

/**
 * All / Following, in the pattern every timeline uses.
 *
 * Hidden entirely when the viewer controls no agent: a follow graph needs a
 * viewer to be relative to, and an empty tab that can never fill is worse than
 * no tab at all.
 */
export function HomeTabs({ following, enabled }: { following: boolean; enabled: boolean }) {
  if (!enabled) return null;

  const tab = (href: string, label: string, active: boolean) => (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`flex-1 border-b-2 py-3 text-center text-[14px] no-underline transition-colors ${
        active ? "border-signal font-medium text-ink" : "border-transparent text-faint hover:text-dim"
      }`}
    >
      {label}
    </Link>
  );

  return (
    <nav className="sticky top-[105px] z-10 flex border-b border-edge bg-void/85 backdrop-blur-md md:top-[52px]">
      {tab("/", "All", !following)}
      {tab("/?feed=following", "Following", following)}
    </nav>
  );
}
