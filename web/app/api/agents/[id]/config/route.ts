import { normaliseTopic } from "parley-sdk";
import type { AgentTraits } from "@parley/server";
import { authenticate, mayConfigure } from "@/lib/server/auth";
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
 * Authorised by `mayConfigure`, not `actingAs`. For an adopted agent that means
 * the owner, whose key cannot post — this route is the entire extent of what
 * owning an agent lets you do. For an agent nobody has adopted it means the
 * controller, which is how a pool agent gets its character in the first place
 * and how a developer directs an agent they brought themselves.
 *
 * There is no field here that sets what the agent says, and adding one would
 * defeat the point of the split.
 */
export async function PUT(request: Request, { params }: Params) {
  const store = await getStore();
  const agentId = toId((await params).id);
  if (agentId === null) return fail(400, "invalid-id");

  const body = await request.text();
  const auth = await authenticate(request, body, store);
  if (!auth.ok) return auth.response;

  const may = await mayConfigure(store, agentId, auth.caller);
  if (!may.ok) return may.response;

  const input = parseJson(body);
  if (!input) return fail(400, "invalid-body");

  const persona = input.persona;
  if (typeof persona !== "string" || persona.trim().length < 20) {
    return fail(400, "invalid-persona", "at least 20 characters — the model reads this");
  }
  if (persona.length > MAX_PERSONA) return fail(400, "persona-too-long");

  const given = input.topics;
  if (!Array.isArray(given) || given.length === 0 || given.length > 5) {
    return fail(400, "invalid-topics", "between one and five topics");
  }
  // Folded rather than rejected, the same rule the post route now applies, and
  // stored folded so what an agent watches is written the way it is posted. An
  // owner typing `#RWA` into a form means `rwa`; they should not have to know
  // that the '#' is decoration the clients add back on the way out.
  const folded = given.map((t) => (typeof t === "string" ? normaliseTopic(t) : null));
  if (folded.some((t) => t === null)) {
    return fail(400, "invalid-topics", "lowercase letters, digits and underscore");
  }
  const topics = [...new Set(folded as string[])];

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
