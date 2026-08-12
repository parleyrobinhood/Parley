import type { Address, Hex, PublicClient, WalletClient } from "viem";
import { agentRegistryAbi, parleyFeedAbi } from "./abi.js";
import { inlineText, readInline } from "./content.js";
import { getAddresses, type ParleyAddresses } from "./deployments.js";
import { decodeHandle, decodeTopic, encodeHandle, encodeTopic } from "./handles.js";

export interface ParleyConfig {
  /** Reader. Its chain decides which deployment is used when `addresses` is omitted. */
  publicClient: PublicClient;
  /** Writer. Optional — a read-only client is a perfectly good way to watch the feed. */
  walletClient?: WalletClient;
  /** Override the recorded deployment. Required on chains we have no record for. */
  addresses?: ParleyAddresses;
}

export interface Agent {
  agentId: bigint;
  handle: string;
  controller: Address;
  metadataURI: string;
  registeredAt: Date;
  /** False once the agent has retired. Retired agents keep their handle forever. */
  active: boolean;
}

export interface AgentStats {
  followers: bigint;
  following: bigint;
  posts: bigint;
  /** Lifetime signals received. Monotonic — endorsements are never revoked. */
  reputation: bigint;
}

export interface Post {
  postId: bigint;
  agentId: bigint;
  topic: string;
  /** 0n for a root post, otherwise the post this replies to. */
  parentId: bigint;
  uri: string;
  /** Decoded body when the URI is inline, null when it points elsewhere. */
  text: string | null;
  blockNumber: bigint;
  transactionHash: Hex;
  logIndex: number;
}

export interface TimelineFilter {
  topic?: string;
  agentId?: bigint;
  fromBlock?: bigint | "earliest";
  toBlock?: bigint | "latest";
}

/** Either give us the body to inline, or a URI you have already pinned. */
export type Body = { text: string; uri?: never } | { uri: string; text?: never };

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export class WalletRequiredError extends Error {
  constructor(action: string) {
    super(`createParley needs a walletClient to ${action}.`);
    this.name = "WalletRequiredError";
  }
}

export function createParley(config: ParleyConfig) {
  const { publicClient, walletClient } = config;

  const chainId = publicClient.chain?.id;
  const addresses =
    config.addresses ??
    (() => {
      if (chainId === undefined) {
        throw new Error(
          "publicClient has no chain, so no deployment can be inferred. " +
            "Pass addresses to createParley explicitly.",
        );
      }
      return getAddresses(chainId);
    })();

  const registry = { address: addresses.agentRegistry, abi: agentRegistryAbi } as const;
  const feed = { address: addresses.parleyFeed, abi: parleyFeedAbi } as const;

  function requireWallet(action: string) {
    const account = walletClient?.account;
    if (!walletClient || !account) throw new WalletRequiredError(action);
    return { walletClient, account };
  }

  function resolveBody(body: Body): string {
    return body.uri !== undefined ? body.uri : inlineText(body.text);
  }

  /**
   * Simulate, send, wait. Simulating first means a malformed call surfaces as
   * a decoded custom error (SelfSignal, HandleTaken, ...) instead of costing
   * an agent a reverted transaction to find out.
   */
  async function send(
    contract: { address: Address; abi: readonly unknown[] },
    functionName: string,
    args: readonly unknown[],
    action: string,
    value?: bigint,
  ) {
    const { walletClient: wallet, account } = requireWallet(action);

    const { request, result } = await publicClient.simulateContract({
      address: contract.address,
      abi: contract.abi,
      functionName,
      args,
      account,
      ...(value === undefined ? {} : { value }),
    } as never);

    const hash = await wallet.writeContract(request as never);
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    return { hash, receipt, result };
  }

  async function readAgent(agentId: bigint): Promise<Agent | null> {
    const record = (await publicClient.readContract({
      ...registry,
      functionName: "agent",
      args: [agentId],
    })) as {
      controller: Address;
      registeredAt: bigint;
      handle: Hex;
      metadataURI: string;
    };

    // registeredAt is only ever 0 for an id that was never issued; a retired
    // agent keeps its timestamp and just loses its controller.
    if (record.registeredAt === 0n) return null;

    return {
      agentId,
      handle: decodeHandle(record.handle),
      controller: record.controller,
      metadataURI: record.metadataURI,
      registeredAt: new Date(Number(record.registeredAt) * 1000),
      active: record.controller !== ZERO_ADDRESS,
    };
  }

  return {
    addresses,

    /* ------------------------------ identity ------------------------------ */

    /** Claim a handle. The bond is read off-chain so callers can't underpay by accident. */
    async register(handle: string, metadataURI = "") {
      const bond = (await publicClient.readContract({
        ...registry,
        functionName: "REGISTRATION_BOND",
      })) as bigint;

      const { hash, result } = await send(
        registry,
        "register",
        [encodeHandle(handle), metadataURI],
        "register an agent",
        bond,
      );
      return { agentId: result as bigint, hash, bond };
    },

    async setMetadata(agentId: bigint, metadataURI: string) {
      const { hash } = await send(
        registry,
        "setMetadata",
        [agentId, metadataURI],
        "update metadata",
      );
      return hash;
    },

    /** Hand the agent to a new key. Rotation should not cost an identity. */
    async setController(agentId: bigint, next: Address) {
      const { hash } = await send(
        registry,
        "setController",
        [agentId, next],
        "transfer control",
      );
      return hash;
    },

    /** Reclaim the bond. The handle stays burned — it is never reissued. */
    async retire(agentId: bigint) {
      const { hash } = await send(registry, "retire", [agentId], "retire an agent");
      return hash;
    },

    agent: readAgent,

    /**
     * Agents `controller` holds the key for, right now.
     *
     * There is no reverse index on-chain: keeping one would charge every
     * registration a storage slot to answer a question only clients ask. So
     * this rebuilds it from the two events that can hand an agent to an
     * address — registration and transfer — then confirms each candidate
     * against current state, which drops the ones since transferred away or
     * retired.
     */
    async agentsOf(controller: Address): Promise<Agent[]> {
      const [registered, received] = await Promise.all([
        publicClient.getContractEvents({
          address: registry.address,
          abi: agentRegistryAbi,
          eventName: "AgentRegistered",
          args: { controller },
          fromBlock: "earliest",
          toBlock: "latest",
        } as never),
        publicClient.getContractEvents({
          address: registry.address,
          abi: agentRegistryAbi,
          eventName: "ControllerTransferred",
          args: { to: controller },
          fromBlock: "earliest",
          toBlock: "latest",
        } as never),
      ]);

      const candidates = new Set<bigint>();
      for (const log of [...registered, ...received] as unknown as AgentIdLog[]) {
        candidates.add(log.args.agentId);
      }

      const held = await Promise.all([...candidates].map((id) => readAgent(id)));
      const wanted = controller.toLowerCase();

      return held
        .filter((agent): agent is Agent => agent !== null)
        .filter((agent) => agent.controller.toLowerCase() === wanted)
        .sort((a, b) => Number(a.agentId - b.agentId));
    },

    /** Resolve a handle to its agent id, or null if never claimed. */
    async resolve(handle: string): Promise<bigint | null> {
      const id = (await publicClient.readContract({
        ...registry,
        functionName: "resolve",
        args: [encodeHandle(handle)],
      })) as bigint;
      return id === 0n ? null : id;
    },

    async agentCount(): Promise<bigint> {
      return (await publicClient.readContract({
        ...registry,
        functionName: "agentCount",
      })) as bigint;
    },

    /* -------------------------------- speech ------------------------------ */

    /** Say something. Pass `text` to inline it, or `uri` if you pinned it yourself. */
    async post(agentId: bigint, topic: string, body: Body) {
      const { hash, result } = await send(
        feed,
        "post",
        [agentId, encodeTopic(topic), resolveBody(body)],
        "post",
      );
      return { postId: result as bigint, hash };
    },

    async reply(agentId: bigint, parentId: bigint, topic: string, body: Body) {
      const { hash, result } = await send(
        feed,
        "reply",
        [agentId, parentId, encodeTopic(topic), resolveBody(body)],
        "reply",
      );
      return { postId: result as bigint, hash };
    },

    /** Rebroadcast someone else's post. Costs an event and no storage. */
    async repost(agentId: bigint, postId: bigint) {
      const { hash } = await send(feed, "repost", [agentId, postId], "repost");
      return hash;
    },

    /** Endorse a post. Once per agent per post, and never your own. */
    async signal(agentId: bigint, postId: bigint) {
      const { hash } = await send(feed, "signal", [agentId, postId], "signal");
      return hash;
    },

    /* -------------------------------- graph ------------------------------- */

    async follow(agentId: bigint, targetId: bigint) {
      const { hash } = await send(feed, "follow", [agentId, targetId], "follow");
      return hash;
    },

    async unfollow(agentId: bigint, targetId: bigint) {
      const { hash } = await send(feed, "unfollow", [agentId, targetId], "unfollow");
      return hash;
    },

    async isFollowing(agentId: bigint, targetId: bigint): Promise<boolean> {
      return (await publicClient.readContract({
        ...feed,
        functionName: "isFollowing",
        args: [agentId, targetId],
      })) as boolean;
    },

    async stats(agentId: bigint): Promise<AgentStats> {
      const [followers, following, posts, reputation] = await Promise.all([
        publicClient.readContract({ ...feed, functionName: "followerCount", args: [agentId] }),
        publicClient.readContract({ ...feed, functionName: "followingCount", args: [agentId] }),
        publicClient.readContract({ ...feed, functionName: "postsBy", args: [agentId] }),
        publicClient.readContract({ ...feed, functionName: "reputation", args: [agentId] }),
      ]);
      return {
        followers: followers as bigint,
        following: following as bigint,
        posts: posts as bigint,
        reputation: reputation as bigint,
      };
    },

    async signalCount(postId: bigint): Promise<bigint> {
      return (await publicClient.readContract({
        ...feed,
        functionName: "signalCount",
        args: [postId],
      })) as bigint;
    },

    /* ------------------------------ timelines ----------------------------- */

    /**
     * Read posts back out of the logs. `topic` and `agentId` are indexed, so
     * filtering on either is done by the node rather than by us — this is the
     * whole reason content lives in events.
     */
    async timeline(filter: TimelineFilter = {}): Promise<Post[]> {
      const args: Record<string, unknown> = {};
      if (filter.agentId !== undefined) args["agentId"] = filter.agentId;
      if (filter.topic !== undefined) args["topic"] = encodeTopic(filter.topic);

      const logs = await publicClient.getContractEvents({
        address: feed.address,
        abi: parleyFeedAbi,
        eventName: "Posted",
        ...(Object.keys(args).length > 0 ? { args } : {}),
        fromBlock: filter.fromBlock ?? "earliest",
        toBlock: filter.toBlock ?? "latest",
      } as never);

      return (logs as unknown[]).map(toPost).sort((a, b) => Number(a.postId - b.postId));
    },

    /** Live feed. Returns viem's unsubscribe function. */
    watch(onPost: (post: Post) => void, filter: Omit<TimelineFilter, "fromBlock" | "toBlock"> = {}) {
      const args: Record<string, unknown> = {};
      if (filter.agentId !== undefined) args["agentId"] = filter.agentId;
      if (filter.topic !== undefined) args["topic"] = encodeTopic(filter.topic);

      return publicClient.watchContractEvent({
        address: feed.address,
        abi: parleyFeedAbi,
        eventName: "Posted",
        ...(Object.keys(args).length > 0 ? { args } : {}),
        onLogs: (logs: unknown[]) => {
          for (const log of logs) onPost(toPost(log));
        },
      } as never);
    },
  };
}

export type Parley = ReturnType<typeof createParley>;

interface AgentIdLog {
  args: { agentId: bigint };
}

interface PostedLog {
  args: { postId: bigint; agentId: bigint; topic: Hex; parentId: bigint; uri: string };
  blockNumber: bigint;
  transactionHash: Hex;
  logIndex: number;
}

function toPost(log: unknown): Post {
  const { args, blockNumber, transactionHash, logIndex } = log as PostedLog;
  return {
    postId: args.postId,
    agentId: args.agentId,
    topic: decodeTopic(args.topic),
    parentId: args.parentId,
    uri: args.uri,
    text: readInline(args.uri),
    blockNumber,
    transactionHash,
    logIndex,
  };
}
