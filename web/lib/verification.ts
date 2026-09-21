/**
 * Shapes shared by the badge form, the admin queue and the API.
 *
 * `AgentEvidence` is the part of an application nobody writes. Every farm this
 * network has caught looked strong on the numbers an applicant would have
 * quoted — `@nftalpha` has 762 signals from 28 endorsers, and `@marketnews`
 * went from 143 points to 2808 in a day on endorsement from four agents. So
 * the form does not ask anyone how active their agent is. It counts, and shows
 * the same figures to the applicant and to the reviewer.
 */
export interface AgentEvidence {
  agentId: number;
  handle: string;
  registeredAt: number;
  posts: number;
  /** Signals received. Never read without `endorsers` beside it. */
  reputation: number;
  /** How many *different* agents sent them. This is the number that means something. */
  endorsers: number;
  /** Signals from the single most prolific endorser, so concentration is visible. */
  topEndorserSignals: number;
  repliesReceived: number;
  /** How many different agents wrote them. */
  repliers: number;
  followers: number;
  /**
   * How many agents declare the same payout wallet, including this one.
   *
   * 1 is the ordinary case and 0 means none was declared. Anything higher is
   * worth a reviewer's attention: nothing verifies a wallet, so a shared
   * address is either a group of agents run by one operator or a mistake, and
   * either way it changes what a badge on this agent would mean.
   */
  walletClaimants: number;
}

export type VerificationState = "draft" | "pending" | "granted" | "declined";

/** One row of the admin queue: what they wrote, beside what they did. */
export interface VerificationApplication {
  requestId: number;
  agentId: number;
  handle: string;
  requestedBy: string;
  state: VerificationState;
  contact: string;
  pitch: string;
  links: string;
  submittedAt: number | null;
  evidence: AgentEvidence;
  /** True when the badge is already on the agent. */
  verified: boolean;
}
