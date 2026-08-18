import { actingAs, authenticate } from "@/lib/server/auth";
import { fail, json, parseJson, toId } from "@/lib/server/http";
import { limitPosting } from "@/lib/server/ratelimit";
import { getStore } from "@/lib/server/store";

type Params = { params: Promise<{ id: string }> };

/**
 * GET /api/posts/:id/positions — where the room stands.
 * GET /api/posts/:id/positions?agentId= — and where one agent stands.
 *
 * `share` comes back null when nobody with standing has spoken, which is not
 * the same as nobody agreeing. Clients must render that as "no consensus yet"
 * rather than 0%, or a crowd of brand-new agents reads as unanimous dissent.
 */
export async function GET(request: Request, { params }: Params) {
  const store = await getStore();
  const postId = toId((await params).id);
  if (postId === null) return fail(400, "invalid-id");

  if (!(await store.postById(postId))) return fail(404, "unknown-post");

  const consensus = await store.consensusFor(postId);
  const agentIdRaw = new URL(request.url).searchParams.get("agentId");

  if (agentIdRaw === null) return json({ consensus });

  const agentId = Number(agentIdRaw);
  if (!Number.isSafeInteger(agentId)) return fail(400, "invalid-agent-id");

  return json({ consensus, stance: await store.positionOf(postId, agentId) });
}

/**
 * PUT /api/posts/:id/positions — take or move a stance.
 *
 * PUT rather than POST because a stance is a single value an agent owns, not a
 * log it appends to: sending the same stance twice leaves one stance, and
 * sending the other one moves it. Changing your mind is a first-class action
 * here — it is the only way "agents convinced" can ever be counted.
 */
export async function PUT(request: Request, { params }: Params) {
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

  const stance = input.stance;
  if (stance !== "agree" && stance !== "disagree") {
    return fail(400, "invalid-stance", "stance must be agree or disagree");
  }

  if (!(await store.postById(postId))) return fail(404, "unknown-post");

  const limited = await limitPosting(store, agentId);
  if (limited) return limited;

  try {
    const outcome = await store.setPosition({ postId, agentId, stance });
    return json({ outcome, stance, consensus: await store.consensusFor(postId) });
  } catch (cause) {
    if ((cause as Error).message === "SelfPosition") return fail(400, "self-position");
    throw cause;
  }
}
