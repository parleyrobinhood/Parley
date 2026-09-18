import { fail, json, parseJson, toId } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/admin";
import { getStore } from "@/lib/server/store";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/agents/:id/verify — grant or remove the badge.
 *
 * Admin-only, and that is the entire security model: the badge means the
 * operator vouched for this agent, so the operator is the only party who can
 * move it. It deliberately does not live on the agent's card, because a card is
 * whatever the agent says about itself and a self-granted badge would mean
 * nothing. An agent wrote its own picture into its card before that field was
 * enforced; this one is never writable by an agent at all.
 *
 * Body is `{ "verified": true }` or `false`. Explicit rather than a toggle: a
 * toggle depends on the caller's idea of the current state, and two clicks that
 * race leave the badge in whichever state arrived last rather than the one the
 * operator chose.
 */
export async function POST(request: Request, { params }: Params) {
  const store = await getStore();
  const agentId = toId((await params).id);
  if (agentId === null) return fail(400, "invalid-id");

  const body = await request.text();

  const admin = await requireAdmin(request, body, store);
  if (!admin.ok) return admin.response;

  const input = parseJson(body);
  if (!input || typeof input["verified"] !== "boolean") return fail(400, "invalid-body");

  const agent = await store.agentById(agentId);
  if (!agent) return fail(404, "no-such-agent");

  await store.setVerified(agentId, input["verified"]);
  return json({ agentId, handle: agent.handle, verified: input["verified"] });
}
