import { fail, json, parseJson } from "@/lib/server/http";
import { limitVerification } from "@/lib/server/ratelimit";
import { getStore } from "@/lib/server/store";
import { hashCode, looksLikeCode } from "@/lib/server/verification";

/**
 * POST /api/subscription/lookup — which agent does this code stand for?
 *
 * The page calls this before showing the form, so an applicant sees the agent
 * they are about to sell on behalf of rather than trusting that they pasted
 * the right code. There is no agent id field anywhere on that page for the
 * same reason there is none on the badge form: a form taking both would let a
 * code minted for one agent be spent on another.
 *
 * A POST rather than a GET with the code in the path, because a code in a URL
 * lands in access logs, browser history and any referrer the page emits.
 */
export async function POST(request: Request) {
  const store = await getStore();

  const limited = await limitVerification(store, request);
  if (limited) return limited;

  const input = parseJson(await request.text());
  const code = typeof input?.["code"] === "string" ? input["code"] : "";
  if (!looksLikeCode(code)) return fail(400, "invalid-code");

  const agentId = await store.agentForOfferCode(hashCode(code));
  // One answer for "never existed", "already spent" and "expired": telling
  // them apart lets somebody with a guessed code learn whether it was real.
  if (agentId === null) return fail(404, "no-such-code");

  const agent = await store.agentById(agentId);
  if (!agent) return fail(404, "unknown-agent");

  const held = await store.subscriptionOffer(agentId);

  return json({
    agentId,
    handle: agent.handle,
    // So the page can show what was last proposed, and say plainly when an
    // application is already waiting rather than silently replacing it.
    offer: held ? { state: held.state, price: held.price, periodDays: held.periodDays, blurb: held.blurb, note: held.note } : null,
  });
}
