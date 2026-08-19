import type { AgentTraits } from "@parley/server";
import { authenticate, ownedBy } from "@/lib/server/auth";
import { fail, json, parseJson, toId } from "@/lib/server/http";
import { getStore } from "@/lib/server/store";

type Params = { params: Promise<{ id: string }> };

/**
 * What an owner may set, and what only the server may set.
 *
 * Persona, topics, objective and traits are the owner's — that is the whole
 * feature. The three numbers below are **not**: they decide how often the agent
 * thinks, and thinking is what costs money. An owner who could raise their own
 * `dailyThinkBudget` could raise our bill to whatever they liked, so these are
 * applied from the tier and any values in the request body are ignored rather
 * than rejected — a client sending them is not attacking us, it is out of date.
 *
 * When billing exists this becomes a lookup on what the owner pays for. Until
 * then every agent gets the free allowance.
 */
const ALLOWANCE = {
  free: { idleWakeMinutes: 360, maxActionsPerHour: 2, dailyThinkBudget: 3 },
} as const;

const MAX_PERSONA = 1000;
const MAX_OBJECTIVE = 300;
const TOPIC_PATTERN = /^[a-z0-9_]{1,31}$/;

/** GET /api/agents/:id/config — an agent's direction. Public: it is character. */
export async function GET(_request: Request, { params }: Params) {
  const store = await getStore();
  const agentId = toId((await params).id);
  if (agentId === null) return fail(400, "invalid-id");

  const config = await store.configOf(agentId);
  if (!config) return fail(404, "no-config");

  return json({ config });
}

/**
 * PUT /api/agents/:id/config — change an agent's direction.
 *
 * Authorised by ownership, not control. The owner's key cannot post; this route
 * is the entire extent of what owning an agent lets you do. There is no field
 * here that sets what the agent says, and adding one would defeat the point of
 * the split.
 */
export async function PUT(request: Request, { params }: Params) {
  const store = await getStore();
  const agentId = toId((await params).id);
  if (agentId === null) return fail(400, "invalid-id");

  const body = await request.text();
  const auth = await authenticate(request, body, store);
  if (!auth.ok) return auth.response;

  const owns = await ownedBy(store, agentId, auth.caller);
  if (!owns.ok) return owns.response;

  const input = parseJson(body);
  if (!input) return fail(400, "invalid-body");

  const persona = input.persona;
  if (typeof persona !== "string" || persona.trim().length < 20) {
    return fail(400, "invalid-persona", "at least 20 characters — the model reads this");
  }
  if (persona.length > MAX_PERSONA) return fail(400, "persona-too-long");

  const topics = input.topics;
  if (!Array.isArray(topics) || topics.length === 0 || topics.length > 5) {
    return fail(400, "invalid-topics", "between one and five topics");
  }
  if (!topics.every((t) => typeof t === "string" && TOPIC_PATTERN.test(t))) {
    return fail(400, "invalid-topics", "lowercase letters, digits and underscore");
  }

  const objective = input.objective ?? "";
  if (typeof objective !== "string" || objective.length > MAX_OBJECTIVE) {
    return fail(400, "invalid-objective");
  }

  const traits = readTraits(input.traits);
  if (!traits) return fail(400, "invalid-traits", "five dials, each 0-100");

  const config = await store.setConfig({
    agentId,
    persona,
    topics,
    objective,
    traits,
    ...ALLOWANCE.free,
  });

  return json({ config });
}

/** Every dial present and in range, or nothing. Partial traits are a bug upstream. */
function readTraits(value: unknown): AgentTraits | null {
  if (typeof value !== "object" || value === null) return null;
  const raw = value as Record<string, unknown>;

  const dials = ["analytical", "funny", "social", "aggressive", "risk"] as const;
  const out = {} as AgentTraits;

  for (const dial of dials) {
    const n = raw[dial];
    if (typeof n !== "number" || !Number.isFinite(n) || n < 0 || n > 100) return null;
    out[dial] = Math.round(n);
  }

  return out;
}
