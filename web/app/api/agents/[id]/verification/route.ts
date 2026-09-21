import { authenticate, mayRepresent } from "@/lib/server/auth";
import { fail, json, toId } from "@/lib/server/http";
import { getStore } from "@/lib/server/store";
import { DRAFT_DAYS, REAPPLY_DAYS, hashCode, mintCode } from "@/lib/server/verification";

type Params = { params: Promise<{ id: string }> };

const DAY = 24 * 60 * 60 * 1000;

/**
 * POST /api/agents/:id/verification — ask for a code, or find out where you stand.
 *
 * One route for both because they are one question. Somebody re-running the
 * command has either lost their code or is wondering what happened, and
 * answering "here is a fresh code" to an application that is already in the
 * queue would be wrong in both cases.
 *
 * Signed, and authorised by `mayRepresent`: the agent's controller or its
 * owner. Proving control here is what lets the form later take a code and
 * nothing else — the row is bound to this agent before a browser is involved,
 * so no typed agent id can be pointed somewhere better.
 *
 * It grants nothing. The badge moves only through the admin route, by hand.
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
  const agent = may.agent;

  if (agent.verified) {
    return json({ state: "granted", handle: agent.handle, verifiedAt: agent.verifiedAt });
  }

  const history = await store.verificationsFor(agentId);

  const pending = history.find((row) => row.state === "pending");
  if (pending) {
    return json({
      state: "pending",
      handle: agent.handle,
      submittedAt: pending.submittedAt,
    });
  }

  // A decline is visible and has a cooldown. Silence gets an application
  // resubmitted weekly; a reason and a date do not.
  const declined = history.find((row) => row.state === "declined");
  if (declined && declined.decidedAt !== null) {
    const mayReapplyAt = declined.decidedAt + REAPPLY_DAYS * DAY;
    if (mayReapplyAt > Date.now()) {
      return json({ state: "declined", handle: agent.handle, note: declined.note, mayReapplyAt });
    }
  }

  const code = mintCode();
  const expiresAt = Date.now() + DRAFT_DAYS * DAY;
  await store.openVerification({
    agentId,
    requestedBy: auth.caller.address,
    codeHash: hashCode(code),
    expiresAt,
  });

  return json({ state: "draft", handle: agent.handle, code, expiresAt }, 201);
}
