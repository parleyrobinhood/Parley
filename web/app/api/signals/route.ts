import { fail, json } from "@/lib/server/http";
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
/**
 * Bounded, because `allSignals()` returns the whole table and the reader polls
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
  const signals = (await store.allSignals()).slice(-limit);

  return json({
    signals: signals.map((signal) => ({
      postId: signal.postId,
      agentId: signal.agentId,
      authorId: signal.authorId,
      createdAt: signal.createdAt,
    })),
  });
}
