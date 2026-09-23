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
  const drops = await store.airdropTotals();
  const paid = new Map(drops.map((drop) => [drop.address, drop.received]));
  // When each address was last credited, so the sheet can say which rows were
  // dealt with today. Keyed the same way `received` is, and folded across an
  // agent's addresses below for the same reason.
  const creditedAt = new Map(drops.map((drop) => [drop.address, drop.seenAt ?? 0]));
  const snapshots = new Map((await store.scoreSnapshots()).map((s) => [s.agentId, Number(s.score)]));

  /**
   * Every address each agent has ever declared, not just the one on its card.
   *
   * This is what closes the double-payment hole. `received` is a fact about an
   * address, and a cumulative target needs a fact about an agent: pay an agent,
   * let it change its wallet, and the new address has received nothing, so the
   * entire allocation is owed a second time. Summing across an agent's history
   * asks the right question and lets an agent rotate a key without either
   * losing its record or gaining a second payout.
   *
   * The current card is folded in because the history only starts from when it
   * was added, and an agent that has not touched its card since is not in it.
   */
  const history = new Map<number, Set<string>>();
  const owners = new Map<string, Set<number>>();

  const link = (agentId: number, address: string) => {
    const lower = address.toLowerCase();
    (history.get(agentId) ?? history.set(agentId, new Set()).get(agentId)!).add(lower);
    (owners.get(lower) ?? owners.set(lower, new Set()).get(lower)!).add(agentId);
  };

  for (const claim of await store.walletClaims()) link(claim.agentId, claim.address);
  for (const agent of ranked) {
    const wallet = readCard(agent.metadata).wallet;
    if (wallet) link(agent.agentId, wallet);
  }

  const inputs: PayoutInput[] = ranked.map((agent) => {
    const wallet = readCard(agent.metadata).wallet?.toLowerCase() ?? null;
    const mine = history.get(agent.agentId) ?? new Set<string>();

    // An address two agents have both declared is attributable to neither, so
    // it counts toward nobody's received and blocks both rows. Same rule as the
    // shared-wallet refusal, applied to history rather than only to today's
    // card: the chain cannot say which of them earned it either way.
    const contested = (address: string) => (owners.get(address)?.size ?? 0) > 1;

    let received = 0n;
    // The most recent credit across every address this agent has held. An
    // agent that rotated its wallet after being paid was still paid then.
    let lastPaidAt = 0;
    for (const address of mine) {
      if (contested(address)) continue;
      received += BigInt(paid.get(address) ?? "0");
      lastPaidAt = Math.max(lastPaidAt, creditedAt.get(address) ?? 0);
    }

    return {
      agentId: agent.agentId,
      handle: agent.handle,
      score: agent.score,
      wallet,
      snapshotScore: snapshots.get(agent.agentId) ?? null,
      received: received.toString(),
      sharedWallet: wallet ? contested(wallet) : false,
      verified: agent.verified,
      lastPaidAt: lastPaidAt || null,
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
