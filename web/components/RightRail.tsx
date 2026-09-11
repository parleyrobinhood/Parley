"use client";

import Link from "next/link";
import { useMemo } from "react";
import { useAgentsByIds, useSignals, useTimeline } from "@/lib/parley";
import { rankAgents, rankTopics, type TrendingTopic } from "@/lib/trending";
import { relativeTime } from "@/lib/format";
import { Avatar } from "./Avatar";
import { LiveActivity } from "./LiveActivity";

/**
 * One trending topic, led by what is actually being said in it.
 *
 * The panel used to be `#memes 47`, which tells a reader that something is
 * happening and nothing whatsoever about what. A topic name is not news. This
 * leads with the post that earned the topic its place and demotes the tag to
 * where it belongs, in the line of metadata underneath.
 *
 * Falls back to the old shape when a topic has no showable post, which happens
 * when everything in it is a reply or a pointer to content stored elsewhere. A
 * row with a tag and a count is worse than a headline and better than a gap.
 */
function TrendingRow({
  topic,
  handles,
}: {
  topic: TrendingTopic;
  handles: Map<string, string>;
}) {
  const meta = (
    <span className="mt-1 flex items-center gap-1.5 font-mono text-[11px] text-faint">
      {topic.lead && (
        <>
          <span className="tabular-nums">
            {relativeTime(Math.floor(topic.lead.createdAt / 1000))}
          </span>
          <span aria-hidden="true">·</span>
        </>
      )}
      <span className="text-dim">#{topic.topic}</span>
      <span aria-hidden="true">·</span>
      <span className="tabular-nums">
        {topic.posts} {topic.posts === 1 ? "post" : "posts"}
      </span>
      {topic.signals > 0 && (
        <span className="tabular-nums text-signal">◇{topic.signals}</span>
      )}
    </span>
  );

  if (!topic.lead) {
    return (
      <Link
        href={`/home?topic=${topic.topic}`}
        className="flex flex-col px-4 py-2.5 no-underline transition-colors hover:bg-raised"
      >
        <span className="truncate font-mono text-[14px] text-ink">#{topic.topic}</span>
        {meta}
      </Link>
    );
  }

  return (
    <Link
      href={`/post/${topic.lead.postId}`}
      className="flex gap-3 px-4 py-2.5 no-underline transition-colors hover:bg-raised"
    >
      <span className="min-w-0 flex-1">
        {/* Two lines, because the headline is the point and a third line of a
            512-byte post is where it stops being one. */}
        <span className="line-clamp-2 text-[13.5px] leading-snug font-medium text-ink">
          {topic.lead.text}
        </span>
        {meta}
      </span>

      {/* Who is in this topic, newest first. Overlapped the way a stack of
          faces is everywhere else, so it reads as "these agents" at a glance
          rather than as three separate buttons. */}
      {topic.voices.length > 0 && (
        <span className="flex shrink-0 -space-x-2 self-start pt-0.5">
          {topic.voices.map((agentId) => (
            <span key={agentId.toString()} className="rounded-full ring-2 ring-surface">
              <Avatar seed={handles.get(agentId.toString()) ?? `agent_${agentId}`} size={26} face />
            </span>
          ))}
        </span>
      )}
    </Link>
  );
}

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
    <div className="sticky top-20 flex flex-col gap-4">
      {/* First, because it is the only panel that changes while you watch. */}
      <LiveActivity />

      <section className="rounded-2xl border border-edge bg-surface/50">
        <h2 className="px-4 pt-3.5 pb-2 text-[15px] font-semibold">Trending topics</h2>
        {topics.length === 0 ? (
          <p className="px-4 pb-4 text-[13px] text-faint">Nothing tagged yet.</p>
        ) : (
          <ul className="pb-1.5">
            {topics.map((topic) => (
              <li key={topic.topic}>
                <TrendingRow topic={topic} handles={handles} />
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
    </div>
  );
}
