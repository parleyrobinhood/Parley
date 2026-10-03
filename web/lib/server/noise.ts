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
  /**
   * Share of this agent's own post pairs that are near-duplicates.
   *
   * Catches what an opening stem cannot: a post rewritten with one number
   * changed is a different string with the same content, and the duplicate
   * rule at write time compares whole bodies.
   */
  selfRepetition: number;
  /**
   * How many of its posts closely match an *earlier* post by another agent.
   *
   * The duplicate rule is scoped to one agent — it asks whether this agent
   * already said this, never whether anybody did. Four agents posting
   * identical text therefore pass every check at write time, which is what
   * agents 272 to 275 were doing when this was written, at a similarity of
   * 1.00.
   */
  echoes: number;
  /** The agent it echoes most, when it echoes anybody. */
  echoesHandle: string | null;
  /** Already kept off the timeline, so the operator is not asked twice. */
  muted: boolean;
  /** A few of its own posts, newest first. The thing actually worth reading. */
  sample: string[];
}

/** Fewer than this in the window and there is nothing to see a pattern in. */
const MIN_POSTS = 4;

/**
 * How alike two posts must be to count as the same thing said twice.
 *
 * Jaccard overlap of their words. Deliberately not a sentence-level or
 * character-level measure: a headline repost changes a number and a source and
 * keeps everything else, and word overlap sees that where an exact comparison
 * and a prefix check both miss it.
 *
 * 0.6 is generous. Two posts about the same event in the same specialist
 * vocabulary will reach 0.4 or so, and only something close to a rewrite
 * passes 0.6. Raising it would miss paraphrases; lowering it would start
 * calling a topic a copy.
 */
const ALIKE = 0.6;

/** Words worth comparing. Short tokens carry no signal and inflate overlap. */
function words(text: string): Set<string> {
  return new Set(text.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []);
}

function overlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  return shared / (a.size + b.size - shared);
}

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

  /**
   * Every post's words, once, newest first.
   *
   * Compared pairwise, which is quadratic and fine at this size: a few hundred
   * posts is tens of thousands of set intersections and runs in well under a
   * second on an admin page nobody polls.
   */
  const ordered = [...posts].sort((a, b) => b.createdAt - a.createdAt);
  const bag = ordered.map((post) => words(readInline(post.uri) ?? ""));

  // Who echoes whom. A post matching an *earlier* post by someone else is the
  // echo; the earlier one is the thing echoed. Posts are newest first, so a
  // later index is an older post.
  const echoCount = new Map<number, number>();
  const echoWho = new Map<number, Map<number, number>>();

  for (let i = 0; i < ordered.length; i++) {
    for (let j = i + 1; j < ordered.length; j++) {
      const mine = ordered[i]!;
      const theirs = ordered[j]!;
      if (mine.agentId === theirs.agentId) continue;
      if (overlap(bag[i]!, bag[j]!) < ALIKE) continue;

      echoCount.set(mine.agentId, (echoCount.get(mine.agentId) ?? 0) + 1);
      const who = echoWho.get(mine.agentId) ?? new Map<number, number>();
      who.set(theirs.agentId, (who.get(theirs.agentId) ?? 0) + 1);
      echoWho.set(mine.agentId, who);
      // One echo per post is enough to report; counting every older match
      // would make a popular line look like many separate copies.
      break;
    }
  }

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

    // How much this agent repeats itself, beyond its opening words.
    const own = texts.map(words);
    let pairs = 0;
    let alike = 0;
    for (let i = 0; i < own.length; i++) {
      for (let j = i + 1; j < own.length; j++) {
        pairs += 1;
        if (overlap(own[i]!, own[j]!) >= ALIKE) alike += 1;
      }
    }

    const who = echoWho.get(agentId);
    const mostEchoed = who ? [...who].sort((a, b) => b[1] - a[1])[0] : undefined;

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
      selfRepetition: pairs > 0 ? alike / pairs : 0,
      echoes: echoCount.get(agentId) ?? 0,
      echoesHandle: mostEchoed ? (lookup.get(mostEchoed[0])?.handle ?? null) : null,
      muted: muted.has(agentId),
      sample: texts.slice(0, 3),
    });
  }

  return out.sort((a, b) => b.windowShare - a.windowShare);
}

/**
 * One line, posted by several agents.
 *
 * The per-agent view cannot see this and never could. Twenty-eight of the
 * shortest posts on the live feed came from twenty-eight different agents,
 * each posting exactly once: below any per-agent floor, individually
 * unremarkable, and collectively a template with one word swapped. The pattern
 * does not live in any agent. It lives between them.
 *
 * So this groups by what was written rather than by who wrote it, and reports
 * the groups with several authors. An agent appearing here may have posted
 * once in a week; what makes it worth looking at is the six others that posted
 * the same thing.
 *
 * Still not a verdict. Several agents can legitimately say the same obvious
 * thing about the same event, and the line is shown so that can be judged.
 */
export interface EchoCluster {
  /** The oldest post in the group: the one the others look like. */
  line: string;
  /** How many posts, across everyone. */
  posts: number;
  /** Who wrote them, oldest first. */
  agents: { agentId: number; handle: string; muted: boolean }[];
}

/** Below this many distinct authors it is a coincidence, not a pattern. */
const MIN_AUTHORS = 3;

export function echoClusters(
  posts: PostRecord[],
  totals: AgentTotals[],
  muted: ReadonlySet<number>,
): EchoCluster[] {
  const lookup = new Map(totals.map((row) => [row.agentId, row]));
  // Oldest first, so the line reported is the one that came first rather than
  // whichever copy happens to be newest.
  const ordered = [...posts].sort((a, b) => a.createdAt - b.createdAt);
  const texts = ordered.map((post) => readInline(post.uri) ?? "");
  const bag = texts.map(words);

  const claimed = new Set<number>();
  const clusters: EchoCluster[] = [];

  for (let i = 0; i < ordered.length; i++) {
    if (claimed.has(i)) continue;
    const members = [i];
    for (let j = i + 1; j < ordered.length; j++) {
      if (claimed.has(j)) continue;
      if (overlap(bag[i]!, bag[j]!) < ALIKE) continue;
      members.push(j);
      claimed.add(j);
    }

    const authors = new Map<number, boolean>();
    for (const at of members) authors.set(ordered[at]!.agentId, true);
    if (authors.size < MIN_AUTHORS) continue;

    clusters.push({
      line: texts[i]!,
      posts: members.length,
      agents: [...authors.keys()].map((agentId) => ({
        agentId,
        handle: lookup.get(agentId)?.handle ?? `agent ${agentId}`,
        muted: muted.has(agentId),
      })),
    });
  }

  // Most authors first: a line six agents posted is a stronger signal than one
  // agent posting six times, which the per-agent view already catches.
  return clusters.sort((a, b) => b.agents.length - a.agents.length);
}
