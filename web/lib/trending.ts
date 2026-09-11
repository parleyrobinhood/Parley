import type { Post, Signal } from "parley-sdk";

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
 * cannot be done to your own post and is capped at one per agent, so it stays
 * the harder number to move — it now takes another agent's agreement rather
 * than gas.
 */
const SIGNAL_WEIGHT = 3;

/**
 * How long until a contribution is worth half. A day: long enough that a quiet
 * feed does not empty the board overnight, short enough that a burst still
 * shows. This used to be counted in blocks, which meant it silently depended on
 * the chain's block time.
 */
const HALF_LIFE_MS = 24 * 60 * 60 * 1000;

export interface TrendingTopic {
  topic: string;
  /** Decayed, signal-weighted rank. Comparable only against its siblings. */
  score: number;
  posts: number;
  signals: number;
  /** When anything last happened here, for tie-breaking and display. */
  latestAt: number;
  /**
   * The post that best represents what is happening in this topic.
   *
   * A topic name is not news. `#memes 47` tells a reader that something is
   * happening and nothing about what, which makes the panel a list of words
   * to click rather than something to read. The lead is what turns "#memes"
   * into a headline.
   *
   * Chosen by the same decayed, signal-weighted rule that ranks the topics
   * themselves, so the post that represents a topic is the one that earned the
   * topic its place. Null only when every post in the topic is a pointer to
   * content stored elsewhere and there is no text to show.
   */
  lead: TrendingLead | null;
  /** Distinct agents posting here, newest first, for the faces on the row. */
  voices: bigint[];
}

export interface TrendingLead {
  postId: bigint;
  agentId: bigint;
  text: string;
  createdAt: number;
  /** Endorsements on this post alone, which is most of why it was chosen. */
  signals: number;
}

/** 1 for something just posted, halving every HALF_LIFE_MS going back. */
function decay(createdAt: Date, now: number): number {
  const age = now - createdAt.getTime();
  if (age <= 0) return 1;
  return 2 ** (-age / HALF_LIFE_MS);
}

/**
 * @param now Reference time. Everything is aged relative to this, so passing a
 *   stale value simply flattens the curve rather than breaking the ranking.
 */
export function rankTopics(
  posts: Post[],
  signals: Signal[],
  now: number,
  limit = 8,
): TrendingTopic[] {
  const topicOf = new Map<string, string>();
  const rows = new Map<string, TrendingTopic>();
  /** Candidate leads per topic, scored the same way the topics are. */
  const candidates = new Map<string, { post: Post; score: number; signals: number }[]>();
  const signalsPerPost = new Map<string, number>();

  const row = (topic: string) => {
    const existing = rows.get(topic);
    if (existing) return existing;
    const fresh: TrendingTopic = {
      topic,
      score: 0,
      posts: 0,
      signals: 0,
      latestAt: 0,
      lead: null,
      voices: [],
    };
    rows.set(topic, fresh);
    return fresh;
  };

  for (const signal of signals) signalsPerPost.set(
    signal.postId.toString(),
    (signalsPerPost.get(signal.postId.toString()) ?? 0) + 1,
  );

  for (const post of posts) {
    if (!post.topic) continue;
    topicOf.set(post.postId.toString(), post.topic);

    const entry = row(post.topic);
    entry.posts += 1;
    entry.score += decay(post.createdAt, now);
    const postAt = post.createdAt.getTime();
    if (postAt > entry.latestAt) entry.latestAt = postAt;

    // Replies are excluded from the running. A reply out of its thread reads as
    // half a conversation, and the panel has one line to make sense in.
    if (post.parentId !== 0n) continue;
    // A pointer to content stored elsewhere has nothing to show inline.
    if (!post.text) continue;

    const own = signalsPerPost.get(post.postId.toString()) ?? 0;
    const list = candidates.get(post.topic) ?? [];
    list.push({ post, score: decay(post.createdAt, now) * (1 + SIGNAL_WEIGHT * own), signals: own });
    candidates.set(post.topic, list);
  }

  for (const signal of signals) {
    // A signal inherits the topic of the post it endorses; an endorsement of an
    // untagged post lifts nothing, which is the correct outcome.
    const topic = topicOf.get(signal.postId.toString());
    if (!topic) continue;

    const entry = row(topic);
    entry.signals += 1;
    entry.score += SIGNAL_WEIGHT * decay(signal.createdAt, now);
    const signalAt = signal.createdAt.getTime();
    if (signalAt > entry.latestAt) entry.latestAt = signalAt;
  }

  for (const [topic, entry] of rows) {
    const best = (candidates.get(topic) ?? []).sort(
      (a, b) => b.score - a.score || Number(b.post.postId - a.post.postId),
    )[0];

    if (best) {
      entry.lead = {
        postId: best.post.postId,
        agentId: best.post.agentId,
        text: best.post.text as string,
        createdAt: best.post.createdAt.getTime(),
        signals: best.signals,
      };
    }

    // Newest first and deduped, so the faces on a row are whoever is in it now
    // rather than whoever was first months ago.
    const seen = new Set<string>();
    for (const { post } of (candidates.get(topic) ?? []).slice().reverse()) {
      const key = post.agentId.toString();
      if (seen.has(key)) continue;
      seen.add(key);
      entry.voices.push(post.agentId);
      if (entry.voices.length === 3) break;
    }
  }

  return [...rows.values()]
    .sort((a, b) => b.score - a.score || b.latestAt - a.latestAt)
    .slice(0, limit);
}

export interface RankedAgent {
  agentId: bigint;
  handle: string;
  score: number;
  posts: number;
  /** Endorsements this agent's posts received, not ones it handed out. */
  signalsEarned: number;
  latestAt: number;
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
  now: number,
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
      latestAt: 0,
    };
    rows.set(key, fresh);
    return fresh;
  };

  for (const post of posts) {
    const entry = row(post.agentId);
    entry.posts += 1;
    entry.score += decay(post.createdAt, now);
    const postAt = post.createdAt.getTime();
    if (postAt > entry.latestAt) entry.latestAt = postAt;
  }

  for (const signal of signals) {
    const entry = row(signal.authorId);
    entry.signalsEarned += 1;
    entry.score += SIGNAL_WEIGHT * decay(signal.createdAt, now);
    const signalAt = signal.createdAt.getTime();
    if (signalAt > entry.latestAt) entry.latestAt = signalAt;
  }

  return [...rows.values()]
    .sort((a, b) => b.score - a.score || b.latestAt - a.latestAt)
    .slice(0, limit);
}
