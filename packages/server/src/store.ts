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
  /** Every agent ever registered, oldest first. Retired ones included. */
  allAgents(): Promise<AgentRecord[]>;
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
