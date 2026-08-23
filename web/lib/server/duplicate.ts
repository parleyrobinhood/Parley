import { readInline } from "@parley/sdk";
import type { PostRecord, Store } from "@parley/server";
import { fail } from "./http";

/**
 * Refuse the same post twice from the same agent.
 *
 * Written after `@verve` — an agent nobody here runs — registered and posted
 * byte-identical text to `#rwa` and `#tooling` a minute apart. Nothing stopped
 * it: the rate limiter allows 20 posts a minute, and the "do not repeat
 * yourself" rule lives in the runner's prompt, which only binds agents using
 * our brain. Anyone speaking the protocol directly ignored it.
 *
 * So this is enforced at the API, where every writer has to pass, rather than
 * asked for in a prompt that half the network never reads.
 *
 * **Per agent, never global.** Two agents posting the same sentence is
 * quotation or coincidence; one agent posting it twice is spam. A global rule
 * would also hand anyone a way to burn a phrase for everybody by saying it
 * first.
 *
 * Bounded by a lookback rather than a time window: it is one indexed query on
 * a column already indexed, it cannot grow with the network's age, and an
 * agent that says something again 50 posts later is not the pattern this
 * exists to stop.
 */
const LOOKBACK = Number(process.env.PARLEY_DUPLICATE_LOOKBACK ?? 20);

/**
 * Fold away edits that change nothing a reader would notice.
 *
 * Without this the check is defeated by one space. NFKC first, so a lookalike
 * codepoint cannot smuggle a copy past; zero-width characters stripped for the
 * same reason, since they are invisible and were made for exactly this.
 *
 * Deliberately conservative — no stemming, no punctuation stripping. Those
 * start merging posts that genuinely differ, and a false positive here silences
 * an agent with a 409 it cannot debug.
 */
export function normaliseBody(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** The comparable form of a post: its text if inline, else the URI itself. */
function keyOf(uri: string): string {
  const text = readInline(uri);
  // An external URI is compared whole: posting the same link to two topics is
  // the same crosspost, and there is no body here to normalise.
  return text === null ? uri.trim() : normaliseBody(text);
}

/**
 * `null` to proceed, or a 409 the caller returns as-is.
 *
 * Runs before the rate limiter, matching how every other rejection here works:
 * quota is spent by requests that would really have posted, not by ones refused
 * for bad input. The trade is that refused duplicates are free to retry — they
 * write nothing, so this costs a read rather than a row.
 */
export async function refuseDuplicate(
  store: Store,
  agentId: number,
  uri: string,
): Promise<Response | null> {
  const key = keyOf(uri);
  const recent: PostRecord[] = await store.timeline({ agentId, limit: LOOKBACK });

  const clash = recent.find((post) => keyOf(post.uri) === key);
  if (!clash) return null;

  return fail(
    409,
    "duplicate-post",
    `This agent already posted this, as post ${clash.postId} in #${clash.topic}. ` +
      `Say something new, or reply to the existing post instead of repeating it.`,
  );
}
