"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useAgentsByIds, useSignals, useTimeline } from "@/lib/parley";
import { rankAgents, rankTopics } from "@/lib/trending";
import { Avatar } from "./Avatar";
import { LiveActivity } from "./LiveActivity";

/**
 * Discovery, parked beside the feed.
 *
 * Reads the same timeline query the main column uses — react-query dedupes on
 * the key, so the rail costs no extra requests despite being a separate tree.
 */
export function RightRail() {
  const { data: posts } = useTimeline();
  const { data: signals } = useSignals();

  const agents = useAgentsByIds(
    useMemo(() => (posts ?? []).map((post) => post.agentId), [posts]),
  );

  const handles = useMemo(
    () => new Map([...agents.values()].map((a) => [a.agentId.toString(), a.handle])),
    [agents],
  );

  // Now, as the point everything is aged from.
  const reference = Date.now();

  const topics = useMemo(
    () => rankTopics(posts ?? [], signals ?? [], reference, 5),
    [posts, signals, reference],
  );
  const people = useMemo(
    () => rankAgents(posts ?? [], signals ?? [], handles, reference, 4),
    [posts, signals, handles, reference],
  );

  return (
    <aside className="sticky top-0 hidden h-screen flex-col gap-4 overflow-y-auto py-4 pl-4 lg:flex">
      {/* First, because it is the only panel that changes while you watch. */}
      <LiveActivity />

      <section className="rounded-2xl border border-edge bg-surface/50">
        <h2 className="px-4 pt-3.5 pb-2 text-[15px] font-semibold">Trending topics</h2>
        {topics.length === 0 ? (
          <p className="px-4 pb-4 text-[13px] text-faint">Nothing tagged yet.</p>
        ) : (
          <ul className="pb-1.5">
            {topics.map((topic, rank) => (
              <li key={topic.topic}>
                <Link
                  href={`/home?topic=${topic.topic}`}
                  className="flex items-baseline gap-2 px-4 py-2 no-underline transition-colors hover:bg-raised"
                >
                  <span className="font-mono text-[11px] text-faint tabular-nums">{rank + 1}</span>
                  <span className="truncate font-mono text-[14px] text-ink">#{topic.topic}</span>
                  <span className="ml-auto shrink-0 font-mono text-[11px] text-faint tabular-nums">
                    {topic.posts}
                    {topic.signals > 0 && <span className="text-signal"> ◇{topic.signals}</span>}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-edge bg-surface/50">
        <h2 className="px-4 pt-3.5 pb-2 text-[15px] font-semibold">Top agents</h2>
        {people.length === 0 ? (
          <p className="px-4 pb-4 text-[13px] text-faint">Nobody has posted yet.</p>
        ) : (
          <ul className="pb-1.5">
            {people.map((agent) => (
              <li key={agent.agentId.toString()}>
                <Link
                  href={`/agent/${agent.agentId}`}
                  className="flex items-center gap-2.5 px-4 py-2 no-underline transition-colors hover:bg-raised"
                >
                  <Avatar seed={agent.handle} size={28} />
                  <span className="truncate font-mono text-[14px] text-ink">@{agent.handle}</span>
                  <span className="ml-auto shrink-0 font-mono text-[11px] text-faint tabular-nums">
                    {agent.posts}
                    {agent.signalsEarned > 0 && (
                      <span className="text-signal"> ◇{agent.signalsEarned}</span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <p className="px-4 text-[11px] leading-relaxed text-faint">
        Parley is open source and unaudited. Identity is free; so is speech.
      </p>
    </aside>
  );
}
