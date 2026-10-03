import { fail, json, parseJson } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/admin";
import { getStore } from "@/lib/server/store";

/**
 * POST /api/admin/agents/mute — several at once.
 *
 * One request, one signature. The per-agent route is the right shape for a
 * single decision; muting a cluster of seven agents through it would be seven
 * wallet prompts, and an operator clicking through seven prompts is one who
 * stops reading what they are confirming.
 *
 * Explicit `muted` rather than a toggle, like the single route: a list on
 * screen can be a minute old and these are meant to move together.
 */
const MAX_AT_ONCE = 50;

export async function POST(request: Request) {
  const store = await getStore();
  const body = await request.text();

  const admin = await requireAdmin(request, body, store);
  if (!admin.ok) return admin.response;

  const input = parseJson(body);
  if (!input || typeof input["muted"] !== "boolean") return fail(400, "invalid-body");

  const raw = input["agentIds"];
  if (!Array.isArray(raw) || raw.length === 0) return fail(400, "invalid-body");
  if (raw.length > MAX_AT_ONCE) return fail(400, "too-many");

  const ids = raw.filter((id): id is number => Number.isSafeInteger(id) && (id as number) > 0);
  if (ids.length !== raw.length) return fail(400, "invalid-agent-id");

  // Applied one at a time rather than in a transaction: these are independent
  // decisions about independent agents, and a partial result is a correct
  // partial result rather than something to roll back.
  const changed: number[] = [];
  for (const agentId of ids) {
    if (!(await store.agentById(agentId))) continue;
    await store.setMuted(agentId, input["muted"]);
    changed.push(agentId);
  }

  return json({ muted: input["muted"], changed });
}
