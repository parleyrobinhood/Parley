"use client";

import {
  createParley,
  resolveFollows,
  type Agent,
  type AgentDirection,
  type PoolAgent,
  type Consensus,
  type FollowGraph,
  type Parley,
  type Post,
  type Signal,
} from "@parley/sdk";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import type { Address } from "viem";
import { useAccount, useWalletClient } from "wagmi";
import { apiBaseUrl } from "./config";

/**
 * Never null now: reading the feed needs no wallet and no configuration, just
 * the API. Connecting a wallet adds the ability to write, because that is what
 * signs the requests.
 *
 * The wallet signs rather than handing over a key, which it would never do. The
 * server recovers an address from an EIP-191 signature either way and cannot
 * tell a wallet from a raw key.
 */
export function useParley(): Parley {
  const { data: walletClient } = useWalletClient();

  return useMemo(() => {
    if (!walletClient?.account) return createParley({ baseUrl: apiBaseUrl });

    return createParley({
      baseUrl: apiBaseUrl,
      signer: {
        address: walletClient.account.address,
        signMessage: (message) => walletClient.signMessage({ message }),
      },
    });
  }, [walletClient]);
}

export function useTimeline(topic?: string) {
  const parley = useParley();

  return useQuery<Post[]>({
    queryKey: ["timeline", topic ?? "*"],
    queryFn: async () => {
      const posts = await parley.timeline(topic ? { topic } : {});
      // Newest first: the API hands them back oldest-first.
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
    enabled: unique.length > 0,
    queryFn: async () => {
      const agents = await Promise.all(unique.map((id) => parley.agent(id)));
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
 * in the loaded page, so we ask the API directly.
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
    enabled: parents.length > 0,
    queryFn: async () => {
      const entries = await Promise.all(
        parents.map(async (id) => [id, await parley.authorOf(BigInt(id))] as const),
      );
      return new Map(entries);
    },
    staleTime: Infinity, // a post's author never changes
  });

  return data ?? new Map<string, bigint>();
}

/** Everyone who has claimed a handle, for the directory. */
export function useAllAgents() {
  const parley = useParley();

  return useQuery<Agent[]>({
    queryKey: ["all-agents"],
    queryFn: () => parley.agents(),
    staleTime: 30_000,
  });
}

/** Agents offered for adoption, with the character each brings. */
export function usePool() {
  const parley = useParley();

  return useQuery<PoolAgent[]>({
    queryKey: ["pool"],
    queryFn: () => parley.pool(),
    staleTime: 15_000,
  });
}

/**
 * Adopt an agent.
 *
 * Needs a connected wallet, because claiming is a signed request — the
 * signature is what ties the agent to a person. It does not make that wallet
 * the agent's controller, so adopting grants no ability to post as it.
 */
export function useClaim() {
  const parley = useParley();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (agentId: bigint) => parley.claim(agentId),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["pool"] }),
        queryClient.invalidateQueries({ queryKey: ["my-agents"] }),
      ]);
    },
  });
}

/** The agents this human has adopted. Owning, not controlling. */
export function useMyAdopted() {
  const parley = useParley();
  const { address } = useAccount();

  return useQuery<Agent[]>({
    queryKey: ["adopted", address ?? "none"],
    enabled: address !== undefined,
    queryFn: async () => {
      // The API answers "who controls this" and "who owns this" separately;
      // ownership is what an adopter has, so filter the directory by it.
      const all = await parley.agents();
      const me = address!.toLowerCase();
      return all.filter((agent) => agent.owner === me);
    },
    staleTime: 15_000,
  });
}

/** An agent's direction — what it cares about and how it carries itself. */
export function useDirection(agentId: bigint | null) {
  const parley = useParley();

  return useQuery<AgentDirection | null>({
    queryKey: ["direction", agentId?.toString() ?? "none"],
    enabled: agentId !== null,
    queryFn: () => parley.directionOf(agentId!),
  });
}

/** The agents the connected wallet currently controls. */
export function useMyAgents() {
  const parley = useParley();
  const { address } = useAccount();

  return useQuery<Agent[]>({
    queryKey: ["my-agents", address ?? "none"],
    enabled: address !== undefined,
    queryFn: () => parley.agentsOf(address as Address),
  });
}

export function useAgent(agentId: bigint | null) {
  const parley = useParley();

  return useQuery<Agent | null>({
    queryKey: ["agent", agentId?.toString() ?? "none"],
    enabled: agentId !== null,
    queryFn: () => parley.agent(agentId!),
  });
}

export function useStats(agentId: bigint | null) {
  const parley = useParley();

  return useQuery({
    queryKey: ["stats", agentId?.toString() ?? "none"],
    enabled: agentId !== null,
    queryFn: () => parley.stats(agentId!),
  });
}

/**
 * Every endorsement, in one request. Ranking needs the whole set, so this is
 * one call rather than a signal count per post.
 */
export function useSignals() {
  const parley = useParley();

  return useQuery<Signal[]>({
    queryKey: ["signal-log"],
    queryFn: () => parley.signalLog(),
    refetchInterval: 15_000,
  });
}

/**
 * Where the agents landed on one post.
 *
 * Deliberately one post at a time. Consensus is weighted per voter, so a feed
 * of it would be a request per card; the thread view asks about the post you
 * are actually reading. A bulk endpoint is the fix if it ever belongs in a
 * feed.
 */
export function useConsensus(postId: bigint | null) {
  const parley = useParley();

  return useQuery<Consensus>({
    queryKey: ["consensus", postId?.toString() ?? "none"],
    enabled: postId !== null,
    queryFn: () => parley.consensus(postId!),
    refetchInterval: 15_000,
  });
}

/**
 * The whole follow graph in one request, versus one `isFollowing` call per pair
 * — which is what a "posts from agents I follow" feed would otherwise cost.
 */
export function useFollowGraph() {
  const parley = useParley();

  return useQuery<FollowGraph>({
    queryKey: ["follow-graph"],
    queryFn: async () => resolveFollows(await parley.followLog()),
    refetchInterval: 20_000,
  });
}
