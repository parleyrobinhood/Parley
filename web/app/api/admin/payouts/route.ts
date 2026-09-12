import { readCard } from "parley-sdk";
import { fail, json } from "@/lib/server/http";
import { requireAdmin } from "@/lib/server/admin";
import { allocateAll, totalPayable, RATES, type PayoutInput } from "@/lib/payouts";
import { rankAgents } from "@/lib/leaderboard";
import { getStore } from "@/lib/server/store";

/**
 * POST /api/admin/payouts — what every agent is owed right now.
 *
 * A POST rather than a GET because it is signed, and the signature covers the
 * body: the rest of the API signs writes the same way, and a GET with a
 * signature header is a shape this codebase does not otherwise have.
 *
 * Everything here is derived. Nothing is stored about a payout except the
 * snapshot, because the two facts that decide an amount already exist and are
 * both authoritative: the score, which this server computes, and what the
 * treasury has actually sent, which the chain scan reads back off Robinhood
 * Chain. A third record of intent would be a third thing to disagree.
 */
export async function POST(request: Request) {
  const store = await getStore();
  const body = await request.text();

  const admin = await requireAdmin(request, body, store);
  if (!admin.ok) return admin.response;

  const ranked = rankAgents(await store.agentTotals());
  const paid = new Map((await store.airdropTotals()).map((drop) => [drop.address, drop.received]));
  const snapshots = new Map((await store.scoreSnapshots()).map((s) => [s.agentId, Number(s.score)]));

  // An address claimed by more than one agent, counted before anything is
  // allocated so both rows can be refused rather than the second one only.
  const claims = new Map<string, number>();
  for (const agent of ranked) {
    const wallet = readCard(agent.metadata).wallet?.toLowerCase();
    if (wallet) claims.set(wallet, (claims.get(wallet) ?? 0) + 1);
  }

  const inputs: PayoutInput[] = ranked.map((agent) => {
    const wallet = readCard(agent.metadata).wallet?.toLowerCase() ?? null;
    return {
      agentId: agent.agentId,
      handle: agent.handle,
      score: agent.score,
      wallet,
      snapshotScore: snapshots.get(agent.agentId) ?? null,
      received: wallet ? (paid.get(wallet) ?? "0") : "0",
      sharedWallet: wallet ? (claims.get(wallet) ?? 0) > 1 : false,
    };
  });

  const rows = allocateAll(inputs);

  return json({
    rates: RATES,
    snapshotTaken: snapshots.size > 0,
    snapshotCount: snapshots.size,
    payable: totalPayable(rows),
    rows,
  });
}
