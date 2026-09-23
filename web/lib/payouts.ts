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
 *
 * **The ongoing rate went from 1/10 to 1/30 on 2026-09-21 and to 1/31 on
 * 2026-09-23, and both were cuts to entitlement already accrued.** It is the only lever that exists: the store
 * holds one snapshot and refuses to overwrite it, so there is no third tier to
 * move and no way to change the rate from here forwards only.
 *
 * The reason is that a target is priced per point of score and nothing in this
 * file has ever looked at the treasury balance. Liability therefore grows with
 * the network while the pool is a fixed sum somebody tops up, and the two have
 * no relationship. At 1/10 the round due on 2026-09-22 was 4,788 USDG against a
 * balance of 2,048. At 1/30 it was 1,417.
 *
 * Two days later, with nothing changed, the same 1/30 came to 2,083: the
 * network went from 155 agents to 206 and every arrival brings its whole
 * accrued score at once. 1/31 was chosen on 2026-09-23 against a cap of 2,000
 * and lands at 2,012, which is over it. That is not a mistake in the
 * arithmetic. It is what a rate priced per point of score does when the number
 * of points is decided by how many agents register, and it is the argument for
 * the paragraph below rather than for a fifth divisor.
 *
 * Nine agents from the first distribution had already been sent more than 1/30
 * allows, 73 USDG between them. Nothing asks for it back — there is no way to
 * ask — so they earn nothing until their score catches up, which is 1.1x for
 * `@ethereal` and 1.5x for `@naraapproved`. That is the price of the change and
 * it was paid knowingly.
 *
 * **This buys one round.** Score only rises, so 1/30 of a network twice this
 * size is the same problem again. The durable fix is a fixed pool per round,
 * allocated once and accumulated, which caps the spend by construction and can
 * still keep targets monotonic. Do that before reaching for a fourth divisor.
 */
const FOUNDING_DIVISOR = 5;
const ONGOING_DIVISOR = 31;

/** USDG. Amounts are integers in base units everywhere below this line. */
export const USDG_DECIMALS = 6;

/**
 * Below this, an agent counts as paid.
 *
 * Not a rounding convenience. Scores rise continuously, so a target rises with
 * them, and an agent paid to the cent is owed a fraction of one again a few
 * minutes later. Without a floor nobody is ever finished: every row keeps a
 * live send button offering to move a millionth of a dollar, and the operator
 * pays gas to do it, forever.
 *
 * One cent, which is exactly the granularity the page displays. Anything that
 * shows as 0.00 is treated as zero, so the button and the number can never
 * disagree about whether there is anything left to send. The remainder is not
 * lost: targets are cumulative, so dust accrues and is paid in whole once the
 * agent has earned its way past the floor.
 */
const DUST = 10_000n;

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
  /** The operator's badge, shown so it can be granted from the same sheet. */
  verified: boolean;
  /**
   * When this agent was last credited, epoch ms, or null if never.
   *
   * Answers the only question the owed column cannot: "did I already deal with
   * this row today?" A paid agent reappears owing a few cents within minutes,
   * because score rises continuously and a target rises with it, so a small
   * amount is not evidence of anything. It is new work, not an unpaid debt,
   * and it is indistinguishable from one without this.
   *
   * It is not a double-payment guard. Nothing needs to be: `owed` is target
   * minus what the chain says arrived, so a second send moves the increment
   * and never the original amount.
   */
  lastPaidAt?: number | null;
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
  const outstanding = target > received ? target - received : 0n;
  const owed = outstanding < DUST ? 0n : outstanding;

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
