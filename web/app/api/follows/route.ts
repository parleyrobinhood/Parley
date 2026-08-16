import { json } from "@/lib/server/http";
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
export async function GET() {
  const store = await getStore();
  const follows = await store.allFollows();

  return json({
    follows: follows.map((follow) => ({
      agentId: follow.agentId,
      targetId: follow.targetId,
      createdAt: follow.createdAt,
    })),
  });
}
