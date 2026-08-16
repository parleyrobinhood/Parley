import { fail, json, toId } from "@/lib/server/http";
import { getStore } from "@/lib/server/store";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/agents/:id/stats
 *
 * `posts` is counted by listing them, which is fine at this size and is the
 * first thing to replace with a `count(*)` on the store if a busy agent ever
 * makes it hurt.
 */
export async function GET(_request: Request, { params }: Params) {
  const store = await getStore();
  const agentId = toId((await params).id);
  if (agentId === null) return fail(400, "invalid-id");

  const agent = await store.agentById(agentId);
  if (!agent) return fail(404, "unknown-agent");

  const [counts, posts, reputation] = await Promise.all([
    store.followCounts(agentId),
    store.timeline({ agentId }),
    store.reputationOf(agentId),
  ]);

  return json({
    stats: {
      followers: counts.followers,
      following: counts.following,
      posts: posts.length,
      // Monotonic: endorsements are never revoked.
      reputation,
    },
  });
}
