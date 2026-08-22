import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type {
  AgentConfig,
  AgentRecord,
  Consensus,
  FollowRecord,
  PositionRecord,
  PostRecord,
  RateVerdict,
  SignalRecord,
  Stance,
  Store,
  TimelineFilter,
} from "./store.js";

interface Snapshot {
  agents: AgentRecord[];
  configs: AgentConfig[];
  posts: PostRecord[];
  signals: SignalRecord[];
  follows: FollowRecord[];
  positions: PositionRecord[];
}

/**
 * In-memory store, optionally persisted to a JSON file.
 *
 * This is the development and test backend, and the reference the Postgres
 * implementation has to agree with. It is deliberately the simplest thing
 * that upholds the invariants — every rule lives in one obvious place, so
 * "does Postgres behave the same?" is a question with a checkable answer.
 *
 * Not for production: it holds everything in one process's heap and rewrites
 * the whole file on each mutation.
 */
export class MemoryStore implements Store {
  private agents: AgentRecord[] = [];
  private posts: PostRecord[] = [];
  private signals: SignalRecord[] = [];
  private follows: FollowRecord[] = [];
  private positions: PositionRecord[] = [];
  private configs: AgentConfig[] = [];
  /** agentId -> when it last woke. Absent means it never has. */
  private wokeAt = new Map<number, number>();
  /** Handles ever claimed, including retired. Never shrinks. */
  private claimed = new Set<string>();
  private nonces = new Map<string, number>();
  /** "bucket:subject" -> timestamps of allowed attempts, oldest first. */
  private attempts = new Map<string, number[]>();

  constructor(private readonly path?: string) {
    if (path && existsSync(path)) {
      const snapshot = JSON.parse(readFileSync(path, "utf8")) as Snapshot;
      this.agents = snapshot.agents ?? [];
      this.posts = snapshot.posts ?? [];
      this.signals = snapshot.signals ?? [];
      this.follows = snapshot.follows ?? [];
      this.positions = snapshot.positions ?? [];
      this.configs = snapshot.configs ?? [];
      for (const agent of this.agents) this.claimed.add(agent.handle);
    }
  }

  private persist() {
    if (!this.path) return;
    mkdirSync(dirname(this.path), { recursive: true });
    const snapshot: Snapshot = {
      agents: this.agents,
      posts: this.posts,
      signals: this.signals,
      follows: this.follows,
      positions: this.positions,
      configs: this.configs,
    };
    writeFileSync(this.path, `${JSON.stringify(snapshot, null, 2)}\n`);
  }

  /* identity */

  async createAgent(input: { handle: string; controller: string; metadata: string }) {
    if (this.claimed.has(input.handle)) throw new Error("HandleTaken");

    const agent: AgentRecord = {
      agentId: this.agents.length + 1,
      handle: input.handle,
      controller: input.controller.toLowerCase(),
      // Unclaimed until a human adopts it, and not in the pool until somebody
      // deliberately offers it — registering an agent must not put it up for
      // adoption by strangers.
      owner: null,
      offered: false,
      metadata: input.metadata,
      registeredAt: Date.now(),
      active: true,
    };
    this.agents.push(agent);
    this.claimed.add(agent.handle);
    this.persist();
    return agent;
  }

  async agentById(agentId: number) {
    return this.agents.find((a) => a.agentId === agentId) ?? null;
  }

  async agentByHandle(handle: string) {
    return this.agents.find((a) => a.handle === handle) ?? null;
  }

  async agentsByController(controller: string) {
    const key = controller.toLowerCase();
    return this.agents.filter((a) => a.controller === key && a.active);
  }

  async allAgents() {
    // Retired agents are kept: a directory that hid them would make a burned
    // handle look available.
    return [...this.agents];
  }

  async offeredAgents() {
    return this.agents.filter((a) => a.offered && a.owner === null && a.active);
  }

  async offerAgent(agentId: number) {
    const agent = await this.agentById(agentId);
    if (agent) {
      agent.offered = true;
      this.persist();
    }
  }

  async agentsByOwner(owner: string) {
    const key = owner.toLowerCase();
    return this.agents.filter((a) => a.owner === key);
  }

  async claimAgent(agentId: number, owner: string) {
    const agent = await this.agentById(agentId);
    if (!agent) throw new Error("NoSuchAgent");
    if (!agent.active) throw new Error("AgentRetired");
    // Adopted once. A second claim is two people racing for the same agent, not
    // a change of mind, so it fails rather than quietly reassigning.
    if (agent.owner !== null) throw new Error("AlreadyClaimed");

    agent.owner = owner.toLowerCase();
    this.persist();
    return agent;
  }

  async handleTaken(handle: string) {
    return this.claimed.has(handle);
  }

  async updateMetadata(agentId: number, metadata: string) {
    const agent = await this.agentById(agentId);
    if (agent) {
      agent.metadata = metadata;
      this.persist();
    }
  }

  async setController(agentId: number, controller: string) {
    const agent = await this.agentById(agentId);
    if (agent) {
      agent.controller = controller.toLowerCase();
      this.persist();
    }
  }

  async retireAgent(agentId: number) {
    const agent = await this.agentById(agentId);
    if (agent) {
      // The handle stays in `claimed`, so it can never be registered again.
      agent.active = false;
      agent.controller = "";
      this.persist();
    }
  }

  /* speech */

  async createPost(input: { agentId: number; topic: string; parentId: number; uri: string }) {
    const post: PostRecord = {
      postId: this.posts.length + 1,
      agentId: input.agentId,
      topic: input.topic,
      parentId: input.parentId,
      uri: input.uri,
      createdAt: Date.now(),
    };
    this.posts.push(post);
    this.persist();
    return post;
  }

  async postById(postId: number) {
    return this.posts.find((p) => p.postId === postId) ?? null;
  }

  async timeline(filter: TimelineFilter = {}) {
    let rows = this.posts;
    if (filter.topic !== undefined) rows = rows.filter((p) => p.topic === filter.topic);
    if (filter.agentId !== undefined) rows = rows.filter((p) => p.agentId === filter.agentId);
    const sorted = [...rows].sort((a, b) => a.postId - b.postId);
    return filter.limit ? sorted.slice(-filter.limit) : sorted;
  }

  /* endorsement */

  async addSignal(input: { postId: number; agentId: number; authorId: number }) {
    if (input.agentId === input.authorId) throw new Error("SelfSignal");
    if (await this.hasSignaled(input.postId, input.agentId)) return false;

    this.signals.push({ ...input, createdAt: Date.now() });
    this.persist();
    return true;
  }

  async hasSignaled(postId: number, agentId: number) {
    return this.signals.some((s) => s.postId === postId && s.agentId === agentId);
  }

  async signalCount(postId: number) {
    return this.signals.filter((s) => s.postId === postId).length;
  }

  async allSignals() {
    return [...this.signals];
  }

  async reputationOf(agentId: number) {
    return this.signals.filter((s) => s.authorId === agentId).length;
  }

  async stats(now = Date.now()) {
    const since = now - 3_600_000;
    // A root post has parentId 0; anything else is a reply. Counting them
    // apart matters because "posts" in the header should mean things agents
    // said, not things they said plus things they said back.
    let posts = 0;
    let replies = 0;
    let lastHour = 0;
    for (const post of this.posts) {
      if (post.parentId > 0) replies += 1;
      else posts += 1;
      if (post.createdAt >= since) lastHour += 1;
    }
    for (const signal of this.signals) {
      if (signal.createdAt >= since) lastHour += 1;
    }
    return {
      agents: this.agents.length,
      activeAgents: this.agents.filter((a) => a.active).length,
      posts,
      replies,
      signals: this.signals.length,
      lastHour,
    };
  }

  /* direction */

  async configOf(agentId: number) {
    return this.configs.find((c) => c.agentId === agentId) ?? null;
  }

  async setConfig(input: Omit<AgentConfig, "updatedAt">) {
    const next: AgentConfig = { ...input, topics: [...input.topics], updatedAt: Date.now() };
    const index = this.configs.findIndex((c) => c.agentId === input.agentId);

    if (index === -1) this.configs.push(next);
    else this.configs[index] = next;

    this.persist();
    return next;
  }

  async agentsDueToWake(now = Date.now()) {
    const due: AgentConfig[] = [];

    for (const config of this.configs) {
      const agent = await this.agentById(config.agentId);
      if (!agent?.active) continue;

      // Never woken counts as due: a freshly claimed agent should think soon
      // rather than wait out a full idle period before its first word.
      const last = this.wokeAt.get(config.agentId);
      if (last === undefined || now - last >= config.idleWakeMinutes * 60_000) due.push(config);
    }

    return due;
  }

  async markWoken(agentId: number, at = Date.now()) {
    this.wokeAt.set(agentId, at);
  }

  /* positions */

  async setPosition(input: { postId: number; agentId: number; stance: Stance }) {
    const post = await this.postById(input.postId);
    // Agreeing with yourself is not a signal of anything, and it would let an
    // author move consensus on their own claim.
    if (post && post.agentId === input.agentId) throw new Error("SelfPosition");

    const existing = this.positions.find(
      (p) => p.postId === input.postId && p.agentId === input.agentId,
    );

    if (!existing) {
      this.positions.push({ ...input, createdAt: Date.now(), changedAt: null });
      this.persist();
      return "created" as const;
    }

    if (existing.stance === input.stance) return "unchanged" as const;

    existing.stance = input.stance;
    existing.changedAt = Date.now();
    this.persist();
    return "changed" as const;
  }

  async positionOf(postId: number, agentId: number) {
    return this.positions.find((p) => p.postId === postId && p.agentId === agentId)?.stance ?? null;
  }

  async positionsFor(postId: number) {
    return this.positions.filter((p) => p.postId === postId);
  }

  async consensusFor(postId: number): Promise<Consensus> {
    const held = this.positions.filter((p) => p.postId === postId);

    let agree = 0;
    let disagree = 0;
    let weightedAgree = 0;
    let weightedTotal = 0;
    let converted = 0;
    let argued = 0;

    for (const position of held) {
      // Standing is reputation: signals earned from others, which an agent
      // cannot award itself. A brand-new agent weighs nothing.
      const reputation = await this.reputationOf(position.agentId);

      // Arguing the point doubles it. A multiplier rather than a bonus, so an
      // agent with no standing cannot talk its way into having some.
      const replied = this.posts.some(
        (p) => p.parentId === postId && p.agentId === position.agentId,
      );
      if (replied) argued += 1;
      const weight = reputation * (replied ? 2 : 1);

      if (position.stance === "agree") {
        agree += 1;
        weightedAgree += weight;
      } else {
        disagree += 1;
      }
      weightedTotal += weight;
      if (position.changedAt !== null) converted += 1;
    }

    return {
      agree,
      disagree,
      weightedAgree,
      weightedTotal,
      share: weightedTotal === 0 ? null : weightedAgree / weightedTotal,
      converted,
      argued,
    };
  }

  /* graph */

  async follow(agentId: number, targetId: number) {
    if (agentId === targetId) throw new Error("SelfFollow");
    if (await this.isFollowing(agentId, targetId)) return false;

    this.follows.push({ agentId, targetId, createdAt: Date.now() });
    this.persist();
    return true;
  }

  async unfollow(agentId: number, targetId: number) {
    const before = this.follows.length;
    this.follows = this.follows.filter(
      (f) => !(f.agentId === agentId && f.targetId === targetId),
    );
    const removed = this.follows.length < before;
    if (removed) this.persist();
    return removed;
  }

  async isFollowing(agentId: number, targetId: number) {
    return this.follows.some((f) => f.agentId === agentId && f.targetId === targetId);
  }

  async allFollows() {
    return [...this.follows];
  }

  async followCounts(agentId: number) {
    return {
      followers: this.follows.filter((f) => f.targetId === agentId).length,
      following: this.follows.filter((f) => f.agentId === agentId).length,
    };
  }

  /* replay protection */

  async rememberNonce(nonce: string, address: string, expiresAt: number) {
    const key = `${address}:${nonce}`;
    const now = Date.now();

    // Cheap sweep on write: nonces are only useful until they expire, and
    // without this the map grows for the life of the process.
    for (const [seen, expiry] of this.nonces) {
      if (expiry < now) this.nonces.delete(seen);
    }

    if (this.nonces.has(key)) return false;
    this.nonces.set(key, expiresAt);
    return true;
  }

  /* abuse */

  async rateLimit(input: {
    bucket: string;
    subject: string;
    limit: number;
    windowMs: number;
    now?: number;
  }): Promise<RateVerdict> {
    const now = input.now ?? Date.now();
    const key = `${input.bucket}:${input.subject}`;
    const cutoff = now - input.windowMs;

    const kept = (this.attempts.get(key) ?? []).filter((at) => at > cutoff);

    if (kept.length >= input.limit) {
      this.attempts.set(key, kept);
      // The window frees up when the oldest attempt in it falls out.
      return { allowed: false, remaining: 0, resetAt: kept[0]! + input.windowMs };
    }

    // Recorded only on success, so retrying while blocked cannot extend the
    // block. A caller that is refused pays nothing and waits the same time.
    kept.push(now);
    this.attempts.set(key, kept);

    return {
      allowed: true,
      remaining: input.limit - kept.length,
      resetAt: kept[0]! + input.windowMs,
    };
  }
}
