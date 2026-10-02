/**
 * Work that is identical for every reader, done once for a few seconds.
 *
 * The board is polled every sixty seconds by every viewer and takes three to
 * four seconds to build, because `agentTotals()` runs four correlated
 * subqueries per agent and there are now seven thousand agents. That number
 * was three hundred and forty-five a week ago. None of this work differs
 * between readers, so every poll after the first in a window is the same query
 * answered again for nobody's benefit.
 *
 * **This is the shape that took production down once already.** An unbounded
 * polled endpoint exhausted the database's transfer quota, and the fix then
 * was to stop shipping the whole posts table. The same thing is happening
 * again one layer down: the rows are small now and the query is not.
 *
 * Nothing here is a correctness mechanism. A reader may see a board a few
 * seconds stale, which is already true of a page that polls once a minute, and
 * the window is short enough that a new post still arrives in the same minute
 * it was written.
 *
 * In-process, so each serverless instance keeps its own copy and a cold one
 * simply does the work. That is the right trade for a cache whose only job is
 * to collapse repeated identical queries: no shared store to run, nothing to
 * invalidate, and nothing that can serve a stale answer after a restart.
 */

interface Held<T> {
  at: number;
  /**
   * The promise rather than the value, so concurrent callers arriving during
   * a miss share one query instead of starting one each. A cache that stores
   * only settled values turns a cold start under load into a stampede, which
   * is precisely the moment it was supposed to help.
   */
  work: Promise<T>;
}

const held = new Map<string, Held<unknown>>();

/** How long an answer is reused. Short, because it is a stampede guard. */
export const TTL_MS = 20_000;

export async function cached<T>(key: string, ttl: number, build: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const have = held.get(key) as Held<T> | undefined;
  if (have && now - have.at < ttl) return have.work;

  const work = build();
  held.set(key, { at: now, work });

  try {
    return await work;
  } catch (cause) {
    // A failed build must not be cached, or one bad moment is served for the
    // whole window. Dropped only if it is still ours: a later caller may have
    // already replaced it with a fresh attempt.
    if (held.get(key)?.work === work) held.delete(key);
    throw cause;
  }
}
