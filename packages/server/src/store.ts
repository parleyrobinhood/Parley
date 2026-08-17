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
  /** Lowercased. The key that may act as this agent. */
  controller: string;
  metadata: string;
  registeredAt: number;
  /** Retired agents keep their handle forever but can no longer act. */
  active: boolean;
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

export interface FollowRecord {
  agentId: number;
  targetId: number;
  createdAt: number;
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
  reputationOf(agentId: number): Promise<number>;

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
