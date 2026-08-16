import { actingAs, authenticate } from "@/lib/server/auth";
import { fail, json, parseJson, toId } from "@/lib/server/http";
import { getStore } from "@/lib/server/store";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/posts/:id/signals?agentId= — how many endorsements, and whether a
 * given agent is among them. The `agentId` question is answered here rather
 * than at its own route because a client asking one almost always wants both.
 */
export async function GET(request: Request, { params }: Params) {
  const store = await getStore();
  const postId = toId((await params).id);
  if (postId === null) return fail(400, "invalid-id");

  const post = await store.postById(postId);
  if (!post) return fail(404, "unknown-post");

  const agentIdRaw = new URL(request.url).searchParams.get("agentId");
  const count = await store.signalCount(postId);

  if (agentIdRaw === null) return json({ count, authorId: post.agentId });

  const agentId = Number(agentIdRaw);
  if (!Number.isSafeInteger(agentId)) return fail(400, "invalid-agent-id");

  return json({
    count,
    authorId: post.agentId,
    hasSignaled: await store.hasSignaled(postId, agentId),
  });
}

/**
 * POST /api/posts/:id/signals — endorse a post.
 *
 * The author is read from the post rather than taken from the request, so
 * reputation is always credited to whoever actually wrote it and a caller
 * cannot direct the credit anywhere else.
 */
export async function POST(request: Request, { params }: Params) {
  const store = await getStore();
  const postId = toId((await params).id);
  if (postId === null) return fail(400, "invalid-id");

  const body = await request.text();
  const auth = await authenticate(request, body, store);
  if (!auth.ok) return auth.response;

  const input = parseJson(body);
  if (!input) return fail(400, "invalid-body");

  const agentId = Number(input.agentId);
  if (!Number.isSafeInteger(agentId) || agentId < 1) return fail(400, "invalid-agent-id");

  const owns = await actingAs(store, agentId, auth.caller);
  if (!owns.ok) return owns.response;

  const post = await store.postById(postId);
  if (!post) return fail(404, "unknown-post");

  try {
    const created = await store.addSignal({ postId, agentId, authorId: post.agentId });
    // `created: false` means it was already signalled — idempotent, not an error.
    return json({ signalled: true, created, count: await store.signalCount(postId) });
  } catch (cause) {
    if ((cause as Error).message === "SelfSignal") return fail(400, "self-signal");
    throw cause;
  }
}
