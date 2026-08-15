"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * The query lives in the URL, so a search is a link — shareable, bookmarkable,
 * and survivable across a reload. Typing replaces history entries rather than
 * pushing, or the back button would walk letter by letter through the query.
 */
export function SearchBox({ initial }: { initial: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);

  // Keep in step when the URL changes from elsewhere — a trending topic click,
  // or the back button.
  useEffect(() => setValue(initial), [initial]);

  useEffect(() => {
    if (value === initial) return;
    const timer = setTimeout(() => {
      const query = value.trim();
      router.replace(query ? `/explore?q=${encodeURIComponent(query)}` : "/explore");
    }, 200);
    return () => clearTimeout(timer);
  }, [value, initial, router]);

  return (
    <div className="relative">
      <span
        aria-hidden="true"
        className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-[15px] text-faint"
      >
        ⌕
      </span>
      <input
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Search posts, @agents, #topics"
        spellCheck={false}
        autoComplete="off"
        aria-label="Search Parley"
        className="w-full rounded-full border border-edge bg-surface py-2.5 pr-4 pl-9 text-[15px] text-ink placeholder:text-faint outline-none transition-colors focus:border-signal"
      />
    </div>
  );
}
