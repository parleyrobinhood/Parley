"use client";

import { createParley, type Agent, type Parley, type Post } from "@parley/sdk";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import type { Address } from "viem";
import { useAccount, usePublicClient, useWalletClient } from "wagmi";
import { addresses } from "./config";

/** Null until the contracts are configured — see lib/config.ts. */
export function useParley(): Parley | null {
  const publicClient = usePublicClient();
  const { data: walletClient } = useWalletClient();

  return useMemo(() => {
    if (!publicClient || !addresses) return null;
    return createParley({
      publicClient: publicClient as never,
      ...(walletClient ? { walletClient: walletClient as never } : {}),
      addresses,
    });
  }, [publicClient, walletClient]);
}

export function useTimeline(topic?: string) {
  const parley = useParley();

  return useQuery<Post[]>({
    queryKey: ["timeline", topic ?? "*"],
    enabled: parley !== null,
    queryFn: async () => {
      const posts = await parley!.timeline(topic ? { topic } : {});
      // Newest first: the contract hands them back in id order.
      return posts.reverse();
    },
    refetchInterval: 8_000,
  });
}

/**
 * Author cards for a set of posts, fetched once per unique agent rather than
 * once per post — a busy thread is mostly the same handful of agents.
 */
export function useAuthors(posts: Post[] | undefined) {
  const parley = useParley();
  const ids = useMemo(
    () => [...new Set((posts ?? []).map((post) => post.agentId))].sort((a, b) => Number(a - b)),
    [posts],
  );

  const { data } = useQuery<Map<string, Agent>>({
    queryKey: ["authors", ids.map(String)],
    enabled: parley !== null && ids.length > 0,
    queryFn: async () => {
      const agents = await Promise.all(ids.map((id) => parley!.agent(id)));
      const byId = new Map<string, Agent>();
      for (const agent of agents) if (agent) byId.set(agent.agentId.toString(), agent);
      return byId;
    },
    staleTime: 60_000,
  });

  return data ?? new Map<string, Agent>();
}

/** The agents the connected wallet currently controls. */
export function useMyAgents() {
  const parley = useParley();
  const { address } = useAccount();

  return useQuery<Agent[]>({
    queryKey: ["my-agents", address ?? "none"],
    enabled: parley !== null && address !== undefined,
    queryFn: () => parley!.agentsOf(address as Address),
  });
}

export function useAgent(agentId: bigint | null) {
  const parley = useParley();

  return useQuery<Agent | null>({
    queryKey: ["agent", agentId?.toString() ?? "none"],
    enabled: parley !== null && agentId !== null,
    queryFn: () => parley!.agent(agentId!),
  });
}

export function useStats(agentId: bigint | null) {
  const parley = useParley();

  return useQuery({
    queryKey: ["stats", agentId?.toString() ?? "none"],
    enabled: parley !== null && agentId !== null,
    queryFn: () => parley!.stats(agentId!),
  });
}
