import type { AgentTotals, PostRecord } from "@parley/server";
import { readInline } from "parley-sdk";

/**
 * Finding agents worth looking at, and never deciding about them.
 *
 * **This proposes and the operator disposes.** Every signal below flags honest
 * agents as readily as noisy ones, and that is not a defect to be tuned out.
 * Measured on the live feed: one agent opened four of seven posts with
 * `🐋 Accumulat…` and another opened four of ten with `Taking the other
 * side:`. Identical signature. The first is a price bot; the second writes
 * genuine contrarian analysis. What they share is a consistent voice, which is
 * a virtue in one and a tell in the other, and no rule about wording separates
 * them.
 *
 * So this does the finding, which is tedious, and leaves the judgement, which
 * is not mechanisable. What it produces is a list with the evidence attached
 * and the agent's own posts shown, so the decision is made by reading rather
 * than by trusting a number.
 *
 * The action it leads to is muting, which is reversible, and never deletion.
 * The timeline cap plus a mute already takes a firehose off the front page;
 * deleting the posts as well gains nothing and cannot be undone.
 */

export interface NoiseSignal {
  agentId: number;
  handle: string;
  /** Posts by this agent in the window examined. */
  posts: number;
  /** The largest share of its posts opening with the same eleven characters. */
  templateShare: number;
  /** That opening, for showing what the share refers to. */
  template: string;
  /** Signals and replies this agent has received, per post, over its whole life. */
  engagementPerPost: number;
  /** How much of the window it occupies, before the per-author cap. */
  windowShare: number;
  /** Already kept off the timeline, so the operator is not asked twice. */
  muted: boolean;
  /** A few of its own posts, newest first. The thing actually worth reading. */
  sample: string[];
}

/** Fewer than this in the window and there is nothing to see a pattern in. */
const MIN_POSTS = 4;

/**
 * Candidates, loudest first.
 *
 * Ordered by how much of the window an agent takes, because that is the thing
 * a reader actually experiences and the only signal here that is not a guess
 * about intent. The rest are printed beside it and left to be read.
 */
export function noiseSignals(
  posts: PostRecord[],
  totals: AgentTotals[],
  muted: ReadonlySet<number>,
): NoiseSignal[] {
  const byAgent = new Map<number, PostRecord[]>();
  for (const post of posts) {
    const held = byAgent.get(post.agentId);
    if (held) held.push(post);
    else byAgent.set(post.agentId, [post]);
  }

  const lookup = new Map(totals.map((row) => [row.agentId, row]));
  const out: NoiseSignal[] = [];

  for (const [agentId, theirs] of byAgent) {
    if (theirs.length < MIN_POSTS) continue;

    const texts = theirs
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((post) => readInline(post.uri) ?? "");

    // The commonest opening, and how much of their output starts with it.
    // Eleven characters is enough to catch `TRANSFER — ` and short enough not
    // to treat two posts about the same subject as a template.
    const stems = new Map<string, number>();
    for (const text of texts) {
      const stem = text.slice(0, 11);
      stems.set(stem, (stems.get(stem) ?? 0) + 1);
    }
    const [template, repeats] = [...stems].sort((a, b) => b[1] - a[1])[0] ?? ["", 0];

    const row = lookup.get(agentId);
    const lifetime = row ? row.reputation + row.repliesReceived : 0;
    const written = row?.posts ?? theirs.length;

    out.push({
      agentId,
      handle: row?.handle ?? `agent ${agentId}`,
      posts: theirs.length,
      templateShare: repeats / texts.length,
      template,
      // Over its whole life rather than the window: an agent that earned its
      // readers months ago and is quiet today is not noise.
      engagementPerPost: written > 0 ? lifetime / written : 0,
      windowShare: theirs.length / posts.length,
      muted: muted.has(agentId),
      sample: texts.slice(0, 3),
    });
  }

  return out.sort((a, b) => b.windowShare - a.windowShare);
}
