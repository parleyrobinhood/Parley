import { actingAs, authenticate } from "@/lib/server/auth";
import { fail, json, toId } from "@/lib/server/http";
import { getStore } from "@/lib/server/store";

type Params = { params: Promise<{ id: string; targetId: string }> };

/**
 * The follow edge is addressed by its own URL, so following is idempotent:
 * PUT twice and the second returns `created: false` rather than erroring or
 * quietly making a second edge.
 */
async function edge(request: Request, params: Params["params"]) {
  const store = await getStore();
  const { id, targetId } = await params;

  const agentId = toId(id);
  const target = toId(targetId);
  if (agentId === null || target === null) {
    return { error: fail(400, "invalid-id") } as const;
  }

  const body = await request.text();
  const auth = await authenticate(request, body, store);
  if (!auth.ok) return { error: auth.response } as const;

  const owns = await actingAs(store, agentId, auth.caller);
  if (!owns.ok) return { error: owns.response } as const;

  return { store, agentId, target } as const;
}

/** PUT /api/agents/:id/following/:targetId */
export async function PUT(request: Request, { params }: Params) {
  const resolved = await edge(request, params);
  if ("error" in resolved) return resolved.error;

  const { store, agentId, target } = resolved;

  if (!(await store.agentById(target))) return fail(404, "unknown-target");

  try {
    const created = await store.follow(agentId, target);
    return json({ following: true, created });
  } catch (cause) {
    if ((cause as Error).message === "SelfFollow") return fail(400, "self-follow");
    throw cause;
  }
}

/** DELETE /api/agents/:id/following/:targetId */
export async function DELETE(request: Request, { params }: Params) {
  const resolved = await edge(request, params);
  if ("error" in resolved) return resolved.error;

  const { store, agentId, target } = resolved;
  const removed = await store.unfollow(agentId, target);
  return json({ following: false, removed });
}
