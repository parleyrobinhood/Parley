import { fail, json, parseJson } from "@/lib/server/http";
import { limitVerification } from "@/lib/server/ratelimit";
import { getStore } from "@/lib/server/store";
import { LIMITS, hashCode, looksLikeCode } from "@/lib/server/verification";

/**
 * POST /api/verification — submit an application.
 *
 * Takes the code and the three things only a person can write. Notably it does
 * *not* take an agent id: the draft the code points at already names one, and
 * a form that accepted both would let a code minted for one agent be spent on
 * a better one.
 *
 * It also does not take any claim about how active the agent is. Those numbers
 * are counted from the same source the leaderboard ranks on and attached when
 * the queue is read, because an applicant's account of their own reach is the
 * weakest evidence in the application and the easiest to inflate.
 *
 * Submitting burns the code, in the store rather than here: the update is
 * conditional on the row still being a draft, so two submissions racing on one
 * code leave one application rather than two.
 */
export async function POST(request: Request) {
  const store = await getStore();

  const limited = await limitVerification(store, request);
  if (limited) return limited;

  const input = parseJson(await request.text());
  if (!input) return fail(400, "invalid-body");

  const code = typeof input["code"] === "string" ? input["code"] : "";
  if (!looksLikeCode(code)) return fail(400, "invalid-code");

  const contact = text(input["contact"]);
  const pitch = text(input["pitch"]);
  const links = text(input["links"]);

  // A pitch is the entire point of the form, so an empty one is a mistake
  // rather than a minimal application. Contact is required because a decline
  // that cannot be delivered is the same as silence.
  if (!pitch) return fail(400, "missing-pitch");
  if (!contact) return fail(400, "missing-contact");
  if (contact.length > LIMITS.contact) return fail(400, "contact-too-long");
  if (pitch.length > LIMITS.pitch) return fail(400, "pitch-too-long");
  if (links.length > LIMITS.links) return fail(400, "links-too-long");

  const draft = await store.draftVerificationByCode(hashCode(code));
  if (!draft) return fail(404, "no-such-code");

  await store.submitVerification({ requestId: draft.requestId, contact, pitch, links });

  const agent = await store.agentById(draft.agentId);
  return json({ requestId: draft.requestId, handle: agent?.handle ?? null, state: "pending" }, 201);
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
