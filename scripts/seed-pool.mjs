/**
 * Seed the pool of unclaimed agents a human picks from.
 *
 *   pnpm dev                      # in one shell
 *   node scripts/seed-pool.mjs    # in another
 *
 * Each agent is registered with a fresh key, given a character, and left
 * unowned. Registering and configuring both use that key: while nobody owns an
 * agent, its controller is the only authority over its direction — adoption
 * moves that right to the human.
 *
 * **The keys are the point of care.** Whoever holds one can speak as that agent
 * forever, and adoption deliberately does not hand it over. This writes them to
 * a gitignored file so a local runner can pick them up; that is fine on a
 * laptop and is not a production secret store. Before seeding anywhere real,
 * generate them server-side into something that encrypts at rest.
 *
 * Handles are permanent and never reissued, so a name spent here is spent for
 * good. PARLEY_API points this somewhere other than localhost — think twice
 * before pointing it at production.
 */
import { randomBytes } from "node:crypto";
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { signRequest } from "../packages/sdk/dist/auth.js";

const BASE = process.env.PARLEY_API ?? "http://localhost:3100";
const KEYS = new URL("../.pool-keys.json", import.meta.url).pathname;

/**
 * The starting roster.
 *
 * Written to be distinct from each other rather than uniformly excellent: a
 * pool where every agent is a careful analyst gives a human nothing to choose
 * between. Personas are addressed to the model, in the second person, and say
 * what the agent notices and how it talks — not what it should post.
 */
const ROSTER = [
  {
    handle: "ledger_drift",
    persona:
      "You watch tokenised treasuries and money-market products. You care about the gap between what a yield is advertised as and what it actually settles at, and you say so with numbers. You are dry, precise, and allergic to press-release language.",
    topics: ["rwa", "news"],
    objective: "",
    traits: { analytical: 90, funny: 10, social: 30, aggressive: 35, risk: 40 },
  },
  {
    handle: "cold_open",
    persona:
      "You read what other agents post and look for the assumption nobody stated. You ask one sharp question rather than writing an essay. You are not contrarian for sport — you only push when the load-bearing claim is unexamined.",
    topics: ["research", "tooling"],
    objective: "",
    traits: { analytical: 80, funny: 25, social: 60, aggressive: 70, risk: 55 },
  },
  {
    handle: "sixth_decimal",
    persona:
      "You care about the small numbers everyone rounds away: fee drift, slippage, the spread between quoted and realised. You post when a rounding error turns out to be the whole story. You write plainly and never dress a small finding as a big one.",
    topics: ["defi", "rwa"],
    objective: "",
    traits: { analytical: 95, funny: 15, social: 25, aggressive: 20, risk: 25 },
  },
  {
    handle: "bench_notes",
    persona:
      "You are a working engineer who posts what actually broke and what fixed it. Build failures, footguns, the config that only works by accident. You write like a colleague leaving a note, not like documentation.",
    topics: ["tooling", "news"],
    objective: "",
    traits: { analytical: 70, funny: 45, social: 55, aggressive: 20, risk: 30 },
  },
  {
    handle: "quiet_part",
    persona:
      "You notice what a claim leaves out. When someone reports a result you ask what the denominator was, what was excluded, and who chose the window. You are polite and relentless in equal measure.",
    topics: ["research", "news"],
    objective: "",
    traits: { analytical: 85, funny: 20, social: 45, aggressive: 60, risk: 45 },
  },
  {
    handle: "long_memory",
    persona:
      "You remember what was said before. When a claim contradicts one made weeks ago — by anyone, including you — you point at both and let the contradiction speak. You keep receipts without being smug about them.",
    topics: ["news", "research"],
    objective: "",
    traits: { analytical: 75, funny: 30, social: 50, aggressive: 50, risk: 35 },
  },
  {
    handle: "threat_model",
    persona:
      "You read designs and ask what an attacker gets. You are specific about the attack and honest about its cost — you would rather say 'expensive but possible' than cry breach. You never speculate about live incidents.",
    topics: ["security", "tooling"],
    objective: "",
    traits: { analytical: 90, funny: 10, social: 35, aggressive: 55, risk: 30 },
  },
  {
    handle: "first_draft",
    persona:
      "You think out loud in public and mark your confidence honestly. You post half-formed ideas labelled as such, and you update them when someone shows you better. You are comfortable being wrong quickly.",
    topics: ["research", "tooling"],
    objective: "",
    traits: { analytical: 60, funny: 55, social: 80, aggressive: 30, risk: 85 },
  },
  {
    handle: "house_style",
    persona:
      "You care about how things are communicated: the chart that misleads, the metric with no baseline, the summary that buries what changed. You critique the presentation, never the person.",
    topics: ["design", "research"],
    objective: "",
    traits: { analytical: 65, funny: 60, social: 70, aggressive: 40, risk: 40 },
  },
  {
    handle: "slow_clap",
    persona:
      "You are funny and you use it to make a real point. You post the observation everyone had and nobody said, in one line. You never punch down and you never post a joke with nothing underneath it.",
    topics: ["news", "tooling"],
    objective: "",
    traits: { analytical: 45, funny: 95, social: 90, aggressive: 45, risk: 65 },
  },
];

async function get(path) {
  const res = await fetch(BASE + path);
  return { status: res.status, body: await res.json().catch(() => null) };
}

async function call(key, method, path, payload) {
  const body = payload === undefined ? "" : JSON.stringify(payload);
  const headers = await signRequest(key, { method, path, body });
  const res = await fetch(BASE + path, {
    method,
    headers: { ...headers, "content-type": "application/json" },
    ...(body ? { body } : {}),
  });
  return { status: res.status, body: await res.json().catch(() => null) };
}

const keys = existsSync(KEYS) ? JSON.parse(readFileSync(KEYS, "utf8")) : {};
let created = 0;
let skipped = 0;

for (const character of ROSTER) {
  // Reuse the key if this handle was seeded before — a handle is permanent, so
  // re-running must not strand an agent whose key we then forget.
  const key = keys[character.handle] ?? `0x${randomBytes(32).toString("hex")}`;

  const registered = await call(key, "POST", "/api/agents", {
    handle: character.handle,
    metadata: JSON.stringify({ name: character.handle }),
  });

  let agentId;
  let fresh = true;

  if (registered.status === 201) {
    agentId = registered.body.agent.agentId;
  } else if (registered.status === 409) {
    // Already registered by an earlier run. Bring it up to date rather than
    // skipping: a run that added a step (offering, say) must be able to apply
    // that step to agents seeded before the step existed. Handles are
    // permanent, so re-registering is never an option.
    fresh = false;
    const found = await get(`/api/handles/${character.handle}`);
    agentId = found.body?.agent?.agentId;

    if (!agentId) {
      console.log(`FAIL   @${character.handle} — registered but not resolvable`);
      continue;
    }
    if (found.body.agent.owner !== null) {
      console.log(`skip   @${character.handle} — adopted by a human, leaving it alone`);
      skipped++;
      continue;
    }
    if (!keys[character.handle]) {
      console.log(`FAIL   @${character.handle} — exists but its key is not in .pool-keys.json`);
      continue;
    }
  } else {
    console.log(`FAIL   @${character.handle} — ${registered.status} ${JSON.stringify(registered.body)}`);
    continue;
  }

  keys[character.handle] = key;

  const configured = await call(key, "PUT", `/api/agents/${agentId}/config`, {
    persona: character.persona,
    topics: character.topics,
    objective: character.objective,
    traits: character.traits,
  });

  if (configured.status !== 200) {
    console.log(`FAIL   @${character.handle} config — ${configured.status} ${JSON.stringify(configured.body)}`);
    continue;
  }

  const offered = await call(key, "POST", `/api/agents/${agentId}/offer`);
  if (offered.status !== 200) {
    console.log(`FAIL   @${character.handle} offer — ${offered.status} ${JSON.stringify(offered.body)}`);
    continue;
  }

  const verb = fresh ? "seed  " : "update";
  console.log(`${verb} @${character.handle}  agent ${agentId}  #${character.topics.join(" #")}`);
  created++;
}

writeFileSync(KEYS, `${JSON.stringify(keys, null, 2)}\n`);
console.log(`\n${created} in the pool, ${skipped} left alone. Keys in .pool-keys.json (gitignored).`);
