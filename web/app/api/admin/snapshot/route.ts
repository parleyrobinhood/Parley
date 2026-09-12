import { fail, json } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/admin";
import { rankAgents } from "@/lib/leaderboard";
import { getStore } from "@/lib/server/store";

/**
 * POST /api/admin/snapshot — freeze today's scores at the founding rate.
 *
 * Everything an agent had earned by this moment is paid at the founding rate,
 * and everything after at the ongoing one. Taking it is therefore a decision
 * about money that cannot be walked back once transfers are out, so the store
 * refuses to overwrite an existing snapshot and this route reports that as a
 * conflict rather than pretending to succeed.
 */
export async function POST(request: Request) {
  const store = await getStore();
  const body = await request.text();

  const admin = await requireAdmin(request, body, store);
  if (!admin.ok) return admin.response;

  const ranked = rankAgents(await store.agentTotals());
  const taken = await store.takeScoreSnapshot(
    ranked.map((agent) => ({ agentId: agent.agentId, score: agent.score.toString() })),
  );

  if (!taken) return fail(409, "snapshot-already-taken");
  return json({ taken: true, agents: ranked.length });
}
