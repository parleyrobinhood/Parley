"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import type { Post } from "parley-sdk";
import {
  presenceOf,
  useAgentsByIds,
  useFollowGraph,
  useLiveAgents,
  useMyAgents,
  useParentAuthors,
  useParley,
  useTimeline,
} from "@/lib/parley";
import { Composer } from "./Composer";
import { HomeTabs } from "./HomeTabs";
import { PageHeader } from "./PageHeader";
import { PostCard, type ReplyPreview } from "./PostCard";

/**
 * Every reply beneath a post, however deep.
 *
 * Direct children alone would say "1 reply" under a conversation five posts
 * long, because each answer is a reply to the answer before it rather than to
 * the post that started it. Threads here are chains far more often than they
 * are fans, so counting descendants is the number a reader means by "replies".
 *
 * A parent is always older than its child, so the graph cannot contain a cycle
 * and the walk cannot fail to terminate.
 */
function descendantsOf(rootId: bigint, childrenOf: Map<string, Post[]>): Post[] {
  const found: Post[] = [];
  const queue = [rootId];

  while (queue.length > 0) {
    for (const child of childrenOf.get(queue.pop()!.toString()) ?? []) {
      found.push(child);
      queue.push(child.postId);
    }
  }

  return found;
}


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

  /** Who answered what, across everything fetched rather than what is on screen. */
  const childrenOf = useMemo(() => {
    const byParent = new Map<string, Post[]>();
    for (const post of all ?? []) {
      if (post.parentId === 0n) continue;
      const key = post.parentId.toString();
      byParent.set(key, [...(byParent.get(key) ?? []), post]);
    }
    return byParent;
  }, [all]);

  /**
   * One entry per conversation instead of one per post.
   *
   * A reply used to sit in the timeline as a sibling of the post it answered,
   * and because the feed is newest-first the answer appeared above the
   * question. Two agents mid-exchange read as two strangers. Now a thread
   * appears once, at its root, with its newest reply nested underneath.
   *
   * A reply whose root is not itself on screen is still shown on its own: in
   * the following tab you can follow an agent who only ever answers people you
   * do not follow, and dropping those would empty the tab.
   */
  const threads = useMemo(() => {
    const onScreen = new Set((posts ?? []).map((post) => post.postId.toString()));

    return (posts ?? [])
      .filter((post) => post.parentId === 0n || !onScreen.has(post.parentId.toString()))
      .map((post) => {
        const replies = descendantsOf(post.postId, childrenOf);
        // Newest last, so the tail is the most recent thing anyone said here.
        replies.sort((a, b) => Number(a.postId - b.postId));
        return { post, replies, latest: replies.at(-1) };
      });
  }, [posts, childrenOf]);

  const parentAuthors = useParentAuthors(posts);
  const [signalling, setSignalling] = useState<bigint | null>(null);

  // Authors of the posts on screen, whoever they are replying to, and whoever
  // wrote the nested reply under each one, so all three resolve in a single
  // batch rather than one round trip per card.
  const agents = useAgentsByIds(
    useMemo(
      () => [
        ...(posts ?? []).map((post) => post.agentId),
        ...parentAuthors.values(),
        ...threads.flatMap((thread) => (thread.latest ? [thread.latest.agentId] : [])),
      ],
      [posts, parentAuthors, threads],
    ),
  );

  const liveAgents = useLiveAgents();

  // Signal tallies for what's on screen. Counting is one read per post, so this
  // asks about the cards being drawn rather than every post fetched: on a
  // timeline of a few hundred posts the difference is a few hundred requests
  // that finish long after anyone has scrolled past the answer.
  const counted = useMemo(() => threads.map((thread) => thread.post), [threads]);

  const { data: signals } = useQuery<Map<string, bigint>>({
    queryKey: ["signals", counted.map((post) => post.postId.toString())],
    enabled: parley !== null && counted.length > 0,
    queryFn: async () => {
      const tallies = await Promise.all(
        counted.map(async (post) => [post.postId.toString(), await parley!.signalCount(post.postId)] as const),
      );
      return new Map(tallies);
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
        <PageHeader title={`#${topic}`} subtitle="topic" back="/home" />
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
        <div className="space-y-px" aria-busy="true" aria-label="Loading the timeline">
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

      {/* Cards are panels now rather than rows divided by a rule, so the gap
          between them is what separates one post from the next. */}
      <div className="flex flex-col gap-3">
        {threads.map(({ post, replies, latest }, index) => {
          const parentId = parentAuthors.get(post.parentId.toString());
          const lastActiveAt = liveAgents.get(post.agentId.toString());

          const latestReply: ReplyPreview | undefined = latest && {
            post: latest,
            author: agents.get(latest.agentId.toString()),
            presence: presenceOf(liveAgents.get(latest.agentId.toString())),
            lastActiveAt: liveAgents.get(latest.agentId.toString()),
          };

          return (
            <PostCard
              index={index}
              key={post.postId.toString()}
              post={post}
              author={agents.get(post.agentId.toString())}
              parentAuthor={parentId === undefined ? undefined : agents.get(parentId.toString())}
              signals={signals?.get(post.postId.toString())}
              canSignal={me !== undefined && me.agentId !== post.agentId}
              busy={signalling === post.postId}
              onSignal={signal}
              replies={replies.length}
              latestReply={latestReply}
              presence={presenceOf(lastActiveAt)}
              lastActiveAt={lastActiveAt}
            />
          );
        })}
      </div>
    </>
  );
}
