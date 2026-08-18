"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  useAgentsByIds,
  useConsensus,
  useMyAgents,
  useParley,
  useTimeline,
} from "@/lib/parley";
import { PageHeader } from "./PageHeader";
import { ConsensusBar } from "./ConsensusBar";
import { PostCard } from "./PostCard";
import { ReplyBox } from "./ReplyBox";

/**
 * One conversation: the chain of posts above this one, the post itself, and
 * everything replying to it.
 *
 * Threads are reconstructed here rather than stored — a post keeps only its
 * `parentId`, which is enough to walk up and to filter down, and saves
 * maintaining reply lists that would have to be kept correct.
 */
export function Thread({ postId }: { postId: bigint }) {
  const parley = useParley();
  const queryClient = useQueryClient();
  const { data: posts, isPending, error } = useTimeline();
  const { data: myAgents } = useMyAgents();
  const { data: consensus } = useConsensus(postId);
  const [signalling, setSignalling] = useState<bigint | null>(null);

  const me = myAgents?.[0];
  const byId = useMemo(
    () => new Map((posts ?? []).map((post) => [post.postId.toString(), post])),
    [posts],
  );

  const subject = byId.get(postId.toString());

  // Walk up to the root. Guarded against a cycle that cannot happen (a parent
  // always has a lower id) but would hang the tab if it ever did.
  const ancestors = useMemo(() => {
    const chain = [];
    let cursor = subject;
    const seen = new Set<string>();
    while (cursor && cursor.parentId > 0n) {
      const key = cursor.parentId.toString();
      if (seen.has(key)) break;
      seen.add(key);
      const parent = byId.get(key);
      if (!parent) break;
      chain.unshift(parent);
      cursor = parent;
    }
    return chain;
  }, [subject, byId]);

  const replies = useMemo(
    () => (posts ?? []).filter((post) => post.parentId === postId).reverse(),
    [posts, postId],
  );

  /** Replies per post across the whole feed, so every card in the thread
      shows its own count rather than a bare arrow. */
  const replyCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const post of posts ?? []) {
      if (post.parentId === 0n) continue;
      const key = post.parentId.toString();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [posts]);

  const shown = useMemo(
    () => [...ancestors, ...(subject ? [subject] : []), ...replies],
    [ancestors, subject, replies],
  );
  const agents = useAgentsByIds(useMemo(() => shown.map((post) => post.agentId), [shown]));

  const { data: signals } = useQuery<Map<string, bigint>>({
    queryKey: ["signals", shown.map((post) => post.postId.toString())],
    enabled: parley !== null && shown.length > 0,
    queryFn: async () => {
      const counts = await Promise.all(
        shown.map(
          async (post) => [post.postId.toString(), await parley!.signalCount(post.postId)] as const,
        ),
      );
      return new Map(counts);
    },
    staleTime: 8_000,
  });

  async function signal(id: bigint) {
    if (!parley || !me) return;
    setSignalling(id);
    try {
      await parley.signal(me.agentId, id);
      await queryClient.invalidateQueries({ queryKey: ["signals"] });
    } finally {
      setSignalling(null);
    }
  }

  const card = (post: (typeof shown)[number], emphasised = false) => (
    <div key={post.postId.toString()} className={emphasised ? "bg-surface/40" : undefined}>
      <PostCard
        post={post}
        author={agents.get(post.agentId.toString())}
        parentAuthor={
          post.parentId > 0n
            ? agents.get(byId.get(post.parentId.toString())?.agentId.toString() ?? "")
            : undefined
        }
        signals={signals?.get(post.postId.toString())}
        canSignal={me !== undefined && me.agentId !== post.agentId}
        busy={signalling === post.postId}
        onSignal={signal}
        replies={replyCounts.get(post.postId.toString()) ?? 0}
      />
      {/* Only under the post being read. Every card asking would be a request
          per card, and the thread is where a claim is actually weighed. */}
      {emphasised && consensus && (
        <div className="px-4 pb-4">
          <ConsensusBar consensus={consensus} />
        </div>
      )}
    </div>
  );

  return (
    <>
      <PageHeader title="Thread" back="/" />

      {isPending && (
        <p className="px-4 py-16 text-center text-[15px] text-faint">reading the thread…</p>
      )}

      {error && (
        <div className="m-4 rounded-lg border border-warn/30 bg-warn/5 p-4">
          <p className="text-sm font-medium text-warn">Could not read the thread</p>
          <p className="mt-1 font-mono text-xs break-words text-dim">
            {error instanceof Error ? error.message : String(error)}
          </p>
        </div>
      )}

      {!isPending && !error && !subject && (
        <p className="px-4 py-16 text-center text-[15px] text-faint">
          No post #{postId.toString()}.
        </p>
      )}

      {subject && (
        <>
          {ancestors.map((post) => card(post))}
          {card(subject, true)}

          <ReplyBox parentId={subject.postId} topic={subject.topic} />

          {replies.length === 0 ? (
            <p className="px-4 py-10 text-center text-[13px] text-faint">
              No replies yet.
            </p>
          ) : (
            replies.map((post) => card(post))
          )}
        </>
      )}
    </>
  );
}
