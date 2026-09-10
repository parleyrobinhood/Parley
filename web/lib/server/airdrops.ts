import type { AirdropTotal, Store } from "@parley/server";

/**
 * What the reward treasury has paid out, read from the chain.
 *
 * Parley's own data left the chain, and this is the one thing that cannot: a
 * payment is a fact about Robinhood Chain, and the point of putting it on the
 * leaderboard is that a reader can go and check it rather than take this
 * project's word for it. So nothing here is a number we record when we pay.
 * It is a number we read back afterwards, from the same logs anyone else can
 * read.
 *
 * **Transfers in, not balance.** An agent that receives an airdrop and moves it
 * the same minute has still received it. A balance would say otherwise, and
 * would also credit an agent for money that arrived from somewhere else
 * entirely. Summing `Transfer` events whose sender is the treasury answers the
 * question actually being asked, which is what we have paid this address.
 */

/** Robinhood Chain mainnet. Public, no key, and the only endpoint that works: the
 * Blockscout instance sits behind a Cloudflare challenge that a server cannot pass. */
const RPC = process.env.RH_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com";

/** USDG, "Global Dollar", six decimals. Verified on chain rather than looked up. */
export const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168";
export const USDG_DECIMALS = 6;

/** Where rewards are paid from. Only transfers out of this address count. */
const TREASURY = (process.env.REWARD_TREASURY ?? "0xFcA9Ae576A2E1A814075a56d6EE34FD201e53371").toLowerCase();

/** keccak256("Transfer(address,address,uint256)") */
const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/**
 * Where to start reading, when the cursor has never moved.
 *
 * Not genesis, and it does not need to be: the treasury had never sent a
 * transaction of any kind at this block — nonce 0, no USDG balance, no transfer
 * out of it anywhere on the chain — so there is no payment before this point to
 * miss. Scanning the other 59 million blocks would only be a slower way of
 * finding nothing. Move it back, never forward, if that assumption ever turns
 * out to be wrong.
 */
const FIRST_BLOCK = Number(process.env.TREASURY_FIRST_BLOCK ?? 59_600_000);

/**
 * How much to ask for at once, and how much to do per run.
 *
 * The node refuses two different ways and both are worth knowing. A query whose
 * range is too wide dies with "log query timed out" — genesis-to-latest always
 * does, while a five-million-block window filtered to one sender comes back in
 * about a second. A query matching too much dies with "exceeds limit of 10000",
 * which is why `scanRange` splits rather than trusting a fixed width.
 *
 * Blocks are 100ms here, so the chain makes about 36,000 an hour and an hourly
 * run has to cover that. Twenty million per run is three orders of magnitude of
 * headroom, which is what lets a cursor that has fallen days behind catch up on
 * its own instead of needing someone to notice.
 */
const CHUNK = 1_000_000;
const MAX_CHUNKS = 20;
const LOG_LIMIT = 10_000;

interface Log {
  topics: string[];
  data: string;
}

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const response = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) throw new Error(`${method}: http ${response.status}`);

  const body = (await response.json()) as { result?: T; error?: { message: string } };
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result as T;
}

/** An address as a 32-byte topic, which is how an indexed parameter is matched. */
const asTopic = (address: string) => `0x${address.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;

/** The `to` of a Transfer, back from its topic. */
const fromTopic = (topic: string) => `0x${topic.slice(-40)}`.toLowerCase();

/**
 * Every treasury transfer in a block range, splitting the range if the node
 * refuses to return that many rows.
 *
 * The split is on the result cap rather than on the width, because the width
 * that is safe depends on how busy those blocks were and there is no way to
 * know that in advance. Halving on refusal converges in a handful of calls and
 * needs no estimate at all.
 */
async function scanRange(from: number, to: number): Promise<Log[]> {
  const logs = await rpc<Log[]>("eth_getLogs", [
    {
      fromBlock: `0x${from.toString(16)}`,
      toBlock: `0x${to.toString(16)}`,
      address: USDG,
      topics: [TRANSFER, asTopic(TREASURY)],
    },
  ]);

  if (logs.length < LOG_LIMIT || from >= to) return logs;

  const middle = Math.floor((from + to) / 2);
  return [...(await scanRange(from, middle)), ...(await scanRange(middle + 1, to))];
}

export interface ScanResult {
  from: number;
  to: number;
  transfers: number;
  /** True when the cursor reached the head, so a caller can tell catching-up from caught-up. */
  caughtUp: boolean;
}

/**
 * Read forward from the cursor and credit whatever the treasury sent.
 *
 * Idempotent in the only sense that matters: a range is credited once, because
 * the cursor moves in the same transaction as the credit. Re-running is a no-op
 * rather than a double payment on the board, and a run that throws leaves the
 * cursor where it was so the next one re-reads that range from scratch.
 *
 * Only finalised history is read. `latest` is used rather than a confirmation
 * lag because this is an L2 with 100ms blocks and the amounts are already
 * settled by the time anyone looks at the page; if a reorg ever mattered here,
 * this is the line that would grow a subtraction.
 */
export async function scanTreasury(store: Store): Promise<ScanResult> {
  const cursor = await store.airdropCursor();
  const from = cursor > 0 ? cursor + 1 : FIRST_BLOCK;
  const head = Number(await rpc<string>("eth_blockNumber", []));

  if (from > head) return { from, to: head, transfers: 0, caughtUp: true };

  const to = Math.min(head, from + CHUNK * MAX_CHUNKS - 1);

  const logs: Log[] = [];
  for (let start = from; start <= to; start += CHUNK) {
    logs.push(...(await scanRange(start, Math.min(to, start + CHUNK - 1))));
  }

  // Summed per recipient before writing, so one address paid ten times is one
  // row update rather than ten.
  const totals = new Map<string, bigint>();
  for (const log of logs) {
    const recipient = fromTopic(log.topics[2]);
    totals.set(recipient, (totals.get(recipient) ?? 0n) + BigInt(log.data));
  }

  const credits: AirdropTotal[] = [...totals].map(([address, received]) => ({
    address,
    received: received.toString(),
  }));

  await store.creditAirdrops({ credits, scannedTo: to });
  return { from, to, transfers: logs.length, caughtUp: to >= head };
}

/**
 * A raw token amount as something a person reads.
 *
 * Whole units below a thousand keep two decimals and larger ones keep none,
 * because the point of the column is the size of the payment rather than its
 * cents. Done on integers throughout: a float would round the very amounts
 * that are worth being exact about.
 */
export function formatUsdg(raw: string): string {
  const units = BigInt(raw) / 10n ** BigInt(USDG_DECIMALS);
  const remainder = BigInt(raw) % 10n ** BigInt(USDG_DECIMALS);

  if (units >= 1000n) return units.toLocaleString("en-US");

  const cents = (remainder / 10n ** BigInt(USDG_DECIMALS - 2)).toString().padStart(2, "0");
  return `${units}.${cents}`;
}
