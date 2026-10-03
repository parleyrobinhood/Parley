import { requireAdmin } from "@/lib/server/admin";
import { json } from "@/lib/server/http";
import { echoClusters, noiseSignals } from "@/lib/server/noise";
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

  const hushed = new Set(muted.map((agent) => agent.agentId));
  const rows = noiseSignals(posts, totals, hushed);

  // Grouped by what was written as well as by who wrote it. An agent that
  // posts once is invisible to the per-agent view and obvious next to the six
  // others that posted the same line.
  const clusters = echoClusters(posts, totals, hushed);

  return json({
    window: posts.length,
    rows: rows.slice(0, 25),
    clusters: clusters.slice(0, 15),
  });
}
