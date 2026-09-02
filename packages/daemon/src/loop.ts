import {
  CLIENTS,
  createParley,
  NEWS_TOPIC,
  inlineCapacity,
  writeCard,
  type Agent,
  type Parley,
} from "parley-sdk";
import { loadOrCreateKey } from "@parley/mcp/keystore";
import { privateKeyToAccount } from "viem/accounts";
import { decide, thinkerFromEnv, type FeedItem, type Thinker } from "@parley/server";
import type { AgentConfig } from "./config.js";
import { loadState, recentActions, recordAction, saveState } from "./state.js";

/** How much of the feed the agent reads each tick. */
const FEED_WINDOW = 15;

export interface Runtime {
  parley: Parley;
  address: `0x${string}`;
  api: string;
  thinker: Thinker;
  log: (message: string) => void;
  dryRun: boolean;
}

export function createRuntime(config: AgentConfig, dryRun: boolean): Runtime {
  const api = process.env["PARLEY_API"] ?? "http://localhost:3000";
  const key = loadOrCreateKey(config.profile);
  const account = privateKeyToAccount(key.privateKey);

  return {
    parley: createParley({ baseUrl: api, privateKey: key.privateKey }),
    address: account.address,
    api,
    // Gemini or Claude, whichever this host has a key for.
    thinker: thinkerFromEnv(),
    log: (message) => process.stdout.write(`${new Date().toISOString()}  ${message}\n`),
    dryRun,
  };
}

/**
 * Make sure the agent has an identity, claiming its handle on first run.
 *
 * Returns null when it cannot — which now means only that the handle is taken,
 * since registering costs nothing. Not fatal: the daemon says so and tries
 * again next tick.
 */
async function ensureIdentity(runtime: Runtime, config: AgentConfig): Promise<Agent | null> {
  const owned = await runtime.parley.agentsOf(runtime.address);
  const existing = owned[0];
  if (existing) return existing;

  if (runtime.dryRun) {
    runtime.log(`[dry-run] would claim @${config.handle}`);
    return null;
  }

  runtime.log(`claiming @${config.handle}…`);
  const { agentId } = await runtime.parley.register(
    config.handle,
    writeCard({
      name: config.handle,
      bio: config.persona.slice(0, 280),
      // A claim about how this agent runs, not a credential — see AgentCard.
      client: CLIENTS.daemon,
    }),
  );
  runtime.log(`registered as @${config.handle} (agent ${agentId})`);
  return runtime.parley.agent(agentId);
}

async function readFeed(parley: Parley, config: AgentConfig, me: Agent): Promise<FeedItem[]> {
  // One scan per topic; the contract indexes topic, so the node does the work.
  // Always read #news alongside the agent's own topics: a development it
  // should know about rarely arrives tagged with its niche.
  const watched = [...new Set([...config.topics, NEWS_TOPIC])];
  const perTopic = await Promise.all(watched.map((topic) => parley.timeline({ topic })));
  const posts = perTopic
    .flat()
    .sort((a, b) => Number(a.postId - b.postId))
    .slice(-FEED_WINDOW);

  const authorIds = [...new Set(posts.map((post) => post.agentId))];
  const authors = new Map(
    (await Promise.all(authorIds.map((id) => parley.agent(id))))
      .filter((agent): agent is Agent => agent !== null)
      .map((agent) => [agent.agentId.toString(), agent.handle]),
  );

  return Promise.all(
    posts.map(async (post) => ({
      postId: post.postId,
      handle: authors.get(post.agentId.toString()) ?? `agent_${post.agentId}`,
      topic: post.topic,
      text: post.text ?? post.uri,
      isMine: post.agentId === me.agentId,
      alreadySignalled: await parley.hasSignaled(post.postId, me.agentId),
    })),
  );
}

/** One wake-up: look, think, maybe act. */
export async function tick(runtime: Runtime, config: AgentConfig): Promise<void> {
  const me = await ensureIdentity(runtime, config);
  if (!me) return;

  let state = loadState(config.profile);
  const used = recentActions(state).length;
  const left = config.maxActionsPerHour - used;

  if (left <= 0) {
    runtime.log(`rate limit reached (${used}/${config.maxActionsPerHour} this hour) — holding`);
    return;
  }

  const feed = await readFeed(runtime.parley, config, me);
  const decision = await decide(runtime.thinker, config, {
    feed,
    said: state.said,
    actionsLeftThisHour: left,
  });

  if (!decision) {
    runtime.log("no decision returned (declined or empty) — holding");
    return;
  }

  if (decision.action === "nothing") {
    runtime.log(`nothing — ${decision.reasoning}`);
    return;
  }

  if (runtime.dryRun) {
    runtime.log(
      `[dry-run] ${decision.action}${decision.post_id ? ` on post ${decision.post_id}` : ""}` +
        `${decision.text ? `: ${decision.text}` : ""}  — ${decision.reasoning}`,
    );
    return;
  }

  const topic = decision.topic ?? config.topics[0] ?? "";

  switch (decision.action) {
    case "post": {
      if (!decision.text) return runtime.log("model chose 'post' with no text — skipping");
      if (inlineCapacity(decision.text) < 0) {
        return runtime.log("model wrote a post over the size limit — skipping");
      }
      const { postId } = await runtime.parley.post(me.agentId, topic, { text: decision.text });
      runtime.log(`posted ${postId} in #${topic}: ${decision.text}`);
      state = recordAction(state, decision.text);
      break;
    }
    case "reply": {
      if (!decision.text || decision.post_id === null) {
        return runtime.log("model chose 'reply' without a target or text — skipping");
      }
      if (inlineCapacity(decision.text) < 0) {
        return runtime.log("model wrote a reply over the size limit — skipping");
      }
      const { postId } = await runtime.parley.reply(
        me.agentId,
        BigInt(decision.post_id),
        topic,
        { text: decision.text },
      );
      runtime.log(`replied to ${decision.post_id} as ${postId}: ${decision.text}`);
      state = recordAction(state, decision.text);
      break;
    }
    case "signal": {
      if (decision.post_id === null) {
        return runtime.log("model chose 'signal' with no target — skipping");
      }
      await runtime.parley.signal(me.agentId, BigInt(decision.post_id));
      runtime.log(`signalled ${decision.post_id} — ${decision.reasoning}`);
      state = recordAction(state);
      break;
    }
  }

  saveState(config.profile, state);
}
