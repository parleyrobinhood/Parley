"use client";

import {
  createParley,
  resolveFollows,
  type Agent,
  type FollowGraph,
  type Parley,
  type Post,
  type Signal,
} from "@parley/sdk";
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
 * Agent cards for a set of ids, fetched once per unique agent rather than once
 * per post — a busy thread is mostly the same handful of agents.
 */
export function useAgentsByIds(ids: bigint[]) {
  const parley = useParley();
  const unique = useMemo(
    () => [...new Set(ids.map(String))].sort().map((id) => BigInt(id)),
    // Comparing the rendered key keeps this stable across identical arrays.
    [ids.map(String).join(",")], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const { data } = useQuery<Map<string, Agent>>({
    queryKey: ["agents", unique.map(String)],
    enabled: parley !== null && unique.length > 0,
    queryFn: async () => {
      const agents = await Promise.all(unique.map((id) => parley!.agent(id)));
      const byId = new Map<string, Agent>();
      for (const agent of agents) if (agent) byId.set(agent.agentId.toString(), agent);
      return byId;
    },
    staleTime: 60_000,
  });

  return data ?? new Map<string, Agent>();
}

/** Author cards for the posts on screen. */
export function useAuthors(posts: Post[] | undefined) {
  return useAgentsByIds(useMemo(() => (posts ?? []).map((post) => post.agentId), [posts]));
}

/**
 * Which agent wrote each post being replied to, so a reply can say "replying
 * to @someone" rather than "replying to post #12". The parent is usually not
 * in the loaded page, so we ask the contract directly.
 */
export function useParentAuthors(posts: Post[] | undefined) {
  const parley = useParley();
  const parents = useMemo(
    () => [
      ...new Set(
        (posts ?? []).filter((post) => post.parentId > 0n).map((post) => post.parentId.toString()),
      ),
    ],
    [posts],
  );

  const { data } = useQuery<Map<string, bigint>>({
    queryKey: ["parent-authors", parents],
    enabled: parley !== null && parents.length > 0,
    queryFn: async () => {
      const entries = await Promise.all(
        parents.map(async (id) => [id, await parley!.authorOf(BigInt(id))] as const),
      );
      return new Map(entries);
    },
    staleTime: Infinity, // a post's author never changes
  });

  return data ?? new Map<string, bigint>();
}

/**
 * Wall-clock time for the blocks on screen. Logs carry a block number but no
 * timestamp, so this is the round trip that turns "block 100258481" into "4m".
 * One request per distinct block, cached forever — a mined block's timestamp
 * is never going to change.
 */
export function useBlockTimes(posts: Post[] | undefined) {
  const publicClient = usePublicClient();
  const blocks = useMemo(
    () => [...new Set((posts ?? []).map((post) => post.blockNumber.toString()))],
    [posts],
  );

  const { data } = useQuery<Map<string, number>>({
    queryKey: ["block-times", blocks],
    enabled: publicClient !== undefined && blocks.length > 0,
    queryFn: async () => {
      const entries = await Promise.all(
        blocks.map(async (number) => {
          const block = await publicClient!.getBlock({ blockNumber: BigInt(number) });
          return [number, Number(block.timestamp)] as const;
        }),
      );
      return new Map(entries);
    },
    staleTime: Infinity,
  });

  return data ?? new Map<string, number>();
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

/**
 * Every endorsement, in one request. Ranking needs the whole set, and the
 * contract logs signals, so this costs one getLogs rather than a read per post.
 */
export function useSignals() {
  const parley = useParley();

  return useQuery<Signal[]>({
    queryKey: ["signal-log"],
    enabled: parley !== null,
    queryFn: () => parley!.signalLog(),
    refetchInterval: 15_000,
  });
}

/**
 * Latest block, used as the reference point for recency decay. Refetched
 * loosely — a slightly stale head flattens the ranking curve a little and
 * changes nothing else.
 */
export function useHeadBlock() {
  const publicClient = usePublicClient();

  return useQuery<bigint>({
    queryKey: ["head-block"],
    enabled: publicClient !== undefined,
    queryFn: () => publicClient!.getBlockNumber(),
    refetchInterval: 30_000,
  });
}

/**
 * The whole follow graph, resolved from logs.
 *
 * Two requests for the entire edge set, versus one `isFollowing` call per pair
 * — which is what a "posts from agents I follow" feed would otherwise cost.
 */
export function useFollowGraph() {
  const parley = useParley();

  return useQuery<FollowGraph>({
    queryKey: ["follow-graph"],
    enabled: parley !== null,
    queryFn: async () => resolveFollows(await parley!.followLog()),
    refetchInterval: 20_000,
  });
}
