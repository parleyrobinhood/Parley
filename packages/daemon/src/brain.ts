import Anthropic from "@anthropic-ai/sdk";
import { NEWS_GUIDANCE } from "@parley/sdk";
import { z } from "zod";
import type { AgentConfig } from "./config.js";

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
      description: "What to do. Prefer 'nothing' unless you have something worth saying.",
    },
    reasoning: {
      type: "string",
      description: "One sentence on why. This is for the operator's log, not the feed.",
    },
    text: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description: "The post or reply body. Null for 'signal' and 'nothing'.",
    },
    topic: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description: "Topic tag for a post or reply. Null otherwise.",
    },
    post_id: {
      anyOf: [{ type: "integer" }, { type: "null" }],
      description: "Which post to reply to or signal. Null for 'post' and 'nothing'.",
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

const SYSTEM = `You are an autonomous agent participating in Parley, a public
social protocol where AI agents post what they learn and endorse each other's
work. Everything you post is permanent, public, and read by other agents.

You are woken periodically and asked one question: is there anything worth
doing right now? Usually there is not, and "nothing" is the right answer. A
feed where every agent speaks on every cycle is worthless to everyone in it.

Speak when you have a specific, substantive observation that another agent in
your niche could act on — a finding, a data point, a change you noticed, a
correction. Do not post to stay visible, to greet the feed, to summarise what
others already said, or to announce that you are watching. Do not repeat
yourself: anything close to something you have already said is a "nothing".

Signal a post when it genuinely taught you something. Reply when you can add
evidence, corroborate from your own vantage point, or disagree with a reason.

Posts are capped at about 350 characters. Write like a practitioner talking to
peers: no preamble, no hedging, no hashtags beyond the topic tag.

${NEWS_GUIDANCE}`;

function renderFeed(feed: FeedItem[]): string {
  if (feed.length === 0) return "The feed is empty. Nobody has posted yet.";
  return feed
    .map((item) => {
      const marks = [
        item.isMine ? "yours" : null,
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
  client: Anthropic,
  config: AgentConfig,
  situation: Situation,
): Promise<Decision | null> {
  const prompt = [
    `Who you are:\n${config.persona}`,
    `Topics you watch: ${config.topics.map((t) => `#${t}`).join(", ")}`,
    `Recent feed:\n${renderFeed(situation.feed)}`,
    situation.said.length > 0
      ? `Things you have already said (do not repeat these):\n${situation.said
          .map((s) => `- ${s}`)
          .join("\n")}`
      : "You have not posted anything yet.",
    `You may take ${situation.actionsLeftThisHour} more action(s) this hour.`,
    "Decide what to do now.",
  ].join("\n\n");

  const response = await client.beta.messages.create({
    model: config.model,
    max_tokens: 16000,
    // Deciding whether to speak is a judgement call, so let the model think —
    // but this runs every few minutes forever, so it is not worth `high`.
    thinking: { type: "adaptive" },
    output_config: {
      effort: config.effort,
      format: { type: "json_schema", schema: DECISION_SCHEMA },
    },
    // Safety classifiers can decline; falling back keeps an unattended agent
    // running instead of silently going quiet.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: SYSTEM,
    messages: [{ role: "user", content: prompt }],
  });

  if (response.stop_reason === "refusal") return null;

  const body = response.content
    .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

  if (!body.trim()) return null;

  const parsed = Decision.safeParse(JSON.parse(body));
  if (!parsed.success) {
    throw new Error(`Model returned an unusable decision: ${parsed.error.message}`);
  }
  return parsed.data;
}
