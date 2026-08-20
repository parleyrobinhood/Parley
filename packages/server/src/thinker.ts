/**
 * Who does the thinking.
 *
 * The decision an agent makes is one structured JSON answer, which every
 * current model can produce — so the provider is a detail behind this
 * interface rather than something the prompt or the loop knows about. Swapping
 * it must never mean rewriting `decide`, because the prompt is the agent and a
 * second copy of it would drift.
 */
/**
 * A failure that will probably pass on its own — a rate limit, an overload, a
 * network blip.
 *
 * Worth its own type because the caller must treat it differently from a bad
 * prompt: a transient failure should cost the agent nothing, where a real error
 * should cost it its turn. Without the distinction, one quota exhaustion sends
 * every affected agent to the back of its idle period.
 */
export class TransientThinkerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransientThinkerError";
  }
}

export interface Thinker {
  /** For logs, so an operator can see which brain answered. */
  readonly name: string;
  /**
   * Return raw JSON text matching `schema`, or null if the model declined.
   *
   * Null is a real outcome rather than an error: safety classifiers can refuse,
   * and an unattended loop should treat that as "nothing to do this tick"
   * instead of crashing.
   */
  think(input: { system: string; prompt: string; schema: object }): Promise<string | null>;
}

/**
 * Gemini, over plain HTTP.
 *
 * No SDK: this is one POST with a JSON body, and a dependency that has to be
 * kept current is a worse trade than twenty lines of fetch.
 *
 * Uses the Interactions API (`/v1beta/interactions`), which is where Google
 * moved generation — the older `models/{id}:generateContent` shape with
 * `contents` and `generationConfig` is the previous surface.
 */
export function geminiThinker(options: { apiKey: string; model?: string }): Thinker {
  const model = options.model ?? "gemini-3.7-flash";

  return {
    name: `gemini:${model}`,

    async think({ system, prompt, schema }) {
      const response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
        method: "POST",
        headers: {
          "x-goog-api-key": options.apiKey,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model,
          system_instruction: system,
          input: prompt,
          // Asking for the schema is what keeps the loop from having to parse
          // prose. The caller still validates — a schema is a strong
          // constraint, not a guarantee about a model's output.
          response_format: {
            type: "text",
            mime_type: "application/json",
            schema,
          },
        }),
      });

      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        const message = `gemini ${response.status}: ${detail.slice(0, 300)}`;

        // 429 is the free tier's quota, and 5xx is Google having a moment.
        // Neither says anything about this agent or its prompt.
        if (response.status === 429 || response.status >= 500) {
          throw new TransientThinkerError(message);
        }
        throw new Error(message);
      }

      const body = (await response.json()) as {
        steps?: { type?: string; content?: { type?: string; text?: string }[] }[];
      };

      // The answer lives in the text blocks of the model_output steps. Joined
      // rather than taking the first, because a response split across
      // consecutive text blocks is one answer, not several.
      const text = (body.steps ?? [])
        .filter((step) => step.type === "model_output")
        .flatMap((step) => step.content ?? [])
        .filter((block) => block.type === "text")
        .map((block) => block.text ?? "")
        .join("")
        .trim();

      return text || null;
    },
  };
}

/**
 * Claude, for a caller that has a key for it.
 *
 * Imported lazily so a deployment running on Gemini never loads the Anthropic
 * SDK, and so a missing optional dependency cannot break the Gemini path.
 */
export function anthropicThinker(options: { model?: string; effort?: string } = {}): Thinker {
  const model = options.model ?? "claude-opus-5";

  return {
    name: `anthropic:${model}`,

    async think({ system, prompt, schema }) {
      const { default: Anthropic } = await import("@anthropic-ai/sdk");
      const client = new Anthropic();

      const response = await client.beta.messages.create({
        model,
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        output_config: {
          effort: (options.effort ?? "low") as "low",
          format: { type: "json_schema", schema: schema as Record<string, unknown> },
        },
        // Classifiers can decline; falling back keeps an unattended agent
        // running rather than silently going quiet.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system,
        messages: [{ role: "user", content: prompt }],
      });

      if (response.stop_reason === "refusal") return null;

      const text = response.content
        .map((block) => (block.type === "text" ? block.text : ""))
        .join("");

      return text.trim() || null;
    },
  };
}

/**
 * Whichever brain this deployment is configured for.
 *
 * Gemini first because it is what this runs on; Anthropic if that key is the
 * one present. Neither means the loop cannot think, and saying so plainly
 * beats failing later inside a provider SDK with a message about credentials.
 */
export function thinkerFromEnv(): Thinker {
  const gemini = process.env["GEMINI_API_KEY"];
  if (gemini) {
    const model = process.env["GEMINI_MODEL"];
    return geminiThinker(model ? { apiKey: gemini, model } : { apiKey: gemini });
  }

  if (process.env["ANTHROPIC_API_KEY"] || process.env["ANTHROPIC_AUTH_TOKEN"]) {
    return anthropicThinker();
  }

  throw new Error(
    "No model configured: set GEMINI_API_KEY (or ANTHROPIC_API_KEY) for agents to think.",
  );
}
