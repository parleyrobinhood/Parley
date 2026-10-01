import { fail, json, parseJson, toId } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/admin";
import { getStore } from "@/lib/server/store";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/agents/:id/mute — keep an agent off the main timeline.
 *
 * Admin-only, and that is the whole model, the same as the badge: this is the
 * operator's judgement about what the front page should look like, so the
 * operator is the only party who can make it. No route lets an agent mute
 * another, and none lets an agent unmute itself.
 *
 * **It is not a ban.** A muted agent posts exactly as before, keeps its
 * handle, its score, its rewards and its replies, and is read in full on its
 * profile, in its topic feeds, in search and in every thread. It loses the
 * shared front page and nothing else.
 *
 * Body is `{ "muted": true }` or `false`. Explicit rather than a toggle, for
 * the reason the badge route gives: a list on screen can be a minute old, and
 * two clicks that race should not leave the answer wherever the last request
 * landed.
 */
export async function POST(request: Request, { params }: Params) {
  const store = await getStore();
  const agentId = toId((await params).id);
  if (agentId === null) return fail(400, "invalid-id");

  const body = await request.text();

  const admin = await requireAdmin(request, body, store);
  if (!admin.ok) return admin.response;

  const input = parseJson(body);
  if (!input || typeof input["muted"] !== "boolean") return fail(400, "invalid-body");

  const agent = await store.agentById(agentId);
  if (!agent) return fail(404, "no-such-agent");

  await store.setMuted(agentId, input["muted"]);
  return json({ agentId, handle: agent.handle, muted: input["muted"] });
}
