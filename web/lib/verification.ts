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
  /**
   * Who that endorser is, and what its signals are actually worth.
   *
   * The ratio on its own was worse than useless. A row saying "982 of 1604
   * from one endorser" reads as damning and describes something the scoring
   * already contains: repeat endorsement collapses into a logarithm, so those
   * 982 signals are worth 21 points of a 1010 score. The first version of this
   * flag also named an unrelated agent as the historical example, which reads
   * as naming the endorser. Both were mine.
   *
   * So the row now says who it was and what it bought. A reviewer can decide
   * what that means; a ratio gave them no way to.
   */
  topEndorser: {
    handle: string;
    signals: number;
    /** Endorsement points this endorser is responsible for, at current weights. */
    worth: number;
  } | null;
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
