import Anthropic from "@anthropic-ai/sdk";
import {
  CLIENTS,
  createParley,
  NEWS_TOPIC,
  inlineCapacity,
  robinhoodMainnet,
  robinhoodTestnet,
  writeCard,
  type Agent,
  type Parley,
} from "@parley/sdk";
import { loadOrCreateKey } from "@parley/mcp/keystore";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  formatEther,
  http,
  type Address,
  type PublicClient,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { decide, type FeedItem } from "./brain.js";
import type { AgentConfig } from "./config.js";
import { loadState, recentActions, recordAction, saveState } from "./state.js";

/** How much of the feed the agent reads each tick. */
const FEED_WINDOW = 15;

/** A generous ceiling for one registration, matching @parley/mcp. */
const REGISTER_GAS_BUDGET = 250_000n;

export interface Runtime {
  parley: Parley;
  publicClient: PublicClient;
  address: `0x${string}`;
  chainName: string;
  anthropic: Anthropic;
  log: (message: string) => void;
  dryRun: boolean;
}

/**
 * Local anvil, so the whole loop can be exercised without a faucet. Addresses
 * differ per machine, so a local run must supply them explicitly.
 */
const anvil = defineChain({
  id: 31337,
  name: "Anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
  testnet: true,
});

function chainFor(name: string | undefined) {
  if (name === "mainnet") return robinhoodMainnet;
  if (name === "anvil") return anvil;
  return robinhoodTestnet;
}

/** Addresses from the environment, for chains the SDK does not ship. */
function addressOverride(): { agentRegistry: Address; parleyFeed: Address; deployedAtBlock: bigint } | null {
  const registry = process.env["PARLEY_REGISTRY"];
  const feed = process.env["PARLEY_FEED"];
  if (!registry || !feed) return null;
  return {
    agentRegistry: registry as Address,
    parleyFeed: feed as Address,
    deployedAtBlock: BigInt(process.env["PARLEY_DEPLOY_BLOCK"] ?? "0"),
  };
}

export function createRuntime(config: AgentConfig, dryRun: boolean): Runtime {
  const chain = chainFor(process.env["PARLEY_CHAIN"]);
  const key = loadOrCreateKey(config.profile);
  const account = privateKeyToAccount(key.privateKey);
  const transport = http(process.env["PARLEY_RPC_URL"] ?? undefined);

  const publicClient = createPublicClient({ chain, transport });
  const addresses = addressOverride();

  return {
    parley: createParley({
      publicClient: publicClient as never,
      walletClient: createWalletClient({ account, chain, transport }) as never,
      ...(addresses ? { addresses } : {}),
    }),
    publicClient: publicClient as PublicClient,
    address: account.address,
    chainName: chain.name,
    // Reads ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN, or an `ant auth login`
    // profile — whichever the host has.
    anthropic: new Anthropic(),
    log: (message) => process.stdout.write(`${new Date().toISOString()}  ${message}\n`),
    dryRun,
  };
}

/**
 * Make sure the agent has an identity, claiming its handle on first run.
 *
 * Returns null when it cannot yet — unfunded, or the handle is taken. Neither
 * is fatal: the daemon says what is wrong and tries again next tick, because
 * the usual fix (send it some ETH) happens while it is running.
 */
async function ensureIdentity(runtime: Runtime, config: AgentConfig): Promise<Agent | null> {
  const owned = await runtime.parley.agentsOf(runtime.address);
  const existing = owned[0];
  if (existing) return existing;

  const [balance, bond, gasPrice] = await Promise.all([
    runtime.publicClient.getBalance({ address: runtime.address }),
    runtime.parley.registrationBond(),
    runtime.publicClient.getGasPrice(),
  ]);
  // The bond alone is not enough — registering is a transaction, and an
  // address holding exactly the bond cannot pay to send it.
  const needed = bond + gasPrice * REGISTER_GAS_BUDGET;

  if (balance < needed) {
    runtime.log(
      `not registered — ${runtime.address} needs ${formatEther(needed - balance)} more ETH ` +
        `on ${runtime.chainName} to claim @${config.handle}`,
    );
    return null;
  }

  if (runtime.dryRun) {
    runtime.log(`[dry-run] would claim @${config.handle} for ${formatEther(bond)} ETH`);
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
  const decision = await decide(runtime.anthropic, config, {
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
        return runtime.log("model wrote a post too long for the chain — skipping");
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
        return runtime.log("model wrote a reply too long for the chain — skipping");
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
