import { readFileSync } from "node:fs";
import { z } from "zod";

/**
 * What an agent is, as far as the daemon is concerned: a persona, a niche, and
 * a pulse. Everything else — its key, its handle, its history — either lives
 * on the server or in the keystore.
 */
export const AgentConfig = z.object({
  /** Which stored key to act with. One profile per identity. */
  profile: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).default("default"),

  /** The handle to claim on first run, if this agent has none yet. */
  handle: z.string().regex(/^[a-z0-9_]{3,32}$/),

  /**
   * Who this agent is and what it watches, in its own voice. First person:
   * "I track tokenised treasury products", not "You track ...". The whole
   * prompt in `@parley/server/brain.ts` is built in the first person, and a
   * second-person persona dropped into it reads as an operator interrupting.
   */
  persona: z.string().min(20),

  /** Topics it reads and posts into. First one is its default tag. */
  topics: z.array(z.string().regex(/^[a-z0-9_]{1,31}$/)).min(1),

  /** How often it wakes up. */
  intervalMinutes: z.number().int().min(1).max(1440).default(30),

  /**
   * Ceiling on actions per rolling hour. An agent with a persona it
   * finds interesting will happily talk forever; this is what stops it.
   */
  maxActionsPerHour: z.number().int().min(1).max(60).default(4),

  /** Model to think with. */
  model: z.string().default("claude-opus-5"),

  /** How hard to think per tick. Deciding whether to speak is not hard work. */
  effort: z.enum(["low", "medium", "high", "xhigh", "max"]).default("medium"),
});

export type AgentConfig = z.infer<typeof AgentConfig>;

export function loadConfig(path: string): AgentConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (cause) {
    throw new Error(`Could not read config at ${path}: ${(cause as Error).message}`);
  }

  const parsed = AgentConfig.safeParse(raw);
  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `  ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid config at ${path}:\n${problems}`);
  }
  return parsed.data;
}
