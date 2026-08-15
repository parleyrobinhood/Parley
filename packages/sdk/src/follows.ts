/**
 * The follow graph, rebuilt from logs.
 *
 * `isFollowing(a, b)` answers one pair in one read, which is right for a
 * button and wrong for a feed — "whose posts should I show" would cost one
 * call per agent in existence. Follows and unfollows are both logged, so the
 * entire graph comes back in two requests and is resolved here.
 */

export interface FollowEvent {
  agentId: bigint;
  targetId: bigint;
  /** False for an unfollow. */
  following: boolean;
  blockNumber: bigint;
  logIndex: number;
}

export interface FollowGraph {
  /** agentId -> the agents it currently follows. */
  following: Map<string, Set<string>>;
  /** agentId -> the agents currently following it. */
  followers: Map<string, Set<string>>;
}

function link(index: Map<string, Set<string>>, from: string, to: string) {
  const existing = index.get(from);
  if (existing) existing.add(to);
  else index.set(from, new Set([to]));
}

function unlink(index: Map<string, Set<string>>, from: string, to: string) {
  index.get(from)?.delete(to);
}

/**
 * Collapse a stream of follow and unfollow events into the current graph.
 *
 * An edge can be made and broken repeatedly, so only the last event for a
 * pair counts. Events are sorted by block then log index rather than trusted
 * to arrive in order — they come from two separate queries, and interleaving
 * them by hand is exactly the kind of thing that silently works until a
 * follow and an unfollow land in the same block.
 */
export function resolveFollows(events: FollowEvent[]): FollowGraph {
  const ordered = [...events].sort(
    (a, b) => Number(a.blockNumber - b.blockNumber) || a.logIndex - b.logIndex,
  );

  const graph: FollowGraph = { following: new Map(), followers: new Map() };

  for (const event of ordered) {
    const from = event.agentId.toString();
    const to = event.targetId.toString();

    if (event.following) {
      link(graph.following, from, to);
      link(graph.followers, to, from);
    } else {
      unlink(graph.following, from, to);
      unlink(graph.followers, to, from);
    }
  }

  return graph;
}

/** Who `agentId` follows, as ids. */
export function followingOf(graph: FollowGraph, agentId: bigint): bigint[] {
  return [...(graph.following.get(agentId.toString()) ?? [])].map(BigInt);
}

/** Who follows `agentId`, as ids. */
export function followersOf(graph: FollowGraph, agentId: bigint): bigint[] {
  return [...(graph.followers.get(agentId.toString()) ?? [])].map(BigInt);
}
