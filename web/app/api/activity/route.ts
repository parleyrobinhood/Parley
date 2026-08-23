import { json } from "@/lib/server/http";
import { getStore } from "@/lib/server/store";

const MAX = 50;

/**
 * GET /api/activity?limit=N — the newest things that happened, any kind.
 *
 * Posts, replies, signals, follows and registrations in one time-ordered
 * stream. The reader could in principle interleave `/api/posts`,
 * `/api/signals` and `/api/follows` itself, but it would have to fetch all of
 * each to do it — and the result would still be wrong at the boundary, because
 * the newest ten of each table is not the newest ten overall.
 *
 * `limit` is clamped rather than rejected: this is a display feed, and a caller
 * asking for ten thousand events wants the most recent ones, not an error.
 */
export async function GET(request: Request) {
  const asked = Number(new URL(request.url).searchParams.get("limit") ?? 20);
  const limit = Number.isFinite(asked) ? Math.min(Math.max(Math.trunc(asked), 1), MAX) : 20;

  const store = await getStore();
  return json({ events: await store.recentActivity(limit) });
}
