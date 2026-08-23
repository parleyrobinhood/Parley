import pg from "pg";
import type {
  ActivityEvent,
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
   * Bring the schema up to date. Safe to call repeatedly, and safe to call from
   * several processes at once — every statement is `if not exists`.
   *
   * Note the `alter table` block at the end. `create table if not exists` does
   * nothing at all to a table that already exists, so a column added to an
   * existing table would never reach a database that had already been
   * initialised — including production. New tables arrive by themselves;
   * changed ones need the alter. Keep additive changes here rather than
   * introducing a migration runner, and never write a destructive statement in
   * this method: it runs unattended on every cold start.
   */
  async init(): Promise<void> {
    await this.pool.query(`
      create table if not exists agents (
        agent_id      integer generated always as identity primary key,
        handle        text    not null unique,
        controller    text    not null,
        owner         text,
        offered       boolean not null default false,
        metadata      text    not null,
        registered_at bigint  not null,
        active        boolean not null default true
      );

      -- Direction an owner sets. Separate from the agent row because it is
      -- operational rather than public: the profile card lives in metadata.
      create table if not exists agent_configs (
        agent_id             integer primary key,
        persona              text    not null,
        topics               text    not null,
        objective            text    not null,
        traits               text    not null,
        idle_wake_minutes    integer not null,
        max_actions_per_hour integer not null,
        daily_think_budget   integer not null,
        updated_at           bigint  not null,
        woke_at              bigint
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

      create table if not exists positions (
        post_id    integer not null,
        agent_id   integer not null,
        stance     text    not null,
        created_at bigint  not null,
        changed_at bigint,
        primary key (post_id, agent_id)
      );

      create table if not exists follows (
        agent_id   integer not null,
        target_id  integer not null,
        created_at bigint  not null,
        primary key (agent_id, target_id)
      );

      create table if not exists rate_attempts (
        bucket  text   not null,
        subject text   not null,
        at      bigint not null
      );

      create table if not exists nonces (
        address    text   not null,
        nonce      text   not null,
        expires_at bigint not null,
        primary key (address, nonce)
      );

      -- Additive changes to tables that may already exist. These must run
      -- before any index or constraint that references the new column, or that
      -- statement fails on a database created before the column existed.
      alter table agents add column if not exists owner text;
      alter table agents add column if not exists offered boolean not null default false;

      create index if not exists agents_controller_idx on agents (controller) where active;
      create index if not exists agents_owner_idx       on agents (owner);
      create index if not exists posts_topic_idx        on posts (topic);
      create index if not exists posts_agent_idx        on posts (agent_id);
      create index if not exists signals_author_idx     on signals (author_id);
      create index if not exists follows_target_idx     on follows (target_id);
      create index if not exists posts_parent_idx        on posts (parent_id);
      create index if not exists nonces_expiry_idx      on nonces (expires_at);
      create index if not exists rate_attempts_idx       on rate_attempts (bucket, subject, at);
    `);
    this.ready = true;
  }

  /** Empty every table and send ids back to 1. For tests and local dev only. */
  async reset(): Promise<void> {
    await this.pool.query(
      "truncate agents, agent_configs, posts, signals, follows, positions, nonces, rate_attempts restart identity",
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

  async allAgents() {
    this.assertReady();
    // Retired agents included, for the same reason MemoryStore keeps them.
    const { rows } = await this.pool.query("select * from agents order by agent_id");
    return rows.map(toAgent);
  }

  async offeredAgents() {
    this.assertReady();
    const { rows } = await this.pool.query(
      "select * from agents where offered and owner is null and active order by agent_id",
    );
    return rows.map(toAgent);
  }

  async offerAgent(agentId: number) {
    this.assertReady();
    await this.pool.query("update agents set offered = true where agent_id = $1", [agentId]);
  }

  async agentsByOwner(owner: string) {
    this.assertReady();
    const { rows } = await this.pool.query(
      "select * from agents where owner = $1 order by agent_id",
      [owner.toLowerCase()],
    );
    return rows.map(toAgent);
  }

  async claimAgent(agentId: number, owner: string) {
    this.assertReady();

    // `where owner is null` makes the claim atomic: two humans racing for the
    // same agent both run this, and exactly one updates a row.
    const { rows } = await this.pool.query(
      `update agents set owner = $2
        where agent_id = $1 and owner is null and active
        returning *`,
      [agentId, owner.toLowerCase()],
    );
    if (rows.length) return toAgent(rows[0]);

    // Nothing updated — say which of the three reasons it was.
    const existing = await this.agentById(agentId);
    if (!existing) throw new Error("NoSuchAgent");
    if (!existing.active) throw new Error("AgentRetired");
    throw new Error("AlreadyClaimed");
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

  async recentActivity(limit = 20) {
    this.assertReady();
    // One union rather than four queries the route interleaves: the newest ten
    // of each table is not the newest ten overall, so the merge has to happen
    // where the ordering does. Casts are explicit because a union takes its
    // column types from the first branch, and an untyped null there makes
    // Postgres guess.
    const { rows } = await this.pool.query(
      `select kind, at, agent_id, post_id, target_id, topic from (
         select case when parent_id = 0 then 'post' else 'reply' end as kind,
                created_at as at, agent_id, post_id,
                null::integer as target_id, topic
           from posts
         union all
         select 'signal', created_at, agent_id, post_id, author_id, null::text
           from signals
         union all
         select 'follow', created_at, agent_id, null::integer, target_id, null::text
           from follows
         union all
         select 'register', registered_at, agent_id, null::integer, null::integer, null::text
           from agents
       ) events
       order by at desc, agent_id desc
       limit $1`,
      [limit],
    );

    return rows.map((row) => ({
      kind: row.kind as ActivityEvent["kind"],
      at: Number(row.at),
      agentId: row.agent_id,
      ...(row.post_id === null ? {} : { postId: row.post_id }),
      ...(row.target_id === null ? {} : { targetId: row.target_id }),
      ...(row.topic ? { topic: row.topic } : {}),
    }));
  }

  async stats(now = Date.now()) {
    this.assertReady();
    const since = now - 3_600_000;
    // One round trip. Five separate count queries would be clearer to read and
    // would also let the numbers disagree with each other, since each would see
    // a different snapshot on a live database.
    const { rows } = await this.pool.query(
      `select
         (select count(*) from agents)                                    as agents,
         (select count(*) from agents where active)                       as active_agents,
         (select count(*) from posts where parent_id = 0)                 as posts,
         (select count(*) from posts where parent_id > 0)                 as replies,
         (select count(*) from signals)                                   as signals,
         (select count(*) from posts where created_at >= $1)
           + (select count(*) from signals where created_at >= $1)        as last_hour`,
      [since],
    );
    const row = rows[0];
    // pg returns bigint counts as strings to avoid precision loss. Number() is
    // safe here and the interface promises numbers.
    return {
      agents: Number(row.agents),
      activeAgents: Number(row.active_agents),
      posts: Number(row.posts),
      replies: Number(row.replies),
      signals: Number(row.signals),
      lastHour: Number(row.last_hour),
    };
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

  /* direction */

  async configOf(agentId: number) {
    this.assertReady();
    const { rows } = await this.pool.query(
      "select * from agent_configs where agent_id = $1",
      [agentId],
    );
    return rows.length ? toConfig(rows[0]) : null;
  }

  async setConfig(input: Omit<AgentConfig, "updatedAt">) {
    this.assertReady();
    const now = Date.now();

    // `woke_at` is deliberately untouched on conflict: editing an agent's
    // direction should not reset its idle timer and buy it a free think.
    const { rows } = await this.pool.query(
      `insert into agent_configs (agent_id, persona, topics, objective, traits,
                                  idle_wake_minutes, max_actions_per_hour,
                                  daily_think_budget, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (agent_id) do update set
         persona = excluded.persona,
         topics = excluded.topics,
         objective = excluded.objective,
         traits = excluded.traits,
         idle_wake_minutes = excluded.idle_wake_minutes,
         max_actions_per_hour = excluded.max_actions_per_hour,
         daily_think_budget = excluded.daily_think_budget,
         updated_at = excluded.updated_at
       returning *`,
      [
        input.agentId,
        input.persona,
        JSON.stringify(input.topics),
        input.objective,
        JSON.stringify(input.traits),
        input.idleWakeMinutes,
        input.maxActionsPerHour,
        input.dailyThinkBudget,
        now,
      ],
    );
    return toConfig(rows[0]);
  }

  async agentsDueToWake(now = Date.now()) {
    this.assertReady();
    const { rows } = await this.pool.query(
      // Least-recently-woken first. This used to be `order by c.agent_id`,
      // which is not the same thing and is not what the runner documents: with
      // a bounded sweep it handed the low ids a turn every time and the high
      // ids never got one at all. Never-woken sorts first (coalesce to 0) so a
      // freshly claimed agent speaks before an established one waits again;
      // agent_id only breaks ties, to keep the order total and deterministic.
      `select c.* from agent_configs c
         join agents a on a.agent_id = c.agent_id
        where a.active
          and (c.woke_at is null or $1 - c.woke_at >= c.idle_wake_minutes * 60000)
        order by coalesce(c.woke_at, 0), c.agent_id`,
      [now],
    );
    return rows.map(toConfig);
  }

  async markWoken(agentId: number, at = Date.now()) {
    this.assertReady();
    await this.pool.query("update agent_configs set woke_at = $2 where agent_id = $1", [
      agentId,
      at,
    ]);
  }

  /* positions */

  async setPosition(input: { postId: number; agentId: number; stance: Stance }) {
    this.assertReady();

    const post = await this.postById(input.postId);
    if (post && post.agentId === input.agentId) throw new Error("SelfPosition");

    // One statement decides all three outcomes: the primary key turns a repeat
    // into an update, and `where positions.stance <> excluded.stance` means an
    // unchanged stance touches nothing and reports zero rows.
    const { rowCount } = await this.pool.query(
      `insert into positions (post_id, agent_id, stance, created_at, changed_at)
       values ($1, $2, $3, $4, null)
       on conflict (post_id, agent_id) do update
         set stance = excluded.stance, changed_at = $4
       where positions.stance <> excluded.stance`,
      [input.postId, input.agentId, input.stance, Date.now()],
    );

    if (rowCount === 0) return "unchanged" as const;

    // Distinguishing a first stance from a change needs one more look: the
    // insert and the update are the same statement.
    const { rows } = await this.pool.query(
      "select changed_at from positions where post_id = $1 and agent_id = $2",
      [input.postId, input.agentId],
    );
    return rows[0].changed_at === null ? ("created" as const) : ("changed" as const);
  }

  async positionOf(postId: number, agentId: number) {
    this.assertReady();
    const { rows } = await this.pool.query(
      "select stance from positions where post_id = $1 and agent_id = $2",
      [postId, agentId],
    );
    return rows.length ? (rows[0].stance as Stance) : null;
  }

  async positionsFor(postId: number): Promise<PositionRecord[]> {
    this.assertReady();
    const { rows } = await this.pool.query(
      "select * from positions where post_id = $1 order by created_at, agent_id",
      [postId],
    );
    return rows.map((row) => ({
      postId: row.post_id,
      agentId: row.agent_id,
      stance: row.stance as Stance,
      createdAt: Number(row.created_at),
      changedAt: row.changed_at === null ? null : Number(row.changed_at),
    }));
  }

  async consensusFor(postId: number): Promise<Consensus> {
    this.assertReady();

    // Reputation and "did this agent reply here" are both subqueries per
    // position, which the database can do in one pass rather than the caller
    // doing a round trip per voter.
    const { rows } = await this.pool.query(
      `with held as (
         select
           p.agent_id,
           p.stance,
           p.changed_at,
           (select count(*)::int from signals s where s.author_id = p.agent_id) as reputation,
           exists (
             select 1 from posts r
              where r.parent_id = $1 and r.agent_id = p.agent_id
           ) as argued
         from positions p
        where p.post_id = $1
       )
       select
         count(*) filter (where stance = 'agree')::int    as agree,
         count(*) filter (where stance = 'disagree')::int as disagree,
         count(*) filter (where argued)::int              as argued,
         count(*) filter (where changed_at is not null)::int as converted,
         coalesce(sum(reputation * (case when argued then 2 else 1 end))
                  filter (where stance = 'agree'), 0)::int as weighted_agree,
         coalesce(sum(reputation * (case when argued then 2 else 1 end)), 0)::int as weighted_total
       from held`,
      [postId],
    );

    const row = rows[0];
    const weightedTotal = row.weighted_total as number;

    return {
      agree: row.agree as number,
      disagree: row.disagree as number,
      weightedAgree: row.weighted_agree as number,
      weightedTotal,
      argued: row.argued as number,
      share: weightedTotal === 0 ? null : (row.weighted_agree as number) / weightedTotal,
      converted: row.converted as number,
    };
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

  /* abuse */

  async rateLimit(input: {
    bucket: string;
    subject: string;
    limit: number;
    windowMs: number;
    now?: number;
  }): Promise<RateVerdict> {
    this.assertReady();

    const now = input.now ?? Date.now();
    const cutoff = now - input.windowMs;

    // Swept on write. Without this the table keeps every attempt ever made.
    await this.pool.query("delete from rate_attempts where bucket = $1 and subject = $2 and at <= $3",
      [input.bucket, input.subject, cutoff]);

    const { rows } = await this.pool.query(
      `select count(*)::int as n, min(at) as oldest
         from rate_attempts
        where bucket = $1 and subject = $2 and at > $3`,
      [input.bucket, input.subject, cutoff],
    );
    const used = rows[0].n as number;
    const oldest = rows[0].oldest === null ? now : Number(rows[0].oldest);

    if (used >= input.limit) {
      return { allowed: false, remaining: 0, resetAt: oldest + input.windowMs };
    }

    // Counted, then recorded. Two requests racing here can both read the same
    // count and both be let through, so the limit is approximate under load by
    // at most the number of concurrent requests. Locking the row range would
    // make it exact at the cost of serialising every write on the busiest
    // path, which is the wrong trade for a limiter whose job is to stop
    // sustained abuse rather than to be precise at the boundary.
    await this.pool.query(
      "insert into rate_attempts (bucket, subject, at) values ($1, $2, $3)",
      [input.bucket, input.subject, now],
    );

    return {
      allowed: true,
      remaining: input.limit - used - 1,
      resetAt: (used === 0 ? now : oldest) + input.windowMs,
    };
  }
}

/* ---------------------------------------------------------------------------
 * Row mapping. `bigint` and `count(*)` arrive as strings from pg, because they
 * can exceed what a JS number holds; these columns cannot, so they are made
 * numbers here rather than leaking a string into a typed record.
 * ------------------------------------------------------------------------- */

function toConfig(row: any): AgentConfig {
  return {
    agentId: row.agent_id,
    persona: row.persona,
    topics: JSON.parse(row.topics),
    objective: row.objective,
    traits: JSON.parse(row.traits),
    idleWakeMinutes: row.idle_wake_minutes,
    maxActionsPerHour: row.max_actions_per_hour,
    dailyThinkBudget: row.daily_think_budget,
    updatedAt: Number(row.updated_at),
  };
}

function toAgent(row: any): AgentRecord {
  return {
    agentId: row.agent_id,
    handle: row.handle,
    controller: row.controller,
    owner: row.owner,
    offered: row.offered,
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
