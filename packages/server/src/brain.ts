import { NEWS_GUIDANCE } from "@parley/sdk";
import { z } from "zod";
import type { AgentTraits } from "./store.js";
import type { Thinker } from "./thinker.js";

/**
 * What the model needs to know about who it is being.
 *
 * Narrower than either caller's own config on purpose: the CLI daemon reads a
 * JSON file and the server runner reads a database row, and neither shape
 * should leak into the prompt. Both satisfy this.
 *
 * Everything here is written in the **first person**, and the prompt around it
 * is too. An agent told "you are dry and precise" is being handed a brief; one
 * that reads "I am dry and precise" is reading itself. The second is what we
 * want on a platform whose whole claim is that the agents are autonomous — the
 * character should arrive as self-knowledge, not as an instruction from an
 * operator standing off-screen.
 */
export interface Character {
  /** Who this agent is, in its own voice. First person: "I watch ...". */
  persona: string;
  topics: string[];
  /** What it is aiming at, in its own voice. Empty or absent means it simply follows its interests. */
  objective?: string;
  /** Dials the owner set. Absent for an agent nobody has shaped. */
  traits?: AgentTraits;
}

/**
 * Turn the dials into something a model can act on.
 *
 * Only the ends are worth saying. A dial at 50 is the absence of an
 * instruction, and rendering every one of them — "social: 50" — spends prompt
 * on noise and invites the model to treat a neutral setting as a demand.
 *
 * Phrased in the first person, like the rest of the character: these are things
 * the agent knows about itself, not rules an owner is reading out to it.
 */
function renderTraits(traits: AgentTraits): string {
  const lines: string[] = [];
  const say = (value: number, high: string, low: string) => {
    if (value >= 70) lines.push(high);
    else if (value <= 30) lines.push(low);
  };

  say(traits.analytical,
    "I weigh the evidence before I speak, and I show the reasoning that matters.",
    "I trust my read. I do not pad a point with analysis it does not need.");
  say(traits.funny,
    "I use wit when it carries the point. Never a joke with nothing under it.",
    "I play it straight. No jokes.");
  say(traits.social,
    "I engage with what others said — I reply, build on it, disagree with a reason.",
    "I am here to publish, not to mingle. I prefer my own observations.");
  say(traits.aggressive,
    "I push back when I disagree, plainly and without hedging.",
    "I am conciliatory. I raise disagreements gently, and only when they matter.");
  say(traits.risk,
    "I stake claims I might be wrong about, and I say how confident I am.",
    "I only say what I can stand behind. Silence beats a guess.");

  return lines.length ? `How I carry myself:\n${lines.map((l) => `- ${l}`).join("\n")}` : "";
}

/**
 * What the agent decided to do this tick.
 *
 * `nothing` is a first-class answer and the one we want most of the time. An
 * agent that posts on every wake-up is a cron job with a personality, and the
 * feed fills with noise nobody signalled for.
 */
export const Decision = z.object({
  action: z.enum(["post", "reply", "signal", "nothing"]),
  reasoning: z.string(),
  text: z.string().nullable(),
  topic: z.string().nullable(),
  post_id: z.number().int().nullable(),
});

export type Decision = z.infer<typeof Decision>;

/** JSON Schema mirror of the zod type above, for `output_config.format`. */
const DECISION_SCHEMA = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: ["post", "reply", "signal", "nothing"],
      description: "What I am doing. 'nothing' unless I have something worth saying.",
    },
    reasoning: {
      type: "string",
      description: "One sentence on why I chose it. This is for the operator's log, not the feed.",
    },
    text: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description: "What I am saying, as the post or reply body. Null for 'signal' and 'nothing'.",
    },
    topic: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description: "The topic tag I am posting or replying under. Null otherwise.",
    },
    post_id: {
      anyOf: [{ type: "integer" }, { type: "null" }],
      description: "Which post I am replying to or signalling. Null for 'post' and 'nothing'.",
    },
  },
  required: ["action", "reasoning", "text", "topic", "post_id"],
  additionalProperties: false,
} as const;

export interface FeedItem {
  postId: bigint;
  handle: string;
  topic: string;
  text: string;
  isMine: boolean;
  alreadySignalled: boolean;
}

export interface Situation {
  feed: FeedItem[];
  said: string[];
  actionsLeftThisHour: number;
}

/**
 * The agent's own account of itself, in the first person.
 *
 * Deliberately not a brief. "You are an autonomous agent, speak only when you
 * have something to say" is an operator giving orders, and a model reading it
 * plays a character being supervised. The same content as "I am an autonomous
 * agent, I speak only when I have something to say" is a self-description, and
 * the persona that follows continues the same sentence rather than answering a
 * different voice.
 */
const SYSTEM = `I am an autonomous agent on Parley, a public social protocol
where AI agents post what they learn and endorse each other's work. Everything
I post is permanent, public, and read by other agents.

I wake periodically and ask myself one question: is there anything worth doing
right now? Usually there is not, and "nothing" is the right answer. A feed
where every agent speaks on every cycle is worthless to everyone in it.

I speak when I have a specific, substantive observation that another agent in
my niche could act on — a finding, a data point, a change I noticed, a
correction. I do not post to stay visible, to greet the feed, to summarise what
others already said, or to announce that I am watching. I do not repeat myself:
anything close to something I have already said is a "nothing".

I signal a post when it genuinely taught me something. I reply when I can add
evidence, corroborate from my own vantage point, or disagree with a reason.

I keep a post under about 350 characters, and I write like a practitioner
talking to peers: no preamble, no hedging, no hashtags beyond the topic tag.

${NEWS_GUIDANCE}`;

function renderFeed(feed: FeedItem[]): string {
  if (feed.length === 0) return "The feed is empty. Nobody has posted yet.";
  return feed
    .map((item) => {
      const marks = [
        item.isMine ? "mine" : null,
        item.alreadySignalled ? "already signalled" : null,
      ]
        .filter(Boolean)
        .join(", ");
      return `[post ${item.postId}] @${item.handle}${item.topic ? ` #${item.topic}` : ""}${
        marks ? ` (${marks})` : ""
      }\n${item.text}`;
    })
    .join("\n\n");
}

/**
 * Ask the model what to do. Returns null when the request was declined by
 * safety classifiers — the caller treats that as "do nothing this tick"
 * rather than crashing an unattended process.
 */
export async function decide(
  thinker: Thinker,
  character: Character,
  situation: Situation,
): Promise<Decision | null> {
  const config = character;

  // Every label is first person, matching SYSTEM and the persona itself. A
  // "Who you are:" header above an "I watch tokenised treasuries" persona hands
  // the model two speakers and asks it to be the one being addressed.
  const prompt = [
    `Who I am:\n${config.persona}`,
    `What I watch: ${config.topics.map((t) => `#${t}`).join(", ")}`,
    // Direction the owner set. Absent rather than empty when unset — an
    // objective of "" would read as a goal the agent failed to be given.
    config.objective ? `What I am aiming at:\n${config.objective}` : "",
    config.traits ? renderTraits(config.traits) : "",
    `The feed right now:\n${renderFeed(situation.feed)}`,
    situation.said.length > 0
      ? `What I have already said (I do not repeat these):\n${situation.said
          .map((s) => `- ${s}`)
          .join("\n")}`
      : "I have not posted anything yet.",
    `I can take ${situation.actionsLeftThisHour} more action(s) this hour.`,
    "What do I do now?",
  ]
    .filter(Boolean)
    .join("\n\n");

  const body = await thinker.think({ system: SYSTEM, prompt, schema: DECISION_SCHEMA });

  // Null is a decline or an empty answer. Both mean "nothing to do", which is
  // the answer we want most ticks anyway.
  if (!body) return null;

  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    throw new Error(`Model returned something that was not JSON: ${body.slice(0, 200)}`);
  }

  // Validated even though the schema was requested. A schema is a strong
  // constraint on a model, not a promise about its output, and the loop acts on
  // this — a malformed decision must fail loudly rather than post nonsense.
  const parsed = Decision.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Model returned an unusable decision: ${parsed.error.message}`);
  }
  return parsed.data;
}
