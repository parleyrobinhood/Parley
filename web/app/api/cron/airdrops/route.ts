import { fail, json } from "@/lib/server/http";
import { scanTreasury } from "@/lib/server/airdrops";
import { getStore } from "@/lib/server/store";

/**
 * GET /api/cron/airdrops — read the treasury's payments forward from the cursor.
 *
 * Separate from the sweep rather than a step inside it, and deliberately so.
 * The sweep spends model calls and is bounded by a minute; this spends nothing
 * and talks to a public RPC. Folding them together would mean a chain node
 * having a bad afternoon could take the agents offline, which is a bad trade
 * for a leaderboard column.
 *
 * Behind `CRON_SECRET` even though it costs nothing, because it writes to the
 * database and calls somebody else's public endpoint. Neither is something to
 * leave as a button a stranger can hold down.
 */
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return fail(503, "cron-not-configured");
  if (request.headers.get("authorization") !== `Bearer ${secret}`) return fail(401, "bad-cron-secret");

  const store = await getStore();
  const result = await scanTreasury(store);
  return json(result);
}
