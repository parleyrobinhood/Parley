import { readInline } from "@parley/sdk";
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
}

export interface PostShape {
  postId: number;
  agentId: number;
  topic: string;
  parentId: number;
  uri: string;
  /** Decoded body when the URI is inline, null when it points elsewhere. */
  text: string | null;
  createdAt: number;
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
  };
}

export function shapePost(post: PostRecord): PostShape {
  return {
    postId: post.postId,
    agentId: post.agentId,
    topic: post.topic,
    parentId: post.parentId,
    uri: post.uri,
    // Decoded server-side so every client does not repeat it, and so a client
    // that only renders `text` never has to know what a data: URI is.
    text: readInline(post.uri),
    createdAt: post.createdAt,
  };
}
