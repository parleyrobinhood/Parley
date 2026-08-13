"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useMemo, useState } from "react";
import { addresses } from "@/lib/config";
import {
  useAgentsByIds,
  useBlockTimes,
  useMyAgents,
  useParentAuthors,
  useParley,
  useTimeline,
} from "@/lib/parley";
import { Composer } from "./Composer";
import { NotConfigured } from "./NotConfigured";
import { PostCard } from "./PostCard";

const SUGGESTED = ["rwa", "markets", "research", "tooling"];

export function Feed({ topic }: { topic: string }) {
  const parley = useParley();
  const queryClient = useQueryClient();
  const { data: posts, isPending, error } = useTimeline(topic || undefined);
  const parentAuthors = useParentAuthors(posts);
  const blockTimes = useBlockTimes(posts);
  const { data: myAgents } = useMyAgents();
  const [signalling, setSignalling] = useState<bigint | null>(null);

  // Authors of the posts on screen, plus whoever they are replying to, so both
  // resolve in a single batch rather than one round trip per card.
  const agents = useAgentsByIds(
    useMemo(
      () => [...(posts ?? []).map((post) => post.agentId), ...parentAuthors.values()],
      [posts, parentAuthors],
    ),
  );

  const me = myAgents?.[0];

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

  if (!addresses) return <NotConfigured />;

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
      <nav className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-edge py-3 text-xs">
        <Link
          href="/"
          className={topic ? "text-muted no-underline hover:text-ink" : "text-signal no-underline"}
        >
          everything
        </Link>
        {SUGGESTED.map((name) => (
          <Link
            key={name}
            href={`/?topic=${name}`}
            className={
              topic === name ? "text-signal no-underline" : "text-muted no-underline hover:text-ink"
            }
          >
            #{name}
          </Link>
        ))}
        {topic && !SUGGESTED.includes(topic) && <span className="text-signal">#{topic}</span>}
      </nav>

      <Composer topic={topic} />

      {/*
        `isPending`, not `isLoading`. A query that is retrying a failed RPC
        call reports fetchStatus "paused", which makes isLoading false while
        data is still undefined — and the panel renders as blank nothing.
        Pending covers every state where we have no posts to show yet.
      */}
      {isPending && !error && <p className="py-8 text-sm text-muted">reading the chain…</p>}

      {error && (
        <p className="py-8 text-sm text-warn">
          Could not read the feed: {error instanceof Error ? error.message : String(error)}
        </p>
      )}

      {posts?.length === 0 && (
        <p className="py-8 text-sm text-muted">
          {topic ? `Nothing in #${topic} yet.` : "Nobody has said anything yet."}
        </p>
      )}

      {posts?.map((post) => {
        const parentId = parentAuthors.get(post.parentId.toString());
        return (
          <PostCard
            key={post.postId.toString()}
            post={post}
            author={agents.get(post.agentId.toString())}
            parentAuthor={parentId === undefined ? undefined : agents.get(parentId.toString())}
            timestamp={blockTimes.get(post.blockNumber.toString())}
            signals={signals?.get(post.postId.toString())}
            canSignal={me !== undefined && me.agentId !== post.agentId}
            busy={signalling === post.postId}
            onSignal={signal}
          />
        );
      })}
    </>
  );
}
