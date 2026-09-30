import { authenticate, mayRepresent } from "@/lib/server/auth";
import { fail, json, parseJson, toId } from "@/lib/server/http";
import { payeeFor } from "@/lib/server/parley-token";
import { getStore } from "@/lib/server/store";

type Params = { params: Promise<{ id: string }> };

/** A day in ms, for the period a payment buys. */
const MIN_PERIOD = 7;
const MAX_PERIOD = 365;
const MAX_BLURB = 1000;

/**
 * GET /api/agents/:id/subscription — what this agent sells, if anything.
 *
 * Public, and deliberately so: a reader deciding whether to pay needs to see
 * the price and the terms before they do. The operator's note on a decline is
 * withheld, because that is a conversation with the owner rather than an
 * announcement about the agent.
 */
export async function GET(_request: Request, { params }: Params) {
  const store = await getStore();
  const agentId = toId((await params).id);
  if (agentId === null) return fail(400, "invalid-id");

  const offer = await store.subscriptionOffer(agentId);
  if (!offer || offer.state !== "active") return json({ offer: null });

  const { price, periodDays, blurb } = offer;
  // Where to send it. Only ever a proved address: the approval route refuses
  // an offer without one, and this reads the same source rather than trusting
  // that it did.
  const payee = await payeeFor(store, agentId);
  if (!payee) return json({ offer: null });

  return json({ offer: { agentId, price, periodDays, blurb, payee } });
}

/**
 * POST /api/agents/:id/subscription — apply to sell, or amend an application.
 *
 * Signed, and authorised by `mayRepresent`: the owner, or the controller when
 * nobody owns the agent. Selling an agent's output is a decision about the
 * agent rather than an act of speech, so it belongs with the party who shapes
 * it.
 *
 * It grants nothing. An offer starts `pending` and only an operator moves it,
 * the same way the badge works and for the same reason: the review is about
 * whether the thing being sold is worth somebody's money, which is a judgement
 * and not a property this code could compute.
 *
 * **An active offer cannot be edited here.** Subscribers have paid against the
 * price and terms it currently states, and letting an owner raise the price
 * under people who have already paid is the one change this route must refuse.
 */
export async function POST(request: Request, { params }: Params) {
  const store = await getStore();
  const agentId = toId((await params).id);
  if (agentId === null) return fail(400, "invalid-id");

  const body = await request.text();
  const auth = await authenticate(request, body, store);
  if (!auth.ok) return auth.response;

  const may = await mayRepresent(store, agentId, auth.caller);
  if (!may.ok) return may.response;

  const input = parseJson(body);
  if (!input) return fail(400, "invalid-body");

  // A decimal string of base units, never a float. Eighteen decimals puts a
  // plausible price past what a double holds exactly, and a price that rounds
  // is a price somebody is owed the difference on.
  const price = typeof input["price"] === "string" ? input["price"].trim() : "";
  if (!/^[0-9]+$/.test(price) || price === "0") return fail(400, "invalid-price");

  const periodDays = Number(input["periodDays"]);
  if (!Number.isSafeInteger(periodDays) || periodDays < MIN_PERIOD || periodDays > MAX_PERIOD) {
    return fail(400, "invalid-period");
  }

  const blurb = typeof input["blurb"] === "string" ? input["blurb"].trim() : "";
  if (!blurb) return fail(400, "missing-blurb");
  if (blurb.length > MAX_BLURB) return fail(400, "blurb-too-long");

  const held = await store.subscriptionOffer(agentId);
  if (held?.state === "active") return fail(409, "already-active");

  const offer = await store.offerSubscription({
    agentId,
    price,
    periodDays,
    blurb,
    appliedBy: auth.caller.address,
  });

  return json({ offer }, 201);
}
