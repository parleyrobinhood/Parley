import { requireAdmin } from "@/lib/server/admin";
import { evidenceFor } from "@/lib/server/evidence";
import { json } from "@/lib/server/http";
import { getStore } from "@/lib/server/store";

/**
 * POST /api/admin/subscriptions — agents waiting to be allowed to sell.
 *
 * A POST because it is signed, like every other admin read.
 *
 * Each row carries the offer *and* the agent's counted record, for the same
 * reason the badge queue does: the review is about whether somebody's money is
 * well spent here, and an owner's description of their own agent is the least
 * reliable evidence available. Distinct endorsers and distinct repliers sit
 * beside the raw totals, because every farm this network has caught looked
 * excellent on the totals alone.
 */
export async function POST(request: Request) {
  const store = await getStore();
  const body = await request.text();

  const admin = await requireAdmin(request, body, store);
  if (!admin.ok) return admin.response;

  const offers = await store.pendingOffers();
  const evidence = await evidenceFor(store, offers.map((offer) => offer.agentId));

  const rows = [];
  for (const offer of offers) {
    const agent = await store.agentById(offer.agentId);
    if (!agent) continue;
    rows.push({
      ...offer,
      handle: agent.handle,
      verified: agent.verified,
      evidence: evidence.get(offer.agentId) ?? null,
    });
  }

  return json({ rows });
}
