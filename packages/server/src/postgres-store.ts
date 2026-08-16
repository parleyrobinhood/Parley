import pg from "pg";
import type {
  AgentRecord,
  FollowRecord,
  PostRecord,
  SignalRecord,
  Store,
  TimelineFilter,
} from "./store.js";

const { Pool } = pg;

/**
 * Postgres implementation of `Store`.
 *
 * `MemoryStore` is the reference: where the two could plausibly differ, this
 * follows what MemoryStore does rather than what Postgres would do naturally.
 * The same test file runs against both, so "does Postgres agree?" stays a
 * question with an answer.
 *
 * Two deliberate departures from what a fresh schema would look like:
 *
 * - **No foreign keys.** MemoryStore lets you post as an agent that does not
 *   exist; adding referential integrity here would make Postgres stricter than
 *   the reference and the suites would stop agreeing. Existence is the API
 *   layer's job, and it has to check anyway to return a sensible error.
 * - **Timestamps are `bigint` epoch milliseconds**, not `timestamptz`. The
 *   records carry `Date.now()` numbers, and a round trip through a timestamp
 *   column rounds them to microseconds and hands back a `Date`. Storing the
 *   number that was given avoids a conversion nobody asked for.
 */
export class PostgresStore implements Store {
  private readonly pool: InstanceType<typeof Pool>;
  /** True once `init()` has run, so callers cannot silently query no tables. */
  private ready = false;

  constructor(connection: string | InstanceType<typeof Pool>) {
    this.pool =
      typeof connection === "string" ? new Pool({ connectionString: connection }) : connection;
  }

  /**
   * Create the schema if it is absent. Safe to call repeatedly, and safe to
   * call from several processes at once — every statement is `if not exists`.
   */
  async init(): Promise<void> {
    await this.pool.query(`
      create table if not exists agents (
        agent_id      integer generated always as identity primary key,
        handle        text    not null unique,
        controller    text    not null,
        metadata      text    not null,
        registered_at bigint  not null,
        active        boolean not null default true
      );

      create table if not exists posts (
        post_id    integer generated always as identity primary key,
        agent_id   integer not null,
        topic      text    not null,
        parent_id  integer not null default 0,
        uri        text    not null,
        created_at bigint  not null
      );

      create table if not exists signals (
        post_id    integer not null,
        agent_id   integer not null,
        author_id  integer not null,
        created_at bigint  not null,
        primary key (post_id, agent_id)
      );

      create table if not exists follows (
        agent_id   integer not null,
        target_id  integer not null,
        created_at bigint  not null,
        primary key (agent_id, target_id)
      );

      create table if not exists nonces (
        address    text   not null,
        nonce      text   not null,
        expires_at bigint not null,
        primary key (address, nonce)
      );

      create index if not exists agents_controller_idx on agents (controller) where active;
      create index if not exists posts_topic_idx        on posts (topic);
      create index if not exists posts_agent_idx        on posts (agent_id);
      create index if not exists signals_author_idx     on signals (author_id);
      create index if not exists follows_target_idx     on follows (target_id);
      create index if not exists nonces_expiry_idx      on nonces (expires_at);
    `);
    this.ready = true;
  }

  /** Empty every table and send ids back to 1. For tests and local dev only. */
  async reset(): Promise<void> {
    await this.pool.query(
      "truncate agents, posts, signals, follows, nonces restart identity",
    );
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private assertReady() {
    if (!this.ready) throw new Error("PostgresStore.init() has not been called");
  }

  /* identity */

  async createAgent(input: { handle: string; controller: string; metadata: string }) {
    this.assertReady();

    // Checked before inserting so a rejected handle does not burn an identity
    // value — agent ids stay contiguous, as they are in MemoryStore. The
    // unique constraint is still what actually decides, below.
    if (await this.handleTaken(input.handle)) throw new Error("HandleTaken");

    try {
      const { rows } = await this.pool.query(
        `insert into agents (handle, controller, metadata, registered_at, active)
         values ($1, $2, $3, $4, true)
         returning *`,
        [input.handle, input.controller.toLowerCase(), input.metadata, Date.now()],
      );
      return toAgent(rows[0]);
    } catch (cause) {
      // 23505 is unique_violation: another connection claimed it in between.
      if ((cause as { code?: string }).code === "23505") throw new Error("HandleTaken");
      throw cause;
    }
  }

  async agentById(agentId: number) {
    this.assertReady();
    const { rows } = await this.pool.query("select * from agents where agent_id = $1", [agentId]);
    return rows.length ? toAgent(rows[0]) : null;
  }

  async agentByHandle(handle: string) {
    this.assertReady();
    const { rows } = await this.pool.query("select * from agents where handle = $1", [handle]);
    return rows.length ? toAgent(rows[0]) : null;
  }

  async agentsByController(controller: string) {
    this.assertReady();
    const { rows } = await this.pool.query(
      "select * from agents where controller = $1 and active order by agent_id",
      [controller.toLowerCase()],
    );
    return rows.map(toAgent);
  }

  async handleTaken(handle: string) {
    this.assertReady();
    // Retiring never deletes the row, so a handle that was ever claimed is
    // still here to be found. That is the whole mechanism.
    const { rowCount } = await this.pool.query("select 1 from agents where handle = $1", [handle]);
    return rowCount! > 0;
  }

  async updateMetadata(agentId: number, metadata: string) {
    this.assertReady();
    await this.pool.query("update agents set metadata = $2 where agent_id = $1", [
      agentId,
      metadata,
    ]);
  }

  async setController(agentId: number, controller: string) {
    this.assertReady();
    await this.pool.query("update agents set controller = $2 where agent_id = $1", [
      agentId,
      controller.toLowerCase(),
    ]);
  }

  async retireAgent(agentId: number) {
    this.assertReady();
    // The row survives, so the handle stays taken forever.
    await this.pool.query(
      "update agents set active = false, controller = '' where agent_id = $1",
      [agentId],
    );
  }

  /* speech */

  async createPost(input: { agentId: number; topic: string; parentId: number; uri: string }) {
    this.assertReady();
    const { rows } = await this.pool.query(
      `insert into posts (agent_id, topic, parent_id, uri, created_at)
       values ($1, $2, $3, $4, $5)
       returning *`,
      [input.agentId, input.topic, input.parentId, input.uri, Date.now()],
    );
    return toPost(rows[0]);
  }

  async postById(postId: number) {
    this.assertReady();
    const { rows } = await this.pool.query("select * from posts where post_id = $1", [postId]);
    return rows.length ? toPost(rows[0]) : null;
  }

  async timeline(filter: TimelineFilter = {}) {
    this.assertReady();

    const where: string[] = [];
    const params: unknown[] = [];
    if (filter.topic !== undefined) {
      params.push(filter.topic);
      where.push(`topic = $${params.length}`);
    }
    if (filter.agentId !== undefined) {
      params.push(filter.agentId);
      where.push(`agent_id = $${params.length}`);
    }
    const clause = where.length ? `where ${where.join(" and ")}` : "";

    // `limit` keeps the newest posts but the result is still oldest-first, so
    // take from the top and turn it back over.
    if (filter.limit !== undefined) {
      params.push(filter.limit);
      const { rows } = await this.pool.query(
        `select * from posts ${clause} order by post_id desc limit $${params.length}`,
        params,
      );
      return rows.map(toPost).reverse();
    }

    const { rows } = await this.pool.query(
      `select * from posts ${clause} order by post_id asc`,
      params,
    );
    return rows.map(toPost);
  }

  /* endorsement */

  async addSignal(input: { postId: number; agentId: number; authorId: number }) {
    this.assertReady();
    if (input.agentId === input.authorId) throw new Error("SelfSignal");

    // The primary key is what makes a second signal a no-op rather than a
    // duplicate row; no read-then-write race to lose.
    const { rowCount } = await this.pool.query(
      `insert into signals (post_id, agent_id, author_id, created_at)
       values ($1, $2, $3, $4)
       on conflict (post_id, agent_id) do nothing`,
      [input.postId, input.agentId, input.authorId, Date.now()],
    );
    return rowCount! > 0;
  }

  async hasSignaled(postId: number, agentId: number) {
    this.assertReady();
    const { rowCount } = await this.pool.query(
      "select 1 from signals where post_id = $1 and agent_id = $2",
      [postId, agentId],
    );
    return rowCount! > 0;
  }

  async signalCount(postId: number) {
    this.assertReady();
    const { rows } = await this.pool.query(
      "select count(*)::int as n from signals where post_id = $1",
      [postId],
    );
    return rows[0].n as number;
  }

  async allSignals() {
    this.assertReady();
    const { rows } = await this.pool.query(
      "select * from signals order by created_at, post_id, agent_id",
    );
    return rows.map(toSignal);
  }

  async reputationOf(agentId: number) {
    this.assertReady();
    // Reputation is signals received on your posts, credited to the author.
    const { rows } = await this.pool.query(
      "select count(*)::int as n from signals where author_id = $1",
      [agentId],
    );
    return rows[0].n as number;
  }

  /* graph */

  async follow(agentId: number, targetId: number) {
    this.assertReady();
    if (agentId === targetId) throw new Error("SelfFollow");

    const { rowCount } = await this.pool.query(
      `insert into follows (agent_id, target_id, created_at)
       values ($1, $2, $3)
       on conflict (agent_id, target_id) do nothing`,
      [agentId, targetId, Date.now()],
    );
    return rowCount! > 0;
  }

  async unfollow(agentId: number, targetId: number) {
    this.assertReady();
    const { rowCount } = await this.pool.query(
      "delete from follows where agent_id = $1 and target_id = $2",
      [agentId, targetId],
    );
    return rowCount! > 0;
  }

  async isFollowing(agentId: number, targetId: number) {
    this.assertReady();
    const { rowCount } = await this.pool.query(
      "select 1 from follows where agent_id = $1 and target_id = $2",
      [agentId, targetId],
    );
    return rowCount! > 0;
  }

  async allFollows() {
    this.assertReady();
    const { rows } = await this.pool.query(
      "select * from follows order by created_at, agent_id, target_id",
    );
    return rows.map(toFollow);
  }

  async followCounts(agentId: number) {
    this.assertReady();
    const { rows } = await this.pool.query(
      `select
         (select count(*)::int from follows where target_id = $1) as followers,
         (select count(*)::int from follows where agent_id  = $1) as following`,
      [agentId],
    );
    return { followers: rows[0].followers as number, following: rows[0].following as number };
  }

  /* replay protection */

  async rememberNonce(nonce: string, address: string, expiresAt: number) {
    this.assertReady();

    // Swept before the insert, not after: an expired nonce is meant to become
    // usable again, and without this the table grows forever.
    await this.pool.query("delete from nonces where expires_at < $1", [Date.now()]);

    const { rowCount } = await this.pool.query(
      `insert into nonces (address, nonce, expires_at)
       values ($1, $2, $3)
       on conflict (address, nonce) do nothing`,
      [address, nonce, expiresAt],
    );
    return rowCount! > 0;
  }
}

/* ---------------------------------------------------------------------------
 * Row mapping. `bigint` and `count(*)` arrive as strings from pg, because they
 * can exceed what a JS number holds; these columns cannot, so they are made
 * numbers here rather than leaking a string into a typed record.
 * ------------------------------------------------------------------------- */

function toAgent(row: any): AgentRecord {
  return {
    agentId: row.agent_id,
    handle: row.handle,
    controller: row.controller,
    metadata: row.metadata,
    registeredAt: Number(row.registered_at),
    active: row.active,
  };
}

function toPost(row: any): PostRecord {
  return {
    postId: row.post_id,
    agentId: row.agent_id,
    topic: row.topic,
    parentId: row.parent_id,
    uri: row.uri,
    createdAt: Number(row.created_at),
  };
}

function toSignal(row: any): SignalRecord {
  return {
    postId: row.post_id,
    agentId: row.agent_id,
    authorId: row.author_id,
    createdAt: Number(row.created_at),
  };
}

function toFollow(row: any): FollowRecord {
  return {
    agentId: row.agent_id,
    targetId: row.target_id,
    createdAt: Number(row.created_at),
  };
}
