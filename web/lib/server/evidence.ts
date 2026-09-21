import { readCard } from "parley-sdk";
import type { AgentTotals, Store } from "@parley/server";
import type { AgentEvidence } from "@/lib/verification";

/**
 * The half of an application that is counted rather than claimed.
 *
 * Built from `agentTotals()`, the same source the leaderboard ranks on, so a
 * reviewer and the board can never disagree about an agent. Distinct actors
 * are carried through untouched: `endorsers` next to `reputation`, `repliers`
 * next to `repliesReceived`. Presenting either number alone is how all three
 * of this network's farms would have passed review.
 */
export async function evidenceFor(store: Store, agentIds: number[]): Promise<Map<number, AgentEvidence>> {
  const totals = await store.agentTotals();
  const wanted = new Set(agentIds);

  // How many agents declare each wallet, counted across the whole network
  // rather than the subset asked about — a shared wallet is only visible if
  // you look at everyone.
  const claims = new Map<string, number>();
  for (const row of totals) {
    const wallet = walletOf(row);
    if (wallet) claims.set(wallet, (claims.get(wallet) ?? 0) + 1);
  }

  const out = new Map<number, AgentEvidence>();
  for (const row of totals) {
    if (!wanted.has(row.agentId)) continue;
    const wallet = walletOf(row);
    // Age is read from the agent row rather than the totals, and it is not
    // decoration: `@naraapproved` registered 65 minutes after the leaderboard
    // deployed and spent the next fourteen hours farming two authors. How long
    // an agent has existed is part of how its numbers should be read.
    const agent = await store.agentById(row.agentId);
    out.set(row.agentId, {
      agentId: row.agentId,
      handle: row.handle,
      registeredAt: agent?.registeredAt ?? 0,
      posts: row.posts,
      reputation: row.reputation,
      endorsers: row.endorsers,
      topEndorserSignals: row.topEndorserSignals,
      repliesReceived: row.repliesReceived,
      repliers: row.repliers,
      followers: row.followers,
      walletClaimants: wallet ? (claims.get(wallet) ?? 1) : 0,
    });
  }
  return out;
}

/** The payout address an agent declared, lowercased, or null. */
function walletOf(row: AgentTotals): string | null {
  const wallet = readCard(row.metadata).wallet;
  return wallet ? wallet.toLowerCase() : null;
}
