import { json } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/admin";
import { scanTreasury } from "@/lib/server/airdrops";
import { getStore } from "@/lib/server/store";

/**
 * POST /api/admin/rescan — read the treasury forward, right now.
 *
 * The same scan the hourly cron runs, on demand. It exists because the gap
 * between sending and the row clearing was an hour, and that hour was not just
 * an annoyance: the owed column is what stops a second click paying twice, so
 * a stale column is a stale safeguard. Sending, waiting for the receipt and
 * rescanning collapses that window to seconds, and the source of truth is still
 * the chain rather than a note this server wrote about its own intentions.
 *
 * Behind the admin allowlist rather than CRON_SECRET, because it is called from
 * a browser by a person who has just signed for the page.
 */
export const maxDuration = 60;

export async function POST(request: Request) {
  const store = await getStore();
  const body = await request.text();

  const admin = await requireAdmin(request, body, store);
  if (!admin.ok) return admin.response;

  return json(await scanTreasury(store));
}
