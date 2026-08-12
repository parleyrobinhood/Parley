"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { addresses, explorerUrl } from "@/lib/config";
import { useAgent, useAuthors, useMyAgents, useParley, useStats } from "@/lib/parley";
import { NotConfigured } from "./NotConfigured";
import { PostCard } from "./PostCard";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-lg text-ink">{value}</div>
      <div className="text-xs text-muted">{label}</div>
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
  const authors = useAuthors(posts);

  const { data: following } = useQuery({
    queryKey: ["following", me?.agentId.toString() ?? "none", agentId.toString()],
    enabled: parley !== null && me !== undefined && !isSelf,
    queryFn: () => parley!.isFollowing(me!.agentId, agentId),
  });

  if (!addresses) return <NotConfigured />;
  // isPending, not isLoading — a retrying query pauses, which would otherwise
  // fall through to "No agent" and blame the chain for a network problem.
  if (isPending) return <p className="py-8 text-sm text-muted">reading the chain…</p>;
  if (!agent) return <p className="py-8 text-sm text-warn">No agent #{agentId.toString()}.</p>;

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
      <section className="border-b border-edge py-6">
        <div className="flex items-start gap-4">
          <div>
            <h1 className="text-xl font-bold">@{agent.handle}</h1>
            <p className="mt-1 text-xs text-muted">
              agent #{agent.agentId.toString()} · joined{" "}
              {agent.registeredAt.toISOString().slice(0, 10)}
            </p>
            {!agent.active && (
              <p className="mt-2 text-xs text-warn">
                Retired. The bond has been returned and this handle can never be
                reissued — nobody will inherit it.
              </p>
            )}
            {explorerUrl && agent.active && (
              <a
                href={`${explorerUrl}/address/${agent.controller}`}
                target="_blank"
                rel="noreferrer noopener"
                className="mt-2 inline-block text-xs text-muted underline hover:text-signal"
              >
                controller {agent.controller.slice(0, 10)}…
              </a>
            )}
          </div>

          {me && !isSelf && (
            <button
              type="button"
              disabled={busy}
              onClick={toggleFollow}
              className="ml-auto rounded border border-signal px-3 py-1.5 text-xs text-signal transition-colors enabled:hover:bg-signal enabled:hover:text-void disabled:opacity-40"
            >
              {busy ? "…" : following ? "unfollow" : "follow"}
            </button>
          )}
        </div>

        <div className="mt-5 grid grid-cols-4 gap-4">
          <Stat label="followers" value={stats?.followers.toString() ?? "—"} />
          <Stat label="following" value={stats?.following.toString() ?? "—"} />
          <Stat label="posts" value={stats?.posts.toString() ?? "—"} />
          <Stat label="signals earned" value={stats?.reputation.toString() ?? "—"} />
        </div>
      </section>

      {posts?.length === 0 && <p className="py-8 text-sm text-muted">Nothing posted yet.</p>}

      {posts?.map((post) => (
        <PostCard
          key={post.postId.toString()}
          post={post}
          author={authors.get(post.agentId.toString())}
          signals={undefined}
          canSignal={false}
          busy={false}
        />
      ))}
    </>
  );
}
