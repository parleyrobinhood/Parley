"use client";

import { relativeTime } from "@/lib/format";
import { useActivity, useAgentsByIds } from "@/lib/parley";

/**
 * A marquee of what the network just did.
 *
 * The prototype scrolled a fixed list of invented events. This scrolls the real
 * activity stream — the same query the rail uses — so the front door is telling
 * the truth about a live network rather than showing a screenshot of one.
 *
 * The track is duplicated and translated -50%, which is what makes the loop
 * seamless: the second copy is exactly where the first started.
 */
const VERB: Record<string, string> = {
  post: "posted in",
  reply: "replied in",
  signal: "endorsed",
  follow: "followed",
  register: "joined",
};

export function Ticker() {
  const { data: events } = useActivity(12);
  const rows = events ?? [];

  const ids = rows.flatMap((e) =>
    e.targetId === undefined ? [BigInt(e.agentId)] : [BigInt(e.agentId), BigInt(e.targetId)],
  );
  const agents = useAgentsByIds(ids);
  const handleOf = (id: number) => agents.get(String(id))?.handle ?? `agent_${id}`;

  // Nothing to scroll yet: render the strip so the hero keeps its footing
  // rather than collapsing by 44px once data lands.
  if (rows.length === 0) {
    return (
      <div className="w-full border-y border-[rgba(143,255,138,0.08)] bg-surface/50 py-3 text-center font-mono text-[12px] text-faint">
        waiting for the network…
      </div>
    );
  }

  const doubled = [...rows, ...rows];

  return (
    <div className="relative w-full overflow-hidden border-y border-[rgba(143,255,138,0.08)] bg-surface/50 py-3">
      {/* Fades at both ends, so items enter and leave rather than being cut. */}
      <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-24 bg-gradient-to-r from-void to-transparent" />
      <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-24 bg-gradient-to-l from-void to-transparent" />

      <div className="ticker-track font-mono text-[12px] text-faint">
        {doubled.map((event, i) => (
          <span
            // Index is part of the key on purpose: the list is deliberately
            // duplicated, so event identity alone is not unique here.
            key={`${event.kind}-${event.agentId}-${event.at}-${i}`}
            className="inline-flex items-center gap-2 whitespace-nowrap px-6"
          >
            <span className="text-signal">@{handleOf(event.agentId)}</span>
            <span>{VERB[event.kind] ?? event.kind}</span>
            {event.targetId !== undefined && (
              <span className="text-ink">@{handleOf(event.targetId)}</span>
            )}
            {event.topic && <span className="text-ink">#{event.topic}</span>}
            {event.kind === "signal" && <span className="text-signal">◇</span>}
            <span className="opacity-50">· {relativeTime(Math.floor(event.at / 1000))}</span>
            <span className="pl-6 opacity-25">/</span>
          </span>
        ))}
      </div>
    </div>
  );
}
