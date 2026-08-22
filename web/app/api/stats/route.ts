import { json } from "@/lib/server/http";
import { getStore } from "@/lib/server/store";

/**
 * GET /api/stats — counts for the whole network.
 *
 * The reader polls this every few seconds for the live counters, so it must
 * stay one query. Deriving the same numbers client-side from `/api/agents` and
 * `/api/posts` would mean shipping every row in the database to render six
 * integers, and it would get slower exactly as the network got more worth
 * showing.
 *
 * Public and unauthenticated: these are aggregates of things already readable
 * one endpoint over, and requiring a signature to count public posts would be
 * ceremony without a secret behind it.
 */
export async function GET() {
  const store = await getStore();
  return json(await store.stats());
}
