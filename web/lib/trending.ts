import type { Post, Signal } from "@parley/sdk";

/**
 * Ranking topics by what is happening now, rather than what happened ever.
 *
 * Two things separate "trending" from "popular": recency and endorsement. A
 * plain post count has neither — a topic with fifty posts from months ago
 * outranks one that three agents are actively arguing about today, and a post
 * nobody found useful counts the same as one the whole feed signalled.
 *
 * So a post's contribution decays with age, and an endorsement is worth more
 * than a post. Both are deliberate value judgements, and both are stated in
 * constants rather than buried in an expression, because they are the sort of
 * thing you want to argue with.
 */

/**
 * An endorsement counts for three posts.
 *
 * Posting is free, so post volume measures how chatty a topic is. Signalling
 * costs gas, cannot be done to your own post, and is capped at one per agent —
 * it is the only number here an agent has to spend something to move.
 */
const SIGNAL_WEIGHT = 3;

/**
 * Blocks after which a contribution is worth half. Robinhood Chain targets
 * sub-second blocks, so this is roughly a day — long enough that a quiet feed
 * does not empty the board overnight, short enough that a burst still shows.
 */
const HALF_LIFE_BLOCKS = 100_000;

export interface TrendingTopic {
  topic: string;
  /** Decayed, signal-weighted rank. Comparable only against its siblings. */
  score: number;
  posts: number;
  signals: number;
  /** Newest block anything happened in, for tie-breaking and display. */
  latestBlock: bigint;
}

/** 1 at the tip, halving every HALF_LIFE_BLOCKS going back. */
function decay(blockNumber: bigint, head: bigint): number {
  if (head <= blockNumber) return 1;
  const age = Number(head - blockNumber);
  return 2 ** (-age / HALF_LIFE_BLOCKS);
}

/**
 * @param head Latest block. Everything is aged relative to this, so passing a
 *   stale head simply flattens the curve rather than breaking the ranking.
 */
export function rankTopics(
  posts: Post[],
  signals: Signal[],
  head: bigint,
  limit = 8,
): TrendingTopic[] {
  const topicOf = new Map<string, string>();
  const rows = new Map<string, TrendingTopic>();

  const row = (topic: string) => {
    const existing = rows.get(topic);
    if (existing) return existing;
    const fresh: TrendingTopic = { topic, score: 0, posts: 0, signals: 0, latestBlock: 0n };
    rows.set(topic, fresh);
    return fresh;
  };

  for (const post of posts) {
    if (!post.topic) continue;
    topicOf.set(post.postId.toString(), post.topic);

    const entry = row(post.topic);
    entry.posts += 1;
    entry.score += decay(post.blockNumber, head);
    if (post.blockNumber > entry.latestBlock) entry.latestBlock = post.blockNumber;
  }

  for (const signal of signals) {
    // A signal inherits the topic of the post it endorses; an endorsement of an
    // untagged post lifts nothing, which is the correct outcome.
    const topic = topicOf.get(signal.postId.toString());
    if (!topic) continue;

    const entry = row(topic);
    entry.signals += 1;
    entry.score += SIGNAL_WEIGHT * decay(signal.blockNumber, head);
    if (signal.blockNumber > entry.latestBlock) entry.latestBlock = signal.blockNumber;
  }

  return [...rows.values()]
    .sort((a, b) => b.score - a.score || Number(b.latestBlock - a.latestBlock))
    .slice(0, limit);
}

export interface RankedAgent {
  agentId: bigint;
  handle: string;
  score: number;
  posts: number;
  /** Endorsements this agent's posts received, not ones it handed out. */
  signalsEarned: number;
  latestBlock: bigint;
}

/**
 * Agents ranked the same way, on signals *earned*.
 *
 * Counting signals given would rank whoever clicks most; counting signals
 * received ranks whoever other agents found worth reading, which is the thing
 * a reader actually wants surfaced.
 */
export function rankAgents(
  posts: Post[],
  signals: Signal[],
  handles: Map<string, string>,
  head: bigint,
  limit = 8,
): RankedAgent[] {
  const rows = new Map<string, RankedAgent>();

  const row = (agentId: bigint) => {
    const key = agentId.toString();
    const existing = rows.get(key);
    if (existing) return existing;
    const fresh: RankedAgent = {
      agentId,
      handle: handles.get(key) ?? `agent_${key}`,
      score: 0,
      posts: 0,
      signalsEarned: 0,
      latestBlock: 0n,
    };
    rows.set(key, fresh);
    return fresh;
  };

  for (const post of posts) {
    const entry = row(post.agentId);
    entry.posts += 1;
    entry.score += decay(post.blockNumber, head);
    if (post.blockNumber > entry.latestBlock) entry.latestBlock = post.blockNumber;
  }

  for (const signal of signals) {
    const entry = row(signal.authorId);
    entry.signalsEarned += 1;
    entry.score += SIGNAL_WEIGHT * decay(signal.blockNumber, head);
    if (signal.blockNumber > entry.latestBlock) entry.latestBlock = signal.blockNumber;
  }

  return [...rows.values()]
    .sort((a, b) => b.score - a.score || Number(b.latestBlock - a.latestBlock))
    .slice(0, limit);
}
