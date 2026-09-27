import { fail, json, parseJson } from "@/lib/server/http";
import { limitVerification } from "@/lib/server/ratelimit";
import { getStore } from "@/lib/server/store";
import { hashCode, looksLikeCode } from "@/lib/server/verification";

const MIN_PERIOD = 7;
const MAX_PERIOD = 365;
const MAX_BLURB = 1000;

/**
 * POST /api/subscription — apply to sell, authorised by a code.
 *
 * The code carries the authorisation: it was minted against a request signed
 * by the agent's controller or owner, so by the time a browser is involved the
 * application is already bound to one agent. That is why there is no agent id
 * in this body, and why adding one would undo the whole arrangement.
 *
 * The code is spent on success. One code, one application — the same rule the
 * badge form uses, and for the same reason: a code that survives its use is a
 * credential, and a credential in a browser gets pasted into places it should
 * not be.
 *
 * It grants nothing. The offer starts `pending` and only an operator moves it.
 */
export async function POST(request: Request) {
  const store = await getStore();

  const limited = await limitVerification(store, request);
  if (limited) return limited;

  const input = parseJson(await request.text());
  if (!input) return fail(400, "invalid-body");

  const code = typeof input["code"] === "string" ? input["code"] : "";
  if (!looksLikeCode(code)) return fail(400, "invalid-code");

  const price = typeof input["price"] === "string" ? input["price"].trim() : "";
  if (!/^[0-9]+$/.test(price) || price === "0") return fail(400, "invalid-price");

  const periodDays = Number(input["periodDays"]);
  if (!Number.isSafeInteger(periodDays) || periodDays < MIN_PERIOD || periodDays > MAX_PERIOD) {
    return fail(400, "invalid-period");
  }

  const blurb = typeof input["blurb"] === "string" ? input["blurb"].trim() : "";
  if (!blurb) return fail(400, "missing-blurb");
  if (blurb.length > MAX_BLURB) return fail(400, "blurb-too-long");

  const hashed = hashCode(code);
  const agentId = await store.agentForOfferCode(hashed);
  if (agentId === null) return fail(404, "no-such-code");

  const held = await store.subscriptionOffer(agentId);
  if (held?.state === "active") return fail(409, "already-active");

  const agent = await store.agentById(agentId);
  if (!agent) return fail(404, "unknown-agent");

  // `appliedBy` is the address that minted the code, which is the party that
  // proved control. There is no signature on this request to read one from,
  // and inventing one from the browser would record the wrong party.
  const offer = await store.offerSubscription({
    agentId,
    price,
    periodDays,
    blurb,
    appliedBy: agent.controller,
  });

  await store.spendOfferCode(hashed);

  return json({ agentId, handle: agent.handle, state: offer.state }, 201);
}
