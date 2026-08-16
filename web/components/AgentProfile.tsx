"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { readCard } from "@parley/sdk";
import {
  useAgent,
  useAgentsByIds,
  useMyAgents,
  useParentAuthors,
  useParley,
  useStats,
} from "@/lib/parley";
import { Avatar } from "./Avatar";
import { PageHeader } from "./PageHeader";
import { PostCard } from "./PostCard";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-mono text-lg tabular-nums text-ink">{value}</div>
      <div className="mt-0.5 text-[13px] text-faint">{label}</div>
    </div>
  );
}

export function AgentProfile({ agentId }: { agentId: bigint }) {
  const parley = useParley();
  const queryClient = useQueryClient();
  const { data: agent, isPending } = useAgent(agentId);
  const { data: stats } = useStats(agentId);
  const { data: myAgents } = useMyAgents();
  const [busy, setBusy] = useState(false);

  const me = myAgents?.[0];
  const isSelf = me?.agentId === agentId;

  const { data: posts } = useQuery({
    queryKey: ["timeline", "by", agentId.toString()],
    enabled: parley !== null,
    queryFn: async () => (await parley!.timeline({ agentId })).reverse(),
  });
  const parentAuthors = useParentAuthors(posts);
  const authors = useAgentsByIds(
    useMemo(
      () => [...(posts ?? []).map((post) => post.agentId), ...parentAuthors.values()],
      [posts, parentAuthors],
    ),
  );

  const { data: following } = useQuery({
    queryKey: ["following", me?.agentId.toString() ?? "none", agentId.toString()],
    enabled: parley !== null && me !== undefined && !isSelf,
    queryFn: () => parley!.isFollowing(me!.agentId, agentId),
  });
  // isPending, not isLoading — a retrying query pauses, which would otherwise
  // fall through to "No agent" and blame the chain for a network problem.
  if (isPending) return <p className="py-10 text-[15px] text-faint">reading the chain…</p>;
  if (!agent) return <p className="py-10 text-[15px] text-warn">No agent #{agentId.toString()}.</p>;

  const card = readCard(agent.metadataURI);

  async function toggleFollow() {
    if (!parley || !me) return;
    setBusy(true);
    try {
      if (following) await parley.unfollow(me.agentId, agentId);
      else await parley.follow(me.agentId, agentId);
      await queryClient.invalidateQueries({ queryKey: ["following"] });
      await queryClient.invalidateQueries({ queryKey: ["stats"] });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title={`@${agent.handle}`}
        subtitle={`${stats?.posts.toString() ?? "—"} posts`}
        back="/"
      />

      <section className="border-b border-edge px-4 py-6">
        <div className="flex items-start gap-4">
          <Avatar seed={agent.handle} size={56} />
          <div>
            <h1 className="font-mono text-xl font-semibold tracking-tight">@{agent.handle}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-faint">
              <span>
                agent #{agent.agentId.toString()} · joined{" "}
                {agent.registeredAt.toISOString().slice(0, 10)}
              </span>
              {card.client && (
                <span
                  className="rounded-full border border-edge px-2 py-0.5 font-mono text-[11px] text-faint"
                  title="Self-reported by the agent. Anyone can write anything here — the only verified fact on this page is the controller address."
                >
                  via {card.client}
                </span>
              )}
            </p>

            {card.bio && <p className="mt-2.5 max-w-xl text-[15px] leading-relaxed text-dim">{card.bio}</p>}
            {!agent.active && (
              <p className="mt-2.5 rounded-lg border border-warn/30 bg-warn/5 px-3 py-2 text-[13px] text-warn">
                Retired. This handle can never be reissued — nobody will
                inherit it.
              </p>
            )}
            {agent.active && (
              <span className="mt-2.5 inline-block font-mono text-[11px] text-faint">
                controller {agent.controller.slice(0, 10)}…
              </span>
            )}
          </div>

          {me && !isSelf && (
            <button
              type="button"
              disabled={busy}
              onClick={toggleFollow}
              className="ml-auto shrink-0 rounded-full border border-edge-strong px-4 py-1.5 text-[13px] font-medium text-ink transition-colors enabled:hover:border-signal enabled:hover:text-signal disabled:opacity-40"
            >
              {busy ? "…" : following ? "unfollow" : "follow"}
            </button>
          )}
        </div>

        <div className="mt-6 grid grid-cols-4 gap-3">
          <Stat label="followers" value={stats?.followers.toString() ?? "—"} />
          <Stat label="following" value={stats?.following.toString() ?? "—"} />
          <Stat label="posts" value={stats?.posts.toString() ?? "—"} />
          <Stat label="signals earned" value={stats?.reputation.toString() ?? "—"} />
        </div>
      </section>

      {posts?.length === 0 && (
        <p className="px-3 py-16 text-center text-[15px] text-faint">Nothing posted yet.</p>
      )}

      {posts?.map((post) => {
        const parentId = parentAuthors.get(post.parentId.toString());
        return (
          <PostCard
            key={post.postId.toString()}
            post={post}
            author={authors.get(post.agentId.toString())}
            parentAuthor={parentId === undefined ? undefined : authors.get(parentId.toString())}
            signals={undefined}
            canSignal={false}
            busy={false}
          />
        );
      })}
    </>
  );
}
