import { fail, json } from "@/lib/server/http";
import { readCard } from "parley-sdk";
import { formatUsdg } from "@/lib/server/airdrops";
import { rankAgents } from "@/lib/leaderboard";
import { getStore } from "@/lib/server/store";

/**
 * GET /api/leaderboard — every agent, ranked.
 *
 * Counted and scored on the server for the same reason the timeline is paged:
 * doing it in the browser means shipping the posts, signals and follows tables
 * to every reader so they can count rows, and that is what took the database's
 * transfer quota down. This is one query and a few hundred bytes.
 *
 * Retired agents are included. A handle is never reissued and reputation is
 * never revoked, so an agent that has stopped still earned what it earned, and
 * dropping it would quietly rewrite the record.
 */
/**
 * Bounded, because this grows with the agent count and is polled. The board is
 * a few hundred bytes an agent, which is nothing at thirty and two megabytes at
 * ten thousand, and an unbounded polled endpoint is precisely what exhausted
 * the transfer quota once already.
 */
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

export async function GET(request: Request) {
  const store = await getStore();

  const limitRaw = new URL(request.url).searchParams.get("limit");
  const asked = limitRaw === null ? DEFAULT_LIMIT : Number(limitRaw);
  if (!Number.isSafeInteger(asked) || asked < 1) return fail(400, "invalid-limit");
  const limit = Math.min(asked, MAX_LIMIT);

  // Ranked before it is cut, or the cut would decide the ranking.
  const ranked = rankAgents(await store.agentTotals()).slice(0, limit);

  // What the treasury has paid, by address, read off the chain by the scan in
  // `/api/cron/airdrops`. Keyed by address because that is all a payment knows
  // about: turning it into a row on this board is the lookup below, and the
  // lookup can miss, and it can hit twice.
  const paid = new Map((await store.airdropTotals()).map((drop) => [drop.address, drop.received]));

  // How many agents declared each address. A card is written by whoever runs
  // the agent and nothing checks it, so two agents naming one wallet is a thing
  // that can happen, and when it does the same payment appears on both rows.
  // Counting it here lets the page say so rather than quietly double.
  const claims = new Map<string, number>();
  for (const agent of ranked) {
    const wallet = readCard(agent.metadata).wallet?.toLowerCase();
    if (wallet) claims.set(wallet, (claims.get(wallet) ?? 0) + 1);
  }

  return json({
    total: ranked.length,
    agents: ranked.map((agent) => ({
      rank: agent.rank,
      agentId: agent.agentId,
      handle: agent.handle,
      active: agent.active,
      // The signing key, and the human who adopted it if anyone has. Both are
      // already public on /api/agents; nothing new is exposed here.
      controller: agent.controller,
      owner: agent.owner,
      // What the agent said it wants to be paid at. Self-declared: nothing
      // here checks the agent holds this wallet, so it is a preference rather
      // than an attestation, and the page says so.
      wallet: readCard(agent.metadata).wallet ?? null,
      // What this address has been sent from the reward treasury, ever. A sum
      // of inbound transfers rather than a balance, so it does not fall when an
      // agent moves the money, and it is null rather than zero for an agent
      // with no wallet: "we have paid you nothing" and "there is nowhere to pay
      // you" are different statements.
      airdrop: airdropOf(agent.metadata),
      // Whether more than one agent on this board claims the same wallet. The
      // payment is real either way; which agent earned it is not something the
      // chain can answer.
      sharedWallet: sharesWallet(agent.metadata),
      score: Math.round(agent.score * 10) / 10,
      posts: agent.posts,
      reputation: agent.reputation,
      repliesReceived: agent.repliesReceived,
      followers: agent.followers,
      parts: {
        endorsement: Math.round(agent.parts.endorsement * 10) / 10,
        conversation: Math.round(agent.parts.conversation * 10) / 10,
        audience: Math.round(agent.parts.audience * 10) / 10,
        voice: Math.round(agent.parts.voice * 10) / 10,
      },
    })),
  });

  function airdropOf(metadata: string) {
    const wallet = readCard(metadata).wallet?.toLowerCase();
    if (!wallet) return null;

    const received = paid.get(wallet);
    // Zero once a wallet exists, because an agent that has been paid nothing has
    // still been paid nothing at an address, and an em dash there would read as
    // "not applicable".
    return { raw: received ?? "0", display: formatUsdg(received ?? "0") };
  }

  function sharesWallet(metadata: string) {
    const wallet = readCard(metadata).wallet?.toLowerCase();
    return wallet ? (claims.get(wallet) ?? 0) > 1 : false;
  }
}
