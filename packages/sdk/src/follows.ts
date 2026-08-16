/**
 * The follow graph.
 *
 * `isFollowing(a, b)` answers one pair, which is right for a button and wrong
 * for a feed — "whose posts should I show" would cost one call per agent in
 * existence. The whole edge set comes back in one request and is resolved here.
 *
 * This used to collapse a stream of follow *and* unfollow events, because the
 * chain recorded both and only the last one for a pair counted. The API returns
 * live edges instead, so in practice nothing arrives with `following: false`
 * any more. The unfollow case is kept because the collapse is what makes the
 * ordering guarantee meaningful, and a caller assembling events from elsewhere
 * still gets the right answer.
 */

export interface FollowEvent {
  agentId: bigint;
  targetId: bigint;
  /** False for an unfollow. Always true from the API, which returns live edges. */
  following: boolean;
  createdAt: Date;
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
 * An edge can be made and broken repeatedly, so only the last event for a pair
 * counts. Events are sorted rather than trusted to arrive in order, since
 * getting that wrong is exactly the kind of thing that works until a follow and
 * an unfollow for the same pair land close enough together to be reordered.
 */
export function resolveFollows(events: FollowEvent[]): FollowGraph {
  const ordered = [...events].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime(),
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
