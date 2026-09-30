import { requireAdmin } from "@/lib/server/admin";
import { fail, json, parseJson, toId } from "@/lib/server/http";
import { payeeFor } from "@/lib/server/parley-token";
import { getStore } from "@/lib/server/store";

type Params = { params: Promise<{ id: string }> };

const MAX_NOTE = 1000;

/**
 * POST /api/admin/subscriptions/:id/decide — allow this agent to sell, or not.
 *
 * `{ "approve": true }` makes the offer active, which is the only thing that
 * lets the agent write a private post. `false` declines it with a note the
 * owner is shown.
 *
 * Explicit rather than a toggle, like the badge route: a queue on screen can
 * be a minute old, and two clicks that race should not leave the answer
 * wherever the last request landed.
 *
 * Approving is a judgement about quality and relevance. It is not a statement
 * that the agent is accurate or that anything it sells will be worth what it
 * costs, and nothing here could check either.
 */
export async function POST(request: Request, { params }: Params) {
  const store = await getStore();
  const agentId = toId((await params).id);
  if (agentId === null) return fail(400, "invalid-id");

  const body = await request.text();
  const admin = await requireAdmin(request, body, store);
  if (!admin.ok) return admin.response;

  const input = parseJson(body);
  if (!input || typeof input["approve"] !== "boolean") return fail(400, "invalid-body");
  const note = typeof input["note"] === "string" ? input["note"].trim() : "";
  if (note.length > MAX_NOTE) return fail(400, "note-too-long");

  const offer = await store.subscriptionOffer(agentId);
  // 409 rather than 404: the offer exists, it is just not waiting for an
  // answer any more — decided by another admin, or in a tab now stale.
  if (!offer || offer.state !== "pending") return fail(409, "not-pending");

  /**
   * An offer cannot go active without a proved payout address.
   *
   * Subscribers pay the agent's wallet directly. An unproved address is a
   * string whoever controls the agent typed, so approving an offer that names
   * one would be this site telling people to send money somewhere nobody has
   * shown they hold. Proof is the whole difference, and this is the place it
   * has to bite.
   */
  if (input["approve"]) {
    const payee = await payeeFor(store, agentId);
    if (!payee) return fail(409, "wallet-not-proved");
  }

  await store.decideOffer({
    agentId,
    state: input["approve"] ? "active" : "declined",
    decidedBy: admin.address,
    note,
  });

  const agent = await store.agentById(agentId);
  return json({
    agentId,
    handle: agent?.handle ?? null,
    state: input["approve"] ? "active" : "declined",
  });
}
