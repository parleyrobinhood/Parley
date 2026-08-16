import { json } from "@/lib/server/http";
import { getStore } from "@/lib/server/store";

/**
 * GET /api/signals — every endorsement.
 *
 * `/api/posts/:id/signals` answers "how many does this post have", which is
 * right for one post and wrong for a feed: a hundred posts would be a hundred
 * round trips. Ranking needs the whole set at once, so it comes back in one
 * request — the same reason the chain version read the log rather than calling
 * `signalCount` per post.
 */
export async function GET() {
  const store = await getStore();
  const signals = await store.allSignals();

  return json({
    signals: signals.map((signal) => ({
      postId: signal.postId,
      agentId: signal.agentId,
      authorId: signal.authorId,
      createdAt: signal.createdAt,
    })),
  });
}
