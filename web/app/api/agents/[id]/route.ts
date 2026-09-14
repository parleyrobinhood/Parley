import { readCard } from "parley-sdk";
import { actingAs, authenticate } from "@/lib/server/auth";
import { fail, json, parseJson, toId } from "@/lib/server/http";
import { shapeAgent } from "@/lib/server/shape";
import { getStore } from "@/lib/server/store";

type Params = { params: Promise<{ id: string }> };

/** GET /api/agents/:id */
export async function GET(_request: Request, { params }: Params) {
  const store = await getStore();
  const agentId = toId((await params).id);
  if (agentId === null) return fail(400, "invalid-id");

  const agent = await store.agentById(agentId);
  if (!agent) return fail(404, "unknown-agent");

  return json({ agent: shapeAgent(agent) });
}

/**
 * PATCH /api/agents/:id — change metadata, or hand the agent to another key.
 *
 * Handing over the controller is the one call that can lock the caller out, so
 * it is deliberately explicit rather than something `metadata` could smuggle.
 */
export async function PATCH(request: Request, { params }: Params) {
  const store = await getStore();
  const agentId = toId((await params).id);
  if (agentId === null) return fail(400, "invalid-id");

  const body = await request.text();
  const auth = await authenticate(request, body, store);
  if (!auth.ok) return auth.response;

  const owns = await actingAs(store, agentId, auth.caller);
  if (!owns.ok) return owns.response;

  const input = parseJson(body);
  if (!input) return fail(400, "invalid-body");

  if (input.metadata !== undefined) {
    if (typeof input.metadata !== "string") return fail(400, "invalid-metadata");
    await store.updateMetadata(agentId, input.metadata);

    // Remember every address this agent has declared, so a payout can ask what
    // the *agent* has been sent rather than what its current address has.
    // Without this, changing a wallet after being paid reopens a cumulative
    // target in full: the new address has received nothing, so the whole
    // allocation is owed again. Recorded on the way through rather than read
    // back later, because a card only keeps the address it holds now.
    const declared = readCard(input.metadata).wallet;
    if (declared) await store.recordWallet(agentId, declared);
  }

  if (input.controller !== undefined) {
    if (typeof input.controller !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(input.controller)) {
      return fail(400, "invalid-controller");
    }
    await store.setController(agentId, input.controller);
  }

  const agent = await store.agentById(agentId);
  return json({ agent: agent ? shapeAgent(agent) : null });
}

/**
 * DELETE /api/agents/:id — retire.
 *
 * The row survives and the handle stays claimed forever; what goes is the
 * controller, so nothing can act as this agent again.
 */
export async function DELETE(request: Request, { params }: Params) {
  const store = await getStore();
  const agentId = toId((await params).id);
  if (agentId === null) return fail(400, "invalid-id");

  const body = await request.text();
  const auth = await authenticate(request, body, store);
  if (!auth.ok) return auth.response;

  const owns = await actingAs(store, agentId, auth.caller);
  if (!owns.ok) return owns.response;

  await store.retireAgent(agentId);
  return json({ retired: true });
}
