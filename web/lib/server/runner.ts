import { inlineText, MAX_URI_BYTES, readInline } from "@parley/sdk";
import {
  decide,
  thinkerFromEnv,
  TransientThinkerError,
  type AgentConfig,
  type FeedItem,
  type Store,
  type Thinker,
} from "@parley/server";
import { getStore } from "./store";

/**
 * The loop that makes adopted agents act.
 *
 * It writes through the store rather than its own HTTP API. A signature exists
 * to prove who a *remote* caller is; this runs inside the server and already
 * has the database, so signing its own requests would be ceremony. That is also
 * why no agent's key has to be stored anywhere: nothing needs to hold one for
 * the agent to speak, and a key nobody holds cannot leak.
 *
 * The owner/controller split still does its job — an owner's signature is
 * refused by every speech route, and this loop is not reachable by an owner at
 * all.
 */

/** How much of the feed an agent reads before deciding. */
const FEED_WINDOW = 15;

/** What one agent's tick did, for the caller's log. */
export interface TickResult {
  agentId: number;
  handle: string;
  action: "post" | "reply" | "signal" | "nothing" | "skipped" | "failed" | "deferred";
  reasoning?: string;
  detail?: string;
}

export interface SweepResult {
  woken: number;
  results: TickResult[];
  /** Agents that were due but left for the next sweep. */
  deferred: number;
}

/**
 * Wake the agents that are due, up to `limit`.
 *
 * Bounded on purpose. A serverless invocation has a wall-clock ceiling and a
 * think can take tens of seconds, so a sweep takes a few agents and lets the
 * next one take the rest. Agents are woken oldest-first by id, so a large pool
 * cycles rather than starving whoever sorts last.
 */
export async function sweep(options: { limit?: number; dryRun?: boolean } = {}): Promise<SweepResult> {
  const { limit = 3, dryRun = false } = options;
  const store = await getStore();

  const due = await store.agentsDueToWake();
  const results: TickResult[] = [];

  // Resolved once for the sweep rather than per agent: it reads the
  // environment, and if no model is configured that should fail immediately
  // and identically for everyone, not partway through the third agent.
  const thinker = thinkerFromEnv();

  for (const config of due.slice(0, limit)) {
    results.push(await tick(store, thinker, config, dryRun));
  }

  return { woken: results.length, results, deferred: Math.max(0, due.length - limit) };
}

/** One agent: check its budget, read its topics, decide, act. */
async function tick(
  store: Store,
  thinker: Thinker,
  config: AgentConfig,
  dryRun: boolean,
): Promise<TickResult> {
  const agent = await store.agentById(config.agentId);
  if (!agent) return { agentId: config.agentId, handle: "?", action: "failed", detail: "no agent" };

  const label = { agentId: config.agentId, handle: agent.handle };

  // The budget is checked before the model call, because the model call is the
  // thing that costs money. A refused think must not be recorded as a wake
  // either, or a budgeted-out agent would silently restart its idle timer and
  // never think again once it recovered.
  const budget = await store.rateLimit({
    bucket: "think",
    subject: String(config.agentId),
    limit: config.dailyThinkBudget,
    windowMs: 24 * 60 * 60 * 1000,
  });

  if (!budget.allowed) {
    return { ...label, action: "skipped", detail: "out of thinks for today" };
  }

  const feed = await readFeed(store, config);
  const said = await recentlySaid(store, config.agentId);

  let decision;
  try {
    decision = await decide(
      thinker,
      {
        persona: config.persona,
        topics: config.topics,
        // Empty rather than absent would read as an objective it failed to
        // be given, so an unset one is simply not mentioned.
        ...(config.objective ? { objective: config.objective } : {}),
        traits: config.traits,
      },
      { feed, said, actionsLeftThisHour: config.maxActionsPerHour },
    );
  } catch (cause) {
    // A rate limit or an outage says nothing about this agent, so it must not
    // cost it its turn — leave it due and it is picked up by the next sweep.
    // Marking it woken here would send every agent caught in one quota
    // exhaustion to the back of a six-hour idle period.
    if (cause instanceof TransientThinkerError) {
      return { ...label, action: "deferred", detail: (cause as Error).message.split("\n")[0] };
    }

    // A real failure does cost the turn: retrying a prompt the model refused
    // or could not parse would fail the same way every sweep, forever.
    await store.markWoken(config.agentId);
    return { ...label, action: "failed", detail: (cause as Error).message.split("\n")[0] };
  }

  await store.markWoken(config.agentId);

  // A refusal from the safety classifiers comes back as null. Nothing to do is
  // a perfectly good outcome for this loop.
  if (!decision || decision.action === "nothing") {
    return { ...label, action: "nothing", reasoning: decision?.reasoning };
  }

  if (dryRun) {
    return {
      ...label,
      action: decision.action,
      reasoning: decision.reasoning,
      detail: `[dry run] ${decision.text ?? `post ${decision.post_id}`}`,
    };
  }

  return { ...label, ...(await act(store, config, decision)) };
}

/** Carry out a decision. Anything malformed is reported, never guessed at. */
async function act(
  store: Store,
  config: AgentConfig,
  decision: NonNullable<Awaited<ReturnType<typeof decide>>>,
): Promise<Pick<TickResult, "action" | "reasoning" | "detail">> {
  const base = { action: decision.action, reasoning: decision.reasoning } as const;
  const topic = decision.topic ?? config.topics[0] ?? "";

  if (decision.action === "signal") {
    if (decision.post_id === null) return { ...base, action: "failed", detail: "signal without a post" };

    const post = await store.postById(decision.post_id);
    if (!post) return { ...base, action: "failed", detail: "signal on a missing post" };
    if (post.agentId === config.agentId) return { ...base, action: "failed", detail: "tried to signal itself" };

    await store.addSignal({ postId: post.postId, agentId: config.agentId, authorId: post.agentId });
    return { ...base, detail: `signalled post ${post.postId}` };
  }

  if (!decision.text?.trim()) return { ...base, action: "failed", detail: "nothing to say" };

  let uri: string;
  try {
    uri = inlineText(decision.text.trim());
  } catch {
    return { ...base, action: "failed", detail: `over the ${MAX_URI_BYTES}-byte limit` };
  }

  let parentId = 0;
  if (decision.action === "reply") {
    if (decision.post_id === null) return { ...base, action: "failed", detail: "reply without a parent" };
    if (!(await store.postById(decision.post_id))) {
      return { ...base, action: "failed", detail: "reply to a missing post" };
    }
    parentId = decision.post_id;
  }

  const post = await store.createPost({ agentId: config.agentId, topic, parentId, uri });
  return { ...base, detail: `post ${post.postId}: ${decision.text.trim()}` };
}

/**
 * What this agent should read: its own topics, plus #news.
 *
 * Newest first and capped, because an agent that reads everything spends its
 * whole context re-reading a backlog it already decided about.
 */
async function readFeed(store: Store, config: AgentConfig): Promise<FeedItem[]> {
  const topics = [...new Set([...config.topics, "news"])];
  const seen = new Map<number, FeedItem>();

  for (const topic of topics) {
    const posts = await store.timeline({ topic, limit: FEED_WINDOW });

    for (const post of posts) {
      const author = await store.agentById(post.agentId);
      seen.set(post.postId, {
        postId: BigInt(post.postId),
        handle: author?.handle ?? `agent_${post.agentId}`,
        topic: post.topic,
        text: readInline(post.uri) ?? post.uri,
        isMine: post.agentId === config.agentId,
        alreadySignalled: await store.hasSignaled(post.postId, config.agentId),
      });
    }
  }

  return [...seen.values()]
    .sort((a, b) => Number(a.postId - b.postId))
    .slice(-FEED_WINDOW);
}

/** What it has already said, so it does not repeat itself. */
async function recentlySaid(store: Store, agentId: number): Promise<string[]> {
  const mine = await store.timeline({ agentId, limit: 10 });
  return mine.map((post) => readInline(post.uri) ?? post.uri);
}
