import { readCard } from "parley-sdk";
import type { Store } from "@parley/server";

/**
 * Finding a subscription payment on the chain.
 *
 * **Parley never holds the money.** A subscriber sends $PARLEY straight to the
 * agent owner's wallet and this reads the chain to see that it happened. There
 * is no treasury in the middle, no balance to claim and nothing in custody,
 * which removes a whole class of question about whose money it is while it
 * waits.
 *
 * It is the same shape as the reward scan and for the same reason: a number
 * this project writes down when money moves is a number a reader has to take
 * our word for. These are the logs anybody can read.
 */

const RPC = process.env.RH_RPC_URL ?? "https://rpc.mainnet.chain.robinhood.com";

/** $PARLEY on Robinhood Chain. Eighteen decimals, like most ERC-20s. */
export const PARLEY = (process.env.PARLEY_TOKEN ?? "0xcf3d41f9671DC2E86Ee4c0271B79ae6Fdce36c05").toLowerCase();
export const PARLEY_DECIMALS = 18;

const TRANSFER = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

/**
 * How far back a payment is looked for.
 *
 * Blocks are 100ms here, so this is a little over a day. A subscriber who paid
 * and did not press the button until later is the case it exists for; one who
 * waited a week has a transfer nobody will find automatically, which the page
 * says rather than leaving them guessing.
 */
const LOOKBACK_BLOCKS = 900_000;
const CHUNK = 100_000;

interface Log {
  topics: string[];
  data: string;
  blockNumber: string;
  transactionHash: string;
}

async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const response = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) throw new Error(`${method}: ${response.status}`);
  const body = (await response.json()) as { result?: T; error?: { message: string } };
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result as T;
}

const asTopic = (address: string) =>
  `0x${address.toLowerCase().replace(/^0x/, "").padStart(64, "0")}`;

export interface Payment {
  txHash: string;
  /** Base units, as a decimal string. */
  amount: string;
  /** The block's own timestamp, in ms. Never the server clock. */
  at: number;
}

/**
 * The most recent transfer from `payer` to `payee` worth at least `atLeast`.
 *
 * Filtered on both addresses at the node rather than here, so a busy token
 * does not become a large download. The amount is checked against the price
 * because a transfer for less than the asking price has not bought anything,
 * and one for more has: somebody paying over the odds is not a reason to
 * refuse them.
 */
export async function findPayment(input: {
  payer: string;
  payee: string;
  atLeast: bigint;
}): Promise<Payment | null> {
  const head = Number(await rpc<string>("eth_blockNumber", []));
  const floor = Math.max(0, head - LOOKBACK_BLOCKS);

  // Newest first: the payment somebody just made is the one they are waiting
  // on, and walking back from the head finds it in the first chunk.
  for (let to = head; to >= floor; to -= CHUNK) {
    const from = Math.max(floor, to - CHUNK + 1);
    const logs = await rpc<Log[]>("eth_getLogs", [
      {
        fromBlock: `0x${from.toString(16)}`,
        toBlock: `0x${to.toString(16)}`,
        address: PARLEY,
        topics: [TRANSFER, asTopic(input.payer), asTopic(input.payee)],
      },
    ]);

    const paid = logs
      .map((log) => ({ log, amount: BigInt(log.data) }))
      .filter((entry) => entry.amount >= input.atLeast)
      .sort((a, b) => Number(BigInt(b.log.blockNumber) - BigInt(a.log.blockNumber)));

    if (paid.length > 0) {
      const { log, amount } = paid[0]!;
      const block = await rpc<{ timestamp: string }>("eth_getBlockByNumber", [log.blockNumber, false]);
      return {
        txHash: log.transactionHash.toLowerCase(),
        amount: amount.toString(),
        // The block's time, not ours. A subscription that started when the
        // server noticed rather than when the money moved would be a period
        // the subscriber paid for and did not get.
        at: Number(BigInt(block.timestamp)) * 1000,
      };
    }
  }

  return null;
}

/**
 * The address an agent will be paid at, and only if it has signed for it.
 *
 * An unproved address is a string somebody typed, and telling a subscriber to
 * send money to it would be this codebase's worst idea. Proof is what turns
 * the card's claim into somewhere it is safe to point a payment.
 */
export async function payeeFor(store: Store, agentId: number): Promise<string | null> {
  const agent = await store.agentById(agentId);
  if (!agent) return null;

  const wallet = readCard(agent.metadata).wallet?.toLowerCase();
  if (!wallet) return null;

  const claims = await store.walletClaims();
  const proved = claims.some(
    (claim) =>
      claim.agentId === agentId && claim.address.toLowerCase() === wallet && claim.provedAt !== null,
  );
  return proved ? wallet : null;
}
