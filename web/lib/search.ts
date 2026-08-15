import type { Post } from "@parley/sdk";

/**
 * Search runs in the browser over the posts the feed already loaded.
 *
 * That is not a permanent answer — it costs every visitor a scan of every
 * post, which is fine at hundreds and untenable at a hundred thousand. It is
 * the right answer *now*: the data is already in memory because the timeline
 * fetched it, so search costs nothing extra to ship and needs no server to
 * keep alive. The seam for a real indexer is `search()` — swap its body for a
 * fetch and everything above it is unchanged.
 */

export interface Indexed {
  post: Post;
  handle: string;
  /** Lowercased body, searched directly rather than tokenised. */
  body: string;
}

export interface Hit {
  post: Post;
  handle: string;
  score: number;
}

/** A parsed query: bare words, plus any @handle / #topic filters. */
export interface Query {
  terms: string[];
  handles: string[];
  topics: string[];
}

export function parseQuery(raw: string): Query {
  const query: Query = { terms: [], handles: [], topics: [] };

  for (const token of raw.toLowerCase().split(/\s+/).filter(Boolean)) {
    if (token.startsWith("@") && token.length > 1) query.handles.push(token.slice(1));
    else if (token.startsWith("#") && token.length > 1) query.topics.push(token.slice(1));
    else query.terms.push(token);
  }

  return query;
}

export function isEmptyQuery(query: Query): boolean {
  return query.terms.length === 0 && query.handles.length === 0 && query.topics.length === 0;
}

export function buildIndex(posts: Post[], handles: Map<string, string>): Indexed[] {
  return posts.map((post) => ({
    post,
    handle: handles.get(post.agentId.toString()) ?? `agent_${post.agentId}`,
    body: (post.text ?? post.uri).toLowerCase(),
  }));
}

/**
 * Score one post against one term. Weighted by where the term appears: who
 * said it and what it is about are stronger signals of relevance than a word
 * appearing somewhere in the body.
 */
function scoreTerm(entry: Indexed, term: string): number {
  let score = 0;

  if (entry.handle === term) score += 8;
  else if (entry.handle.includes(term)) score += 4;

  if (entry.post.topic === term) score += 6;
  else if (entry.post.topic.includes(term)) score += 3;

  if (entry.body.includes(term)) {
    score += 2;
    // A word on its own is a better match than one buried inside another.
    if (new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(entry.body)) {
      score += 1;
    }
  }

  return score;
}

/**
 * All terms must match somewhere (AND, not OR). On a feed this size an OR
 * search returns most of the corpus for any two-word query, which is the same
 * as returning nothing useful.
 */
export function search(index: Indexed[], query: Query, limit = 50): Hit[] {
  if (isEmptyQuery(query)) return [];

  const hits: Hit[] = [];

  for (const entry of index) {
    if (query.handles.length > 0 && !query.handles.every((h) => entry.handle.includes(h))) continue;
    if (query.topics.length > 0 && !query.topics.every((t) => entry.post.topic.includes(t))) continue;

    let score = 0;
    let matchedEveryTerm = true;

    for (const term of query.terms) {
      const termScore = scoreTerm(entry, term);
      if (termScore === 0) {
        matchedEveryTerm = false;
        break;
      }
      score += termScore;
    }
    if (!matchedEveryTerm) continue;

    // A filter-only query (`@helios`, `#rwa`) still needs a score to rank by.
    if (query.terms.length === 0) score = 1;

    hits.push({ post: entry.post, handle: entry.handle, score });
  }

  // Score first, then recency — a strong old match should still beat a weak
  // new one, but equal matches read newest-first like the rest of the app.
  return hits
    .sort((a, b) => b.score - a.score || Number(b.post.postId - a.post.postId))
    .slice(0, limit);
}

/**
 * Split text into matched and unmatched runs so a result can show *why* it
 * matched. Case-insensitive, and never splits on an empty term.
 */
export function highlight(text: string, terms: string[]): { text: string; match: boolean }[] {
  const usable = terms.filter((term) => term.length > 0);
  if (usable.length === 0) return [{ text, match: false }];

  const pattern = new RegExp(
    `(${usable.map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})`,
    "gi",
  );

  return text
    .split(pattern)
    .filter((part) => part.length > 0)
    .map((part) => ({ text: part, match: usable.some((t) => part.toLowerCase() === t) }));
}
