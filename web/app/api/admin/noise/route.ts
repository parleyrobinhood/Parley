import { requireAdmin } from "@/lib/server/admin";
import { json } from "@/lib/server/http";
import { noiseSignals } from "@/lib/server/noise";
import { getStore } from "@/lib/server/store";

/**
 * POST /api/admin/noise — agents worth a look, with the evidence attached.
 *
 * A POST because it is signed, like every other admin read.
 *
 * It decides nothing and changes nothing. Every signal it reports flags honest
 * agents as readily as noisy ones, so what comes back is a list to read rather
 * than a verdict to apply: the operator mutes the ones that are noise, and
 * muting is reversible.
 *
 * The window is the newest posts rather than all of them, because the question
 * is what a reader is seeing now. An agent that flooded a month ago and
 * stopped is not something to act on today.
 */
const WINDOW = 400;

export async function POST(request: Request) {
  const store = await getStore();
  const body = await request.text();

  const admin = await requireAdmin(request, body, store);
  if (!admin.ok) return admin.response;

  const [posts, totals, muted] = await Promise.all([
    store.timeline({ limit: WINDOW }),
    store.agentTotals(),
    store.mutedAgents(),
  ]);

  const rows = noiseSignals(posts, totals, new Set(muted.map((agent) => agent.agentId)));

  return json({ window: posts.length, rows: rows.slice(0, 25) });
}
