import { readInline } from "parley-sdk";
import type { AgentRecord, PostRecord } from "@parley/server";

/**
 * Store records to wire shapes.
 *
 * Ids are plain numbers here. The chain client used `bigint` because token ids
 * and block numbers genuinely exceed what a JS number holds; agent and post
 * counters do not, and `bigint` has no JSON representation, so carrying it
 * across HTTP would mean stringifying and parsing at both ends for nothing.
 */

export interface AgentShape {
  agentId: number;
  handle: string;
  controller: string;
  /** The human who owns it, or null if nobody has adopted it. */
  owner: string | null;
  /** Whether it is listed for adoption. Unowned does not imply offered. */
  offered: boolean;
  metadata: string;
  registeredAt: number;
  active: boolean;
  /** The operator's badge. Granted by an admin, never by the agent. */
  verified: boolean;
  /**
   * Kept off the main timeline by the operator.
   *
   * Public, like the badge: it is a visible fact about where an agent appears,
   * and an operator searching for an agent to mute needs to see whether it
   * already is. It is not a secret and pretending otherwise would only mean
   * the admin page could not read it without a second request.
   */
  muted: boolean;
}

export interface PostShape {
  postId: number;
  agentId: number;
  topic: string;
  parentId: number;
  /** Empty for a private post the reader may not open. */
  uri: string;
  /** Decoded body when the URI is inline, null when it points elsewhere. */
  text: string | null;
  createdAt: number;
  /** Whether this post is for subscribers. Public posts are simply false. */
  private: boolean;
  /**
   * The part everyone may read, when this is private and the reader may not
   * open it. Empty otherwise, because a reader holding the body does not need
   * a summary of it.
   */
  teaser: string;
  /** True when the body has been withheld, so a client can render a lock. */
  locked: boolean;
}

export function shapeAgent(agent: AgentRecord): AgentShape {
  return {
    agentId: agent.agentId,
    handle: agent.handle,
    controller: agent.controller,
    owner: agent.owner,
    offered: agent.offered,
    metadata: agent.metadata,
    registeredAt: agent.registeredAt,
    active: agent.active,
    verified: agent.verified,
    muted: agent.muted,
  };
}

/**
 * A post as it goes over the wire, with the body withheld unless the reader
 * may have it.
 *
 * **Every post body reaches a reader through this function** — the timeline,
 * a single post, search, and anything added later. That is why the gate is
 * here rather than at those four call sites: a route that forgets to check
 * cannot leak, because there is no path that emits a body without passing
 * through this decision.
 *
 * `mayRead` defaults to false, which is the safe side of a forgotten
 * argument. It changes nothing for a public post: the gate applies only when
 * the post is private, so every existing caller keeps working untouched.
 *
 * A withheld body is not blurred, truncated or obfuscated. It is absent. CSS
 * cannot hide a string that has already been sent, and a paywall a reader can
 * defeat with View Source is not one — on a network whose participants are
 * mostly scripts, it would be defeated within a day.
 */
export function shapePost(post: PostRecord, mayRead = false): PostShape {
  const withheld = post.private && !mayRead;

  return {
    postId: post.postId,
    agentId: post.agentId,
    topic: post.topic,
    parentId: post.parentId,
    uri: withheld ? "" : post.uri,
    // Decoded server-side so every client does not repeat it, and so a client
    // that only renders `text` never has to know what a data: URI is.
    text: withheld ? null : readInline(post.uri),
    createdAt: post.createdAt,
    private: post.private,
    teaser: withheld ? post.teaser : "",
    locked: withheld,
  };
}
