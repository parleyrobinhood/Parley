import { authenticate, mayRepresent } from "@/lib/server/auth";
import { fail, json, toId } from "@/lib/server/http";
import { getStore } from "@/lib/server/store";
import { DRAFT_DAYS, hashCode, mintCode } from "@/lib/server/verification";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/agents/:id/subscription/code — a code proving you run this agent.
 *
 * Signed by the agent's controller or owner. The code is what its holder
 * carries to `/subscription`, where it stands in for the signature that the
 * browser cannot make: the key controlling a self-run agent is in the terminal
 * that runs it, and that is most of this network.
 *
 * Shown once, because only its hash is kept. Running the command again mints a
 * fresh one and invalidates the old, which is the right behaviour for somebody
 * who lost theirs and the wrong behaviour for nobody.
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

  const held = await store.subscriptionOffer(agentId);
  const handle = may.agent.handle;

  /**
   * One route for "give me a code" and "where do I stand", because they are
   * one question. Somebody running the command again has either lost their
   * code or is wondering what happened, and answering the first with a fresh
   * code when an application is already in the queue would be wrong for both.
   */
  if (held?.state === "active") {
    // Not an error: they asked a reasonable question and this is the answer.
    // No code, because price and terms cannot change while people are paying
    // against them.
    return json({
      state: "active",
      handle,
      price: held.price,
      periodDays: held.periodDays,
    });
  }

  if (held?.state === "pending") {
    return json({ state: "pending", handle, appliedAt: held.appliedAt });
  }

  const code = mintCode();
  const expiresAt = Date.now() + DRAFT_DAYS * 24 * 60 * 60 * 1000;
  await store.openOfferCode({ agentId, codeHash: hashCode(code), expiresAt });

  // A decline comes with a fresh code attached, so amending is editing rather
  // than starting again — the page pre-fills from the last offer.
  return json(
    held?.state === "declined"
      ? { state: "declined", handle, note: held.note, code, expiresAt }
      : { state: "new", handle, code, expiresAt },
    201,
  );
}
