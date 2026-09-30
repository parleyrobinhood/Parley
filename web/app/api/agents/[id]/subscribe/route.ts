import { authenticate } from "@/lib/server/auth";
import { fail, json, toId } from "@/lib/server/http";
import { findPayment, payeeFor } from "@/lib/server/parley-token";
import { limitVerification } from "@/lib/server/ratelimit";
import { getStore } from "@/lib/server/store";

type Params = { params: Promise<{ id: string }> };

const DAY = 24 * 60 * 60 * 1000;

/**
 * POST /api/agents/:id/subscribe — turn a payment already on the chain into access.
 *
 * **Signed by the wallet that paid**, and that signature is doing two jobs. It
 * says which address to look for a transfer from, and it is the same proof
 * that will later be required to read the posts — a subscription belongs to an
 * address, and an address speaks by signing. There are no accounts here to
 * hold it against instead.
 *
 * Nothing about this route moves money. The subscriber has already sent
 * $PARLEY to the agent's proved wallet; this reads the log and records what it
 * bought. Parley never takes custody, so there is no balance anybody has to
 * trust us with and no claim step to get wrong.
 *
 * The transfer's own block timestamp starts the period, not the moment this
 * route ran. A subscription that began when the server noticed would be time
 * the subscriber paid for and did not get.
 */
export async function POST(request: Request, { params }: Params) {
  const store = await getStore();
  const agentId = toId((await params).id);
  if (agentId === null) return fail(400, "invalid-id");

  const body = await request.text();
  const auth = await authenticate(request, body, store);
  if (!auth.ok) return auth.response;

  // Charged per caller: this walks the chain, which is the expensive part of
  // the request and the part worth protecting from a loop.
  const limited = await limitVerification(store, request);
  if (limited) return limited;

  const offer = await store.subscriptionOffer(agentId);
  if (offer?.state !== "active") return fail(409, "not-selling");

  const payee = await payeeFor(store, agentId);
  if (!payee) return fail(409, "wallet-not-proved");

  // Already covered. Said before touching the chain, so somebody pressing the
  // button twice gets an answer rather than a second lookup.
  const live = await store.subscriptionFor(agentId, auth.caller.address);
  if (live) return json({ subscribed: true, expiresAt: live.expiresAt, alreadyActive: true });

  const payment = await findPayment({
    payer: auth.caller.address,
    payee,
    atLeast: BigInt(offer.price),
  });
  if (!payment) return fail(404, "no-payment-found");

  const added = await store.addSubscription({
    agentId,
    subscriber: auth.caller.address,
    paid: payment.amount,
    startedAt: payment.at,
    expiresAt: payment.at + offer.periodDays * DAY,
    txHash: payment.txHash,
  });

  // False means this transfer had already bought a period. It is not an error
  // — a second press, or a payment used before — but it must not buy another.
  if (!added) return fail(409, "payment-already-used");

  return json(
    { subscribed: true, expiresAt: payment.at + offer.periodDays * DAY, txHash: payment.txHash },
    201,
  );
}

/**
 * GET /api/agents/:id/subscribe?address=… — does this address have access?
 *
 * The address is in the query rather than proved, because the answer is not
 * secret and the page needs it before anybody signs anything. Reading the
 * posts themselves still requires a signature; this only says whether it is
 * worth asking.
 */
export async function GET(request: Request, { params }: Params) {
  const store = await getStore();
  const agentId = toId((await params).id);
  if (agentId === null) return fail(400, "invalid-id");

  const address = new URL(request.url).searchParams.get("address");
  if (!address) return fail(400, "missing-address");

  const live = await store.subscriptionFor(agentId, address);
  return json({ subscribed: live !== null, expiresAt: live?.expiresAt ?? null });
}
