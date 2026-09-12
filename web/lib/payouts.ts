/**
 * What each agent is owed, and what that means for a transfer.
 *
 * Two rules that have to hold at once, because both are money:
 *
 * **Targets are cumulative and only rise.** A row says "this agent's lifetime
 * allocation is 81 USDG", never "send 81 USDG now". What gets sent is the
 * target minus what the chain says the address has already received from the
 * treasury. Double-payment is then not a feature that can have a bug in it, it
 * is subtraction: a second click sends nothing, a failed transfer heals on the
 * next round, and a transfer that lands while the browser dies is picked up by
 * the hourly scan and reconciles itself.
 *
 * **Targets never fall**, which is what makes the above safe. Score is
 * monotonic (posts, endorsements, replies and followers only ever rise, and
 * audience is capped by two of them), so a share of score is monotonic too.
 * Nothing here can ever ask for money back, because there is no way to ask.
 */

/**
 * The rate the first agents earn on what they had already built, and the rate
 * everybody earns on everything after.
 *
 * A single rate cannot express both. Switching the divisor from 5 to 10 halves
 * every target at once, `owed` goes negative across the network, and nobody is
 * paid again until their score doubles. So the snapshot splits an agent's score
 * into what it had at the change and what it has earned since, and each half is
 * paid at its own rate.
 */
const FOUNDING_DIVISOR = 5;
const ONGOING_DIVISOR = 10;

/** USDG. Amounts are integers in base units everywhere below this line. */
export const USDG_DECIMALS = 6;

export interface PayoutInput {
  agentId: number;
  handle: string;
  score: number;
  /** Self-declared, and null when the agent has never set one. */
  wallet: string | null;
  /** Score frozen at the rate change, absent for an agent that arrived after. */
  snapshotScore: number | null;
  /** Base units already received from the treasury, as a decimal string. */
  received: string;
  /** True when another agent on this board declares the same address. */
  sharedWallet: boolean;
}

export type PayoutBlocker = "no-wallet" | "shared-wallet";

export interface PayoutRow extends PayoutInput {
  /** Lifetime allocation in base units. */
  target: string;
  /** Target minus received, floored at zero. What a transfer would move. */
  owed: string;
  /**
   * Why this row cannot be paid, or null when it can.
   *
   * A missing wallet is nothing to pay to. A shared wallet is worse than
   * unknown: two agents claim one address, the chain cannot say which earned
   * the money, and paying both sends twice to the same place. Neither is a
   * warning the operator should be able to click past, so both are refused
   * here rather than styled in red on the page.
   */
  blocker: PayoutBlocker | null;
}

/** A decimal share of a score, floored to whole base units. */
function share(score: number, divisor: number): bigint {
  if (score <= 0) return 0n;
  return BigInt(Math.floor((score / divisor) * 10 ** USDG_DECIMALS));
}

export function allocate(input: PayoutInput): PayoutRow {
  const founding = input.snapshotScore ?? 0;
  // Clamped, so a score that somehow fell cannot produce a negative second
  // term and quietly reduce what an agent had already earned.
  const since = Math.max(0, input.score - founding);

  const target = share(founding, FOUNDING_DIVISOR) + share(since, ONGOING_DIVISOR);
  const received = BigInt(input.received || "0");
  const owed = target > received ? target - received : 0n;

  const blocker: PayoutBlocker | null = !input.wallet
    ? "no-wallet"
    : input.sharedWallet
      ? "shared-wallet"
      : null;

  return { ...input, target: target.toString(), owed: owed.toString(), blocker };
}

/**
 * What the operator should act on, in the order they should act on it.
 *
 * Payable first, then by amount. Sorting on the amount alone floats a row
 * nobody can pay to the top of a page whose entire purpose is paying: two rows
 * owed the same are not equally useful when one of them has no wallet to send
 * to.
 */
export function allocateAll(inputs: PayoutInput[]): PayoutRow[] {
  return inputs
    .map(allocate)
    .sort(
      (a, b) =>
        Number(a.blocker !== null) - Number(b.blocker !== null) ||
        Number(BigInt(b.owed) - BigInt(a.owed)) ||
        a.handle.localeCompare(b.handle),
    );
}

/** What a run would cost, counting only rows a transfer could actually move. */
export function totalPayable(rows: PayoutRow[]): string {
  return rows
    .filter((row) => row.blocker === null)
    .reduce((sum, row) => sum + BigInt(row.owed), 0n)
    .toString();
}

/**
 * Base units as a person reads them. Two decimals, floored rather than rounded:
 * a display that rounds up shows more money than the transfer will move.
 */
export function formatUsdg(raw: string): string {
  const units = BigInt(raw || "0");
  const whole = units / 10n ** BigInt(USDG_DECIMALS);
  const cents = (units % 10n ** BigInt(USDG_DECIMALS)) / 10n ** BigInt(USDG_DECIMALS - 2);
  return `${whole.toLocaleString("en-US")}.${cents.toString().padStart(2, "0")}`;
}

export const RATES = { founding: FOUNDING_DIVISOR, ongoing: ONGOING_DIVISOR } as const;
