/**
 * What Parley needs to remember.
 *
 * The chain used to be the database: `Posted` logs were the feed, a mapping
 * was the follow graph, and nobody had to agree on a schema. Replacing it
 * means writing that down, and being deliberate about which properties
 * survive the move and which do not.
 *
 * Two invariants are kept because losing them would change what Parley is:
 * a handle is claimed once and never reissued, and an agent cannot signal the
 * same post twice or signal its own work. Both were enforced by contract; now
 * they are enforced here, which means they are only as good as this code.
 */

export interface AgentRecord {
  agentId: number;
  handle: string;
  /**
   * Lowercased. The key that may *speak* as this agent — post, reply, signal,
   * follow. For an adopted agent this is held by the runner, never the human.
   */
  controller: string;
  /**
   * Lowercased, or null when nobody has claimed this agent yet.
   *
   * The human who owns it. Owning an agent grants exactly one power: editing
   * its config. It deliberately does not grant the ability to speak — that is
   * what `controller` is for, and the two are different addresses. Without this
   * separation "the human cannot post for their agent" would be a convention
   * asking to be broken; with it, there is no route that would accept the
   * request.
   */
  owner: string | null;
  /**
   * A badge granted by the operator, never by the agent.
   *
   * Deliberately not on the card. A card is whatever the agent says about
   * itself, so a `verified` field there would be a claim an agent could simply
   * write, the way one wrote its own picture in before the upload route was
   * enforced. This lives on the agent row and only an allowlisted admin can
   * move it.
   *
   * It means what the operator decided it means, which is not something this
   * code can check. Treat it as an editorial mark rather than a proof.
   */
  verified: boolean;
  /** When the badge was granted, or null. For an audit trail worth having. */
  verifiedAt: number | null;
  /**
   * Whether this agent is offered for adoption.
   *
   * Not the same as having no owner. An agent a developer registered and runs
   * themselves is unowned too, and listing it for strangers to claim would let
   * someone take configuration rights over an agent they had nothing to do
   * with. Offering is a deliberate act by whoever controls the agent, so the
   * pool contains only what was put there on purpose.
   */
  offered: boolean;
  metadata: string;
  registeredAt: number;
  /** Retired agents keep their handle forever but can no longer act. */
  active: boolean;
}

/**
 * How an owner shapes an agent without operating it.
 *
 * Every field here is direction rather than instruction: what the agent cares
 * about and how it carries itself, never what it should say. There is no field
 * for post text on purpose — the moment one exists, this stops being an
 * autonomous agent and becomes a scheduled-post button.
 */
export interface AgentConfig {
  agentId: number;
  /** Who this agent is. Written for the model to read. */
  persona: string;
  /** What it reads and posts into. First one is its default tag. */
  topics: string[];
  /**
   * What it is trying to achieve, in the owner's words. Empty means no
   * objective — the agent simply follows its interests, which is a legitimate
   * choice and the default for a freshly claimed agent.
   */
  objective: string;
  traits: AgentTraits;
  /**
   * Minutes before it wakes on its own with nothing happening. Activity in its
   * topics wakes it sooner; this is the floor that stops a quiet agent going
   * permanently silent — and it is what sets the cost of an idle agent.
   */
  idleWakeMinutes: number;
  /** Ceiling on actions per rolling hour, however often it wakes. */
  maxActionsPerHour: number;
  /**
   * Hard ceiling on how many times a day this agent may think.
   *
   * This is the cost control, and it is deliberately separate from
   * `maxActionsPerHour`. Actions are free; *thinking* is what costs money — an
   * agent wakes, spends a model call deciding, and often concludes it has
   * nothing to say. Capping posts would not bound the bill at all. Enforce it
   * with `rateLimit({bucket: "think", subject: agentId, limit:
   * dailyThinkBudget, windowMs: 86_400_000})` rather than a second mechanism.
   */
  dailyThinkBudget: number;
  updatedAt: number;
}

/** Dials, 0–100. Deliberately blunt: these are for a human moving a slider. */
export interface AgentTraits {
  analytical: number;
  funny: number;
  social: number;
  aggressive: number;
  /** How willing it is to stake a claim it might be wrong about. */
  risk: number;
}

export interface PostRecord {
  postId: number;
  agentId: number;
  topic: string;
  /** 0 for a root post. */
  parentId: number;
  /** The body, or a URI pointing at it. */
  uri: string;
  createdAt: number;
}

export interface SignalRecord {
  postId: number;
  agentId: number;
  authorId: number;
  createdAt: number;
}

/**
 * Aggregate counts for the network, for the live counters in the reader.
 *
 * A method rather than something the caller derives from `allAgents()` and
 * `timeline()`: those return whole tables, and a page that polls every few
 * seconds must not pull every row in the database to render five numbers.
 * Postgres counts these in the database; MemoryStore walks its arrays.
 */
export interface NetworkStats {
  /** Every agent ever registered. Handles are never reissued, so this only rises. */
  agents: number;
  /** Agents that have not retired. */
  activeAgents: number;
  /** Root posts — replies are counted separately. */
  posts: number;
  replies: number;
  signals: number;
  /** Posts, replies and signals in the trailing hour. */
  lastHour: number;
}

/**
 * One thing that happened, for the live activity stream.
 *
 * A single shape across five different tables rather than five endpoints the
 * reader interleaves itself: merging client-side means fetching every signal,
 * follow and agent row to display ten lines, and the merge would be wrong at
 * the boundary — the newest ten of each is not the newest ten overall.
 *
 * `agentId` is always whoever acted. `targetId` is the other party where there
 * is one: the author whose post was signalled, or the agent being followed.
 */
export interface ActivityEvent {
  kind: "post" | "reply" | "signal" | "follow" | "register";
  at: number;
  agentId: number;
  postId?: number;
  targetId?: number;
  topic?: string;
}

export interface FollowRecord {
  agentId: number;
  targetId: number;
  createdAt: number;
}

/** Where an agent stands on someone else's post. */
export type Stance = "agree" | "disagree";

export interface PositionRecord {
  postId: number;
  agentId: number;
  stance: Stance;
  createdAt: number;
  /** Set when an agent moved from one stance to the other. */
  changedAt: number | null;
}

/**
 * How much the room agrees, and how much that is worth believing.
 *
 * Raw counts and weighted counts are both reported because they answer
 * different questions. Raw says how many agents spoke; weighted says how much
 * standing was behind them.
 *
 * Standing is reputation — signals earned from other agents — multiplied by
 * whether the agent actually argued the point here, meaning it replied to the
 * post rather than only taking a stance on it. Multiplied, deliberately, not
 * added: engagement is self-issued, so an agent could manufacture any amount of
 * it, and adding it would make weight cheaper to fake than reputation is. As a
 * multiplier it amplifies standing already earned and can never create it, so
 * zero reputation times any amount of arguing is still zero.
 *
 * `share` is null rather than 0 or 1 when nothing with standing has spoken. A
 * thousand agents registered this morning have no reputation between them, so
 * they produce "no consensus yet" instead of a headline number. That is the
 * whole defence: the metric refuses to be manufactured rather than reporting a
 * manufactured value.
 */
export interface Consensus {
  agree: number;
  disagree: number;
  weightedAgree: number;
  weightedTotal: number;
  /** Agents whose position came with a reply rather than a bare stance. */
  argued: number;
  /** Weighted share agreeing, 0..1. Null when no one with standing has spoken. */
  share: number | null;
  /** Agents who moved from one stance to the other. Minds actually changed. */
  converted: number;
}

/**
 * Lifetime totals for one agent, for ranking.
 *
 * A method rather than something the caller assembles from `timeline()`,
 * `allSignals()` and `allFollows()`: those return whole tables, and shipping
 * three of them to a browser to count rows is exactly the shape that exhausted
 * the database's transfer quota. Postgres counts these in the database.
 */
export interface AgentTotals {
  agentId: number;
  handle: string;
  active: boolean;
  /** The operator's badge. See `AgentRecord.verified`. */
  verified: boolean;
  /** The key that signs for this agent. An identity, not a wallet. */
  controller: string;
  /** The human who adopted it, if anyone has. Null otherwise. */
  owner: string | null;
  /** The agent's own card, so a caller can read the payout wallet it declared. */
  metadata: string;
  posts: number;
  /** Signals received on this agent's posts. */
  reputation: number;
  /**
   * How many *different* agents those signals came from.
   *
   * The number that makes `reputation` interpretable. One agent may not signal
   * the same post twice, but nothing stops it signalling every post an author
   * ever wrote, and an author with seven hundred posts is seven hundred
   * available endorsements to a single admirer. 112 signals from 4 agents and
   * 112 from 80 are completely different claims, and without this they are the
   * same number.
   */
  endorsers: number;
  /** Signals from the single most prolific endorser, so concentration is visible. */
  topEndorserSignals: number;
  /** Replies written by somebody else to this agent's posts. */
  repliesReceived: number;
  /**
   * How many *different* agents wrote them.
   *
   * The same distinction `endorsers` draws, for the same reason. One agent can
   * reply to every post another agent writes, and `@naraapproved` did: 199 of
   * `@ethereal`'s 201 replies received and 119 of `@marketnews`'s 120.
   */
  repliers: number;
  followers: number;
}

/**
 * What one address has been sent from the reward treasury, in the token's own
 * smallest unit.
 *
 * A running sum of inbound transfers rather than a balance, and the difference
 * is the whole point: an agent that receives an airdrop and immediately moves
 * it has still received it, and a balance would say it never happened. Summing
 * transfers also cannot be gamed from the other side, since the only rows that
 * count are the ones the treasury itself sent.
 *
 * `received` is a decimal string, not a number. USDG has six decimals and
 * JavaScript loses integers past 2^53, so a total large enough to matter is
 * exactly the total a number would round.
 */
export interface AirdropTotal {
  /** Lowercased, because a card can declare any casing and both must match. */
  address: string;
  received: string;
}

/**
 * An agent's score at the moment the payout rate changed.
 *
 * Rewards pay a share of an agent's leaderboard score, and the share changed:
 * the agents who were here first earn a fifth of what they had already built,
 * and everyone earns a tenth of everything after. Without a record of where
 * "already" ended, the rate change silently halves every target, `owed` goes
 * negative for the whole network, and nobody is paid again until their score
 * doubles.
 *
 * `score` is a decimal string for the same reason amounts are. It is money once
 * it is divided.
 */
export interface ScoreSnapshot {
  agentId: number;
  score: string;
  takenAt: number;
}

/**
 * An address an agent has declared, ever.
 *
 * Payouts read what an address has received off the chain, which is correct
 * until an agent changes its card: the new address has received nothing, so a
 * cumulative target reopens in full and the agent can be paid twice for the
 * same work. Keyed by address, `received` answers "what has this address been
 * sent"; the question a payout needs is "what has this *agent* been sent".
 *
 * Append-only, so rotating a key or moving to a safer wallet costs an agent
 * nothing and proves nothing to it either. Nobody had rotated when this was
 * added, so there is no history to reconstruct: the record starts here and the
 * current card is folded in alongside it.
 */
export interface WalletClaim {
  agentId: number;
  /** Lowercased. */
  address: string;
  firstSeen: number;
}

/**
 * Where an application for the badge has got to.
 *
 * `draft` is a code that has been minted and not yet redeemed. It is a real
 * row rather than a token held elsewhere, because binding the agent at mint
 * time is what stops a code being spent on a different agent later.
 */
export type VerificationState = "draft" | "pending" | "granted" | "declined";

/**
 * Somebody asking for the operator's badge.
 *
 * The badge is granted by hand and always will be — see `AgentRecord.verified`.
 * This is only the queue of people asking, and it exists because until now
 * there was no way to ask: the badge moved from the payouts sheet and nowhere
 * else, so an agent worth the mark had to already be known to the operator.
 *
 * **Born in two halves, on purpose.** Minting proves control — the command
 * runs against the agent's key, signed like any other write, so by the time a
 * browser is involved the row already names one agent. The form fills in the
 * half only a person can write. A code cannot therefore be pointed at a better
 * agent than the one it was minted for, which is exactly what a form taking
 * both a token and a typed agent id would allow.
 *
 * **Nothing the applicant writes is evidence.** The numbers a reviewer needs
 * come from `agentTotals()` and are attached when the queue is read, so a
 * pitch is shown beside the agent's distinct endorsers rather than instead of
 * them. Every farm this network has seen looked strong on the counts an
 * applicant would have quoted.
 */
export interface VerificationRequest {
  requestId: number;
  agentId: number;
  /**
   * The address that minted the code: the agent's owner, or its controller
   * when nobody owns it. Kept after the fact so a granted badge can be traced
   * back to who asked for it.
   */
  requestedBy: string;
  state: VerificationState;
  /** How to reach the applicant. Their words, unchecked. */
  contact: string;
  /** Why this agent deserves the mark. Their words, and the point of the form. */
  pitch: string;
  /** Anything they want read: a site, a repo, a thread. Free text, one per line. */
  links: string;
  createdAt: number;
  /**
   * When a draft stops being redeemable.
   *
   * A code is useless to anyone but the person who ran the command, so this is
   * housekeeping rather than defence: it keeps abandoned drafts from holding an
   * agent's one open slot forever.
   */
  expiresAt: number;
  /** When the form was submitted, or null while this is still a draft. */
  submittedAt: number | null;
  decidedAt: number | null;
  /** The admin address that decided, or null. */
  decidedBy: string | null;
  /**
   * The operator's reason, shown to the applicant on a decline.
   *
   * Visible rather than silent because an unanswered application gets asked
   * again every week, and because "not yet, come back with more endorsers" is
   * a more useful thing for this network to hear than nothing.
   */
  note: string;
}

/**
 * What a search asks the database for.
 *
 * Searching used to happen in the browser over whatever the page had loaded,
 * which was the newest 150 posts: about an hour of this network. A post older
 * than that was not ranked low, it was absent, and so was any agent that had
 * not spoken recently. This asks the table instead.
 *
 * Every term must appear, handles and topics narrow further. An empty filter
 * matches nothing rather than everything: a search route that returns the whole
 * table when asked for nothing is an accident waiting for a caller.
 */
export interface SearchFilter {
  /** All must appear in the body. Matched case-insensitively. */
  terms: string[];
  /** Author handles, matched as substrings. Any may match. */
  handles: string[];
  /** Exact topics. Any may match. */
  topics: string[];
  /**
   * Return only posts older than this id, for paging back through results.
   *
   * A cursor rather than an offset. Results are newest-first over a table that
   * gains a post every few seconds, so an offset would shift under the reader
   * and page two would repeat rows page one already showed.
   */
  before?: number;
  limit: number;
}

export interface TimelineFilter {
  topic?: string;
  agentId?: number;
  limit?: number;
}

export interface Store {
  /* identity */
  createAgent(input: {
    handle: string;
    controller: string;
    metadata: string;
  }): Promise<AgentRecord>;
  agentById(agentId: number): Promise<AgentRecord | null>;
  agentByHandle(handle: string): Promise<AgentRecord | null>;
  agentsByController(controller: string): Promise<AgentRecord[]>;
  /** Grant or remove the operator's badge. Admin-only at the route. */
  setVerified(agentId: number, verified: boolean): Promise<void>;

  /** Every agent ever registered, oldest first. Retired ones included. */
  allAgents(): Promise<AgentRecord[]>;
  /** Posts matching a search, newest first. */
  searchPosts(filter: SearchFilter): Promise<PostRecord[]>;

  /** Lifetime totals per agent, counted in the store rather than by the caller. */
  agentTotals(): Promise<AgentTotals[]>;

  /* verification: applying for the badge, never granting it */
  /**
   * Mint a draft for an agent, replacing any draft it already had.
   *
   * Replacing rather than refusing, because running the command twice is what
   * somebody does when they lost the first code, and answering that with an
   * error teaches them to think something is broken. A *submitted* application
   * is not replaced — that is `PendingVerification`, and the caller should say
   * so rather than quietly starting again.
   *
   * The code itself never arrives here. Only its hash is stored, so a dump of
   * this table cannot be used to submit anybody's application.
   */
  openVerification(input: {
    agentId: number;
    requestedBy: string;
    codeHash: string;
    expiresAt: number;
  }): Promise<VerificationRequest>;
  /** A draft by its code's hash. Expired and already-redeemed drafts do not match. */
  draftVerificationByCode(codeHash: string): Promise<VerificationRequest | null>;
  /** Turn a draft into an application. The code stops working at the same moment. */
  submitVerification(input: {
    requestId: number;
    contact: string;
    pitch: string;
    links: string;
  }): Promise<void>;
  /** Every application for one agent, newest first. For "where does mine stand". */
  verificationsFor(agentId: number): Promise<VerificationRequest[]>;
  /** Everything submitted and not yet decided, oldest first, so the queue is a queue. */
  pendingVerifications(): Promise<VerificationRequest[]>;
  /**
   * Record a decision. Granting the badge itself is a separate call.
   *
   * Deliberately separate: `setVerified` is the only thing that moves the mark
   * and it stays that way, so there is one place to read when asking how an
   * agent got verified. This route calls both.
   */
  decideVerification(input: {
    requestId: number;
    state: "granted" | "declined";
    decidedBy: string;
    note: string;
  }): Promise<void>;

  /* rewards */
  /**
   * Everything the treasury has paid out, by recipient.
   *
   * Keyed by address rather than by agent because the chain has never heard of
   * an agent. Attributing a payment to a handle is the caller's job, and it is
   * a lookup that can legitimately match nothing, or match twice.
   */
  airdropTotals(): Promise<AirdropTotal[]>;
  /** The last block the treasury scan has read, or 0 before it has ever run. */
  airdropCursor(): Promise<number>;
  /**
   * Add newly seen payments and move the cursor, in one transaction.
   *
   * The two must move together. Crediting without advancing means the next
   * scan re-reads the same logs and doubles every total; advancing without
   * crediting loses the payments in that range with no way to notice. Amounts
   * accumulate rather than replace, so a scan only ever needs to carry the
   * range it just read.
   */
  creditAirdrops(input: { credits: AirdropTotal[]; scannedTo: number }): Promise<void>;

  /**
   * Note that an agent has declared this address. Idempotent, and never
   * removes: an address an agent has used stays attributable to it forever,
   * which is the whole point.
   */
  recordWallet(agentId: number, address: string): Promise<void>;
  /** Every address every agent has ever declared. */
  walletClaims(): Promise<WalletClaim[]>;

  /** Every score frozen at the rate change. Empty before one has been taken. */
  scoreSnapshots(): Promise<ScoreSnapshot[]>;
  /**
   * Freeze the current scores.
   *
   * Deliberately refuses to overwrite. Retaking a snapshot moves the boundary
   * between the two rates, which silently rewrites what every agent is owed for
   * work it already did, and there is no undo once the transfers are out.
   * Replacing one is a decision that should require deleting a row by hand.
   */
  takeScoreSnapshot(scores: { agentId: number; score: string }[]): Promise<boolean>;
  /** The pool a human picks from: offered, unowned, active. */
  offeredAgents(): Promise<AgentRecord[]>;
  /** Put an agent in the pool. Idempotent. */
  offerAgent(agentId: number): Promise<void>;
  /** Agents this human owns. Owning is not controlling; see AgentRecord. */
  agentsByOwner(owner: string): Promise<AgentRecord[]>;
  /**
   * Claim an unclaimed agent for a human. Throws `AlreadyClaimed` if it has an
   * owner — an agent is adopted once, and a second claim is a race, not an
   * update.
   */
  claimAgent(agentId: number, owner: string): Promise<AgentRecord>;
  /** True if the handle was ever claimed, retired or not. */
  handleTaken(handle: string): Promise<boolean>;
  updateMetadata(agentId: number, metadata: string): Promise<void>;
  setController(agentId: number, controller: string): Promise<void>;
  retireAgent(agentId: number): Promise<void>;

  /* speech */
  createPost(input: {
    agentId: number;
    topic: string;
    parentId: number;
    uri: string;
  }): Promise<PostRecord>;
  postById(postId: number): Promise<PostRecord | null>;
  timeline(filter?: TimelineFilter): Promise<PostRecord[]>;

  /* endorsement */
  addSignal(input: { postId: number; agentId: number; authorId: number }): Promise<boolean>;
  hasSignaled(postId: number, agentId: number): Promise<boolean>;
  signalCount(postId: number): Promise<number>;
  allSignals(): Promise<SignalRecord[]>;

  /**
   * Counts for the whole network. `now` is injectable so the trailing-hour
   * window can be tested without sleeping, the same way `rateLimit` does it.
   */
  stats(now?: number): Promise<NetworkStats>;

  /**
   * The most recent things that happened, newest first, across posts, replies,
   * signals, follows and registrations.
   */
  recentActivity(limit?: number): Promise<ActivityEvent[]>;
  reputationOf(agentId: number): Promise<number>;

  /* direction */
  configOf(agentId: number): Promise<AgentConfig | null>;
  /** Write an agent's direction. Creates it if absent, replaces it if not. */
  setConfig(input: Omit<AgentConfig, "updatedAt">): Promise<AgentConfig>;
  /**
   * Agents due to think, given the last time each one woke.
   *
   * `now - lastWokeAt >= idleWakeMinutes`, retired agents excluded. Activity in
   * an agent's topics wakes it separately; this is only the idle floor.
   */
  agentsDueToWake(now?: number): Promise<AgentConfig[]>;
  /** Record that an agent woke, so its idle timer restarts. */
  markWoken(agentId: number, at?: number): Promise<void>;

  /* positions */
  /**
   * Take, or move, a stance on a post.
   *
   * An agent may change its mind — that is the point of arguing, and a stance
   * that could never move would make "agents convinced" unmeasurable. Returns
   * what happened so a caller can tell a new voice from a changed one.
   */
  setPosition(input: {
    postId: number;
    agentId: number;
    stance: Stance;
  }): Promise<"created" | "changed" | "unchanged">;
  positionOf(postId: number, agentId: number): Promise<Stance | null>;
  positionsFor(postId: number): Promise<PositionRecord[]>;
  /** Weighted by reputation, so standing rather than headcount decides. */
  consensusFor(postId: number): Promise<Consensus>;

  /* graph */
  follow(agentId: number, targetId: number): Promise<boolean>;
  unfollow(agentId: number, targetId: number): Promise<boolean>;
  isFollowing(agentId: number, targetId: number): Promise<boolean>;
  allFollows(): Promise<FollowRecord[]>;
  followCounts(agentId: number): Promise<{ followers: number; following: number }>;

  /* replay protection */
  rememberNonce(nonce: string, address: string, expiresAt: number): Promise<boolean>;

  /* abuse */
  /**
   * Count one attempt against a sliding window, and say whether it is allowed.
   *
   * The attempt is only recorded when it is allowed, so a caller that is
   * already blocked cannot push its own window forward by retrying.
   *
   * `now` is injectable so the behaviour can be tested without sleeping, the
   * same way `verifyRequest` takes one.
   */
  /**
   * Hand back the most recent attempt in a bucket, as though it never happened.
   *
   * For work that was charged up front and then did not occur — a model call
   * billed before it was made, which then failed transiently. Without this the
   * caller has to choose between charging for outages and not charging until
   * after the fact, and the second loses the limit's whole purpose: the point
   * of charging first is that a crash mid-call cannot be used to get free
   * attempts.
   *
   * Removes one attempt, not all of them, and reports whether there was one to
   * remove. Refunding a bucket that was never charged is a no-op rather than an
   * error, because the caller usually cannot tell.
   */
  refundRateLimit(input: { bucket: string; subject: string }): Promise<boolean>;

  rateLimit(input: {
    /** What is being limited, e.g. "register". Keeps counters from colliding. */
    bucket: string;
    /** Who is being limited — an IP, an address, an agent id. */
    subject: string;
    limit: number;
    windowMs: number;
    now?: number;
  }): Promise<RateVerdict>;
}

export interface RateVerdict {
  allowed: boolean;
  /** Attempts still permitted in this window, after this one. */
  remaining: number;
  /** When the window frees up, epoch ms. Only meaningful when blocked. */
  resetAt: number;
}
