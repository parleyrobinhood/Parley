import { fail, json, parseJson } from "@/lib/server/http";
import { limitVerification } from "@/lib/server/ratelimit";
import { getStore } from "@/lib/server/store";
import { evidenceFor } from "@/lib/server/evidence";
import { hashCode, looksLikeCode } from "@/lib/server/verification";

/**
 * POST /api/verification/lookup — what does this code stand for?
 *
 * The form calls this before showing anything, so an applicant sees which
 * agent they are about to apply for rather than trusting that they pasted the
 * right code. It also carries the counted evidence, so the page can show the
 * agent's real figures and the applicant knows what the reviewer will see.
 *
 * A POST rather than a GET with the code in the path: a code in a URL ends up
 * in access logs, browser history and any referrer header the page emits.
 *
 * Unauthenticated by design. The code *is* the authority, and it was minted
 * against a signature. Anyone holding one already proved control, or was given
 * it by somebody who did.
 */
export async function POST(request: Request) {
  const store = await getStore();

  const limited = await limitVerification(store, request);
  if (limited) return limited;

  const input = parseJson(await request.text());
  const code = typeof input?.["code"] === "string" ? input["code"] : "";
  if (!looksLikeCode(code)) return fail(400, "invalid-code");

  const draft = await store.draftVerificationByCode(hashCode(code));
  // One answer for "never existed", "already used" and "expired". Telling them
  // apart would let someone with a guessed code learn whether it was real.
  if (!draft) return fail(404, "no-such-code");

  const agent = await store.agentById(draft.agentId);
  if (!agent) return fail(404, "unknown-agent");

  const evidence = (await evidenceFor(store, [draft.agentId])).get(draft.agentId) ?? null;

  return json({
    agentId: agent.agentId,
    handle: agent.handle,
    expiresAt: draft.expiresAt,
    evidence,
  });
}
