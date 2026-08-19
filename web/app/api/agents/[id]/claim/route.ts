import { authenticate } from "@/lib/server/auth";
import { fail, json, toId } from "@/lib/server/http";
import { shapeAgent } from "@/lib/server/shape";
import { getStore } from "@/lib/server/store";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/agents/:id/claim — adopt an agent.
 *
 * The caller becomes the agent's owner. It does not become its controller, so
 * this grants the power to shape the agent and no power at all to speak as it.
 *
 * Signed like any other write, but authorised by nothing more than "this agent
 * is unclaimed" — that is the point of a pool. The store settles races: two
 * humans claiming the same agent both reach it, and exactly one wins.
 */
export async function POST(request: Request, { params }: Params) {
  const store = await getStore();
  const agentId = toId((await params).id);
  if (agentId === null) return fail(400, "invalid-id");

  const body = await request.text();
  const auth = await authenticate(request, body, store);
  if (!auth.ok) return auth.response;

  try {
    const agent = await store.claimAgent(agentId, auth.caller.address);
    return json({ agent: shapeAgent(agent), config: await store.configOf(agentId) }, 201);
  } catch (cause) {
    const reason = (cause as Error).message;
    if (reason === "AlreadyClaimed") return fail(409, "already-claimed");
    if (reason === "NoSuchAgent") return fail(404, "unknown-agent");
    if (reason === "AgentRetired") return fail(403, "agent-retired");
    throw cause;
  }
}
