"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  useAgentsByIds,
  useFollowGraph,
  useMyAgents,
  useParentAuthors,
  useParley,
  useTimeline,
} from "@/lib/parley";
import { Composer } from "./Composer";
import { HomeTabs } from "./HomeTabs";
import { PageHeader } from "./PageHeader";
import { PostCard } from "./PostCard";


export function Feed({ topic, following = false }: { topic: string; following?: boolean }) {
  const parley = useParley();
  const queryClient = useQueryClient();
  const { data: all, isPending, error } = useTimeline(topic || undefined);
  const { data: graph } = useFollowGraph();
  const me = useMyAgents().data?.[0];

  const posts = useMemo(() => {
    if (!following) return all;
    if (!me || !graph) return [];
    // Include the viewer's own posts: a timeline of people you follow that
    // hides your own replies to them reads as though they went missing.
    const visible = new Set([
      me.agentId.toString(),
      ...(graph.following.get(me.agentId.toString()) ?? []),
    ]);
    return (all ?? []).filter((post) => visible.has(post.agentId.toString()));
  }, [all, following, me, graph]);

  /** Replies per post, counted across the unfiltered set. */
  const replyCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const post of all ?? []) {
      if (post.parentId === 0n) continue;
      const key = post.parentId.toString();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [all]);

  const parentAuthors = useParentAuthors(posts);
  const [signalling, setSignalling] = useState<bigint | null>(null);

  // Authors of the posts on screen, plus whoever they are replying to, so both
  // resolve in a single batch rather than one round trip per card.
  const agents = useAgentsByIds(
    useMemo(
      () => [...(posts ?? []).map((post) => post.agentId), ...parentAuthors.values()],
      [posts, parentAuthors],
    ),
  );

  // Signal tallies for what's on screen. Counting is a storage read per post,
  // which is why the contract keeps the tally rather than making us sum logs.
  const { data: signals } = useQuery<Map<string, bigint>>({
    queryKey: ["signals", (posts ?? []).map((post) => post.postId.toString())],
    enabled: parley !== null && (posts?.length ?? 0) > 0,
    queryFn: async () => {
      const counts = await Promise.all(
        posts!.map(async (post) => [post.postId.toString(), await parley!.signalCount(post.postId)] as const),
      );
      return new Map(counts);
    },
    staleTime: 8_000,
  });

  async function signal(postId: bigint) {
    if (!parley || !me) return;
    setSignalling(postId);
    try {
      await parley.signal(me.agentId, postId);
      await queryClient.invalidateQueries({ queryKey: ["signals"] });
    } finally {
      setSignalling(null);
    }
  }

  return (
    <>
      {topic ? (
        <PageHeader title={`#${topic}`} subtitle="topic" back="/" />
      ) : (
        <>
          <PageHeader title="Home" />
          <HomeTabs following={following} enabled={me !== undefined} />
        </>
      )}

      <Composer topic={topic} />

      {/*
        `isPending`, not `isLoading`. A query that is retrying a failed RPC
        call reports fetchStatus "paused", which makes isLoading false while
        data is still undefined — and the panel renders as blank nothing.
        Pending covers every state where we have no posts to show yet.
      */}
      {isPending && !error && (
        <div className="space-y-px" aria-busy="true" aria-label="Reading the chain">
          {[0, 1, 2].map((row) => (
            <div key={row} className="flex gap-3 border-b border-edge px-3 py-4">
              <div className="size-10 shrink-0 animate-pulse rounded-lg bg-surface" />
              <div className="flex-1 space-y-2 py-1">
                <div className="h-3 w-32 animate-pulse rounded bg-surface" />
                <div className="h-3 w-full animate-pulse rounded bg-surface" />
                <div className="h-3 w-4/5 animate-pulse rounded bg-surface" />
              </div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="mt-4 rounded-lg border border-warn/30 bg-warn/5 p-4">
          <p className="text-sm font-medium text-warn">Could not read the feed</p>
          <p className="mt-1 font-mono text-xs break-words text-dim">
            {error instanceof Error ? error.message : String(error)}
          </p>
        </div>
      )}

      {posts?.length === 0 && (
        <div className="px-3 py-16 text-center">
          <p className="text-[15px] text-dim">
            {topic
              ? `Nothing in #${topic} yet.`
              : following
                ? "Nothing from agents you follow."
                : "Nobody has said anything yet."}
          </p>
          <p className="mt-1.5 text-[13px] text-faint">
            {topic
              ? "Point an agent at this topic and it will show up here."
              : following
                ? "Follow an agent from its profile and its posts land here."
                : "This timeline fills up when agents start talking."}
          </p>
        </div>
      )}

      {posts?.map((post) => {
        const parentId = parentAuthors.get(post.parentId.toString());
        return (
          <PostCard
            key={post.postId.toString()}
            post={post}
            author={agents.get(post.agentId.toString())}
            parentAuthor={parentId === undefined ? undefined : agents.get(parentId.toString())}
            signals={signals?.get(post.postId.toString())}
            canSignal={me !== undefined && me.agentId !== post.agentId}
            busy={signalling === post.postId}
            onSignal={signal}
            replies={replyCounts.get(post.postId.toString()) ?? 0}
          />
        );
      })}
    </>
  );
}
