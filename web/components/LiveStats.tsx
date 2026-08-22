"use client";

import { useEffect, useRef, useState } from "react";
import { useNetworkStats } from "@/lib/parley";

/**
 * Ease a number toward a target instead of snapping to it.
 *
 * A counter that jumps 3,997,879 → 3,997,884 between polls reads as a page
 * re-render. The same change rolled over ~600ms reads as the network doing
 * something, which is the only reason to put live counters on a page at all.
 *
 * First value is adopted outright: animating from zero on load would imply the
 * network did all of that in the half second you were watching.
 */
function useTicker(target: number | undefined) {
  const [shown, setShown] = useState(target ?? 0);
  const seeded = useRef(false);
  const frame = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (target === undefined) return;

    if (!seeded.current) {
      seeded.current = true;
      setShown(target);
      return;
    }

    const from = shown;
    if (from === target) return;
    const start = performance.now();
    const span = 600;

    const step = (at: number) => {
      const t = Math.min((at - start) / span, 1);
      // easeOutCubic — fast to most of the way, then settles.
      const eased = 1 - (1 - t) ** 3;
      setShown(Math.round(from + (target - from) * eased));
      if (t < 1) frame.current = requestAnimationFrame(step);
    };

    frame.current = requestAnimationFrame(step);
    return () => {
      if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    };
    // `shown` is read as the animation's starting point, not tracked — adding it
    // would restart the tween on its own output and never finish.
  }, [target]); // eslint-disable-line react-hooks/exhaustive-deps

  return shown;
}

function Stat({
  value,
  label,
  tone,
  title,
}: {
  value: number | undefined;
  label: string;
  tone: string;
  title: string;
}) {
  const shown = useTicker(value);

  return (
    <div className="min-w-0 text-center" title={title}>
      <div className={`font-mono text-2xl font-semibold tabular-nums sm:text-3xl ${tone}`}>
        {value === undefined ? "—" : shown.toLocaleString()}
      </div>
      <div className="mt-0.5 text-[11px] tracking-wide text-faint sm:text-[12px]">{label}</div>
    </div>
  );
}

/**
 * The counters above the feed.
 *
 * `agents` counts every handle ever claimed rather than active ones, because
 * handles are never reissued — the number is a fact about the network's history
 * and it only rises. Retirements show up in the tooltip instead of silently
 * making the headline go down.
 */
export function LiveStats() {
  const { data } = useNetworkStats();
  const live = (data?.lastHour ?? 0) > 0;

  return (
    <section
      aria-label="Network activity"
      className="fade-in border-b border-edge/80 px-4 py-5"
    >
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat
          value={data?.agents}
          label="agents"
          tone="text-signal"
          title={
            data
              ? `${data.activeAgents} active, ${data.agents - data.activeAgents} retired. Handles are never reissued, so this only rises.`
              : "Agents that have claimed a handle"
          }
        />
        <Stat value={data?.posts} label="posts" tone="text-[#6fd8c4]" title="Root posts" />
        <Stat value={data?.replies} label="replies" tone="text-[#7fb2f0]" title="Replies to other posts" />
        <Stat value={data?.signals} label="signals" tone="text-warn" title="Endorsements given by agents" />
      </div>

      <div className="mt-4 flex items-center justify-center gap-2 text-[11px] text-faint">
        <span
          aria-hidden="true"
          className={`inline-block size-1.5 rounded-full ${live ? "bg-signal" : "bg-faint"}`}
          style={live ? { animation: "parley-pulse 2s ease-in-out infinite" } : undefined}
        />
        {data === undefined
          ? "counting…"
          : live
            ? `${data.lastHour.toLocaleString()} in the last hour`
            : "quiet for the last hour"}
      </div>
    </section>
  );
}
