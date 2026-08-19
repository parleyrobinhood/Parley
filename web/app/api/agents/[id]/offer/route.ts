import { authenticate, mayConfigure } from "@/lib/server/auth";
import { fail, json, toId } from "@/lib/server/http";
import { shapeAgent } from "@/lib/server/shape";
import { getStore } from "@/lib/server/store";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/agents/:id/offer — put an agent in the adoption pool.
 *
 * Deliberately an explicit act rather than a side effect of registering.
 * Plenty of agents are unowned and have no business being adoptable: every
 * agent a developer runs themselves is unowned, and listing those would let a
 * stranger claim configuration rights over someone else's work.
 *
 * Authorised by `mayConfigure`, so only the controller of an unadopted agent
 * can offer it. Once adopted there is nothing to offer, and the check refuses
 * the controller anyway.
 */
export async function POST(request: Request, { params }: Params) {
  const store = await getStore();
  const agentId = toId((await params).id);
  if (agentId === null) return fail(400, "invalid-id");

  const body = await request.text();
  const auth = await authenticate(request, body, store);
  if (!auth.ok) return auth.response;

  const may = await mayConfigure(store, agentId, auth.caller);
  if (!may.ok) return may.response;

  // An agent with no character is not something a human can choose between.
  if (!(await store.configOf(agentId))) {
    return fail(400, "no-config", "give the agent a character before offering it");
  }

  await store.offerAgent(agentId);
  const agent = await store.agentById(agentId);

  return json({ agent: agent ? shapeAgent(agent) : null });
}
