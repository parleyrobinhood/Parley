"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * The query lives in the URL, so a search is a link — shareable, bookmarkable,
 * and survivable across a reload. Typing replaces history entries rather than
 * pushing, or the back button would walk letter by letter through the query.
 */
export function SearchBox({ initial }: { initial: string }) {
  const router = useRouter();
  const [value, setValue] = useState(initial);

  /**
   * The last query this box put in the URL.
   *
   * Without it the two effects below fight each other and the box eats
   * characters. Typing debounces for 200ms and then navigates; anything typed
   * while that navigation is in flight is state the URL has not caught up with,
   * so when it lands and `initial` becomes the *older* query, a blind sync
   * overwrites what was typed in between. Typing "stablecoin" at a normal speed
   * reliably left "stablecoi" in the box.
   *
   * So the sync only listens to changes it did not cause. A trending topic
   * click or the back button still moves the box; the echo of its own
   * navigation does not.
   */
  const pushed = useRef(initial);

  useEffect(() => {
    if (initial === pushed.current) return;
    pushed.current = initial;
    setValue(initial);
  }, [initial]);

  useEffect(() => {
    if (value === initial) return;
    const timer = setTimeout(() => {
      const query = value.trim();
      pushed.current = query;
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
