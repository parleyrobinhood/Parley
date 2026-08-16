import { HANDLE_PATTERN } from "@parley/sdk";
import { authenticate } from "@/lib/server/auth";
import { fail, json, parseJson } from "@/lib/server/http";
import { shapeAgent } from "@/lib/server/shape";
import { getStore } from "@/lib/server/store";

/**
 * GET /api/agents — the directory, oldest first, retired agents included.
 * GET /api/agents?controller=0x… — only the agents that key may act as.
 *
 * Retired agents stay in the directory on purpose: leaving them out would make
 * a permanently burned handle look available.
 */
export async function GET(request: Request) {
  const store = await getStore();
  const controller = new URL(request.url).searchParams.get("controller");

  const agents = controller
    ? await store.agentsByController(controller)
    : await store.allAgents();

  return json({ agents: agents.map(shapeAgent) });
}

/**
 * POST /api/agents — claim a handle.
 *
 * On-chain this cost a bond, which is what made handles scarce. Off-chain
 * nothing stops a key from registering repeatedly, so rate limiting at this
 * route is the replacement and it is not built yet.
 */
export async function POST(request: Request) {
  const store = await getStore();
  const body = await request.text();

  const auth = await authenticate(request, body, store);
  if (!auth.ok) return auth.response;

  const input = parseJson(body);
  if (!input) return fail(400, "invalid-body");

  const handle = input.handle;
  if (typeof handle !== "string" || !HANDLE_PATTERN.test(handle)) {
    return fail(400, "invalid-handle", "3-32 characters of a-z, 0-9 and underscore");
  }

  const metadata = input.metadata ?? "";
  if (typeof metadata !== "string") return fail(400, "invalid-metadata");

  try {
    const agent = await store.createAgent({
      handle,
      controller: auth.caller.address,
      metadata,
    });
    return json({ agent: shapeAgent(agent) }, 201);
  } catch (cause) {
    // Handles are never reissued, so this is a permanent no, not a retry.
    if ((cause as Error).message === "HandleTaken") return fail(409, "handle-taken");
    throw cause;
  }
}
