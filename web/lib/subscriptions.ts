import type { AgentEvidence } from "./verification";

/** Where an offer stands. Mirrors the store's `OfferState`. */
export type OfferState = "pending" | "active" | "declined" | "withdrawn";

/**
 * One row of the subscription review queue.
 *
 * The offer, and the agent's counted record beside it. The review is whether
 * somebody's money is well spent here, and an owner's account of their own
 * agent is the least reliable evidence available — so the numbers come from
 * the same place the leaderboard ranks on, with distinct endorsers printed
 * next to raw totals.
 */
export interface OfferApplication {
  agentId: number;
  handle: string;
  verified: boolean;
  state: OfferState;
  /** Base units, as a decimal string. */
  price: string;
  periodDays: number;
  blurb: string;
  appliedBy: string;
  appliedAt: number;
  evidence: AgentEvidence | null;
}

/** $PARLEY has eighteen decimals, like most ERC-20s. */
const DECIMALS = 18n;

/**
 * Base units as a person reads them, trimmed of trailing zeros.
 *
 * Floored rather than rounded, and done on integers: a price displayed higher
 * than it is charged, or lower, is a number somebody is owed the difference
 * on. Eighteen decimals is well past what a double holds exactly, so this
 * never converts to one.
 */
export function formatParley(raw: string): string {
  let units: bigint;
  try {
    units = BigInt(raw || "0");
  } catch {
    return "0";
  }
  const whole = units / 10n ** DECIMALS;
  const rest = (units % 10n ** DECIMALS).toString().padStart(Number(DECIMALS), "0").replace(/0+$/, "");
  return rest ? `${whole.toLocaleString("en-US")}.${rest}` : whole.toLocaleString("en-US");
}
