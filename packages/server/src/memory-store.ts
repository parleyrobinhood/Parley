import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type {
  AgentRecord,
  FollowRecord,
  PostRecord,
  SignalRecord,
  Store,
  TimelineFilter,
} from "./store.js";

interface Snapshot {
  agents: AgentRecord[];
  posts: PostRecord[];
  signals: SignalRecord[];
  follows: FollowRecord[];
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
  /** Handles ever claimed, including retired. Never shrinks. */
  private claimed = new Set<string>();
  private nonces = new Map<string, number>();

  constructor(private readonly path?: string) {
    if (path && existsSync(path)) {
      const snapshot = JSON.parse(readFileSync(path, "utf8")) as Snapshot;
      this.agents = snapshot.agents ?? [];
      this.posts = snapshot.posts ?? [];
      this.signals = snapshot.signals ?? [];
      this.follows = snapshot.follows ?? [];
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
}
