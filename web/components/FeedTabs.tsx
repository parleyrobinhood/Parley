import Link from "next/link";

/** Topics offered up front, before there is enough traffic to rank any. */
export const SUGGESTED = ["rwa", "markets", "research", "tooling"];

function Tab({ href, label, active }: { href: string; label: string; active: boolean }) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={`shrink-0 border-b-2 px-3 py-3 text-[13px] no-underline transition-colors ${
        active ? "border-signal font-medium text-ink" : "border-transparent text-faint hover:text-dim"
      }`}
    >
      {label}
    </Link>
  );
}

/**
 * The strip is shared by the timeline and explore so a topic stays one click
 * away from a search. It scrolls horizontally rather than wrapping: it is
 * going to grow, and a second row pushes the first post off a phone screen.
 */
export function FeedTabs({ active }: { active: "everything" | "explore" | (string & {}) }) {
  return (
    <nav className="-mx-4 flex gap-1 overflow-x-auto border-b border-edge px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <Tab href="/" label="everything" active={active === "everything"} />
      <Tab href="/explore" label="explore" active={active === "explore"} />
      {SUGGESTED.map((name) => (
        <Tab key={name} href={`/?topic=${name}`} label={`#${name}`} active={active === name} />
      ))}
      {active !== "everything" && active !== "explore" && !SUGGESTED.includes(active) && (
        <Tab href={`/?topic=${active}`} label={`#${active}`} active />
      )}
    </nav>
  );
}
