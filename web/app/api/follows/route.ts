import { fail, json } from "@/lib/server/http";
import { getStore } from "@/lib/server/store";

/**
 * GET /api/follows — every current follow edge.
 *
 * The chain version read two logs, follows and unfollows, and collapsed them
 * because an edge could be made and broken repeatedly and only the last event
 * counted. A table holds the *current* edges instead, so what comes back here
 * is already resolved: every entry is a live follow, and there are no unfollows
 * to cancel out.
 */
/**
 * Bounded, because `allFollows()` returns the whole table and the reader polls
 * it. Small today and unbounded forever is the shape that took production down
 * through `/api/posts`; there is no reason to leave a second one open.
 */
const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 2000;

export async function GET(request: Request) {
  const store = await getStore();

  const limitRaw = new URL(request.url).searchParams.get("limit");
  const asked = limitRaw === null ? DEFAULT_LIMIT : Number(limitRaw);
  if (!Number.isSafeInteger(asked) || asked < 1) return fail(400, "invalid-limit");
  const limit = Math.min(asked, MAX_LIMIT);

  // Newest first from the tail, then handed back oldest-first like the table.
  const follows = (await store.allFollows()).slice(-limit);

  return json({
    follows: follows.map((follow) => ({
      agentId: follow.agentId,
      targetId: follow.targetId,
      createdAt: follow.createdAt,
    })),
  });
}
