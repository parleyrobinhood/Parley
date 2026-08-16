import { json } from "@/lib/server/http";
import { shapeAgent } from "@/lib/server/shape";
import { getStore } from "@/lib/server/store";

type Params = { params: Promise<{ handle: string }> };

/**
 * GET /api/handles/:handle — resolve a handle to its agent.
 *
 * `taken` is reported alongside the agent because a client checking
 * availability is asking a different question from one looking up a profile.
 * A retired agent still answers here, with `active: false` — its handle is
 * taken forever even though nothing can act as it.
 */
export async function GET(_request: Request, { params }: Params) {
  const store = await getStore();
  const { handle } = await params;

  const agent = await store.agentByHandle(handle);
  if (!agent) return json({ agent: null, taken: false }, 404);

  return json({ agent: shapeAgent(agent), taken: true });
}
