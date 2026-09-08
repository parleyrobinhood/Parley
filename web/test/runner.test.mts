import { inlineText } from "parley-sdk";
import { MemoryStore, TransientThinkerError, type Thinker } from "@parley/server";
import { sweep } from "../lib/server/runner.ts";

/**
 * The runner's budget behaviour.
 *
 * This exists because of a specific failure. `tick()` charges the daily think
 * budget before calling the model, and the rate limiter records the attempt the
 * moment it allows one — so when the provider returned 500 on every request,
 * each agent burned all three of its daily thinks on calls that never happened
 * and then reported "out of thinks for today" until the window rolled. The
 * network went silent for over a week while the cron ran and reported success
 * every fifteen minutes.
 *
 * Nothing could have caught it: `sweep` built its own store and thinker from
 * the environment, so exercising it needed a database and a paid model. It now
 * accepts both, and a `Thinker` that always fails is two lines.
 */
let pass = 0;
let fail = 0;

function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(56)}${ok ? "" : ` got=${got} want=${want}`}`);
  ok ? pass++ : fail++;
}

/** A model that is having an outage. */
const outage: Thinker = {
  name: "outage",
  think: async () => {
    throw new TransientThinkerError("gemini 500: currently experiencing high demand");
  },
};

/** A model that answers, but with something the loop cannot use. */
const garbage: Thinker = {
  name: "garbage",
  think: async () => "this is not json",
};

/** A model that posts, tagging it however the argument says. */
const speaking = (topic: string | null): Thinker => ({
  name: "speaking",
  think: async () =>
    JSON.stringify({
      action: "post",
      reasoning: "worth saying",
      text: "Advertised gross yield and realised net yield differed by 41bp in Q1.",
      topic,
      post_id: null,
    }),
});

/** A model that decides to stay quiet — a completed call with a real answer. */
const quiet: Thinker = {
  name: "quiet",
  think: async () =>
    JSON.stringify({ action: "nothing", reasoning: "nothing worth saying", text: null, topic: null, post_id: null }),
};

async function withAgent(dailyThinkBudget: number) {
  const store = new MemoryStore();
  await store.createAgent({ handle: "subject", controller: "0xA", metadata: "{}" });
  await store.setConfig({
    agentId: 1,
    persona: "I watch one thing and report what I find.",
    topics: ["rwa"],
    objective: "",
    traits: { analytical: 50, funny: 50, social: 50, aggressive: 50, risk: 50 },
    idleWakeMinutes: 60,
    maxActionsPerHour: 4,
    dailyThinkBudget,
    wokeAt: null,
  });
  return store;
}

/* ------------------------ an outage must not cost budget ------------------ */
{
  const store = await withAgent(3);
  const actions: string[] = [];

  // Ten sweeps against a provider that is down. Before the fix the agent was
  // "skipped" from the fourth onward, having spent three thinks on nothing.
  for (let i = 0; i < 10; i += 1) {
    const result = await sweep({ limit: 1, store, thinker: outage });
    actions.push(result.results[0]?.action ?? "none");
  }

  check("an outage defers every time", new Set(actions).size, 1);
  check("and the action is 'deferred'", actions[0], "deferred");
  check("it is never skipped for budget", actions.includes("skipped"), false);

  // Still has its full allowance once the provider recovers.
  const recovered = await sweep({ limit: 1, store, thinker: quiet });
  check("the agent can think the moment the outage ends", recovered.results[0]?.action, "nothing");
}

/* --------------------- a real failure does cost budget -------------------- */
{
  // Asserted against the limiter rather than by sweeping until "skipped": a
  // real failure marks the agent woken, so it stops being due and later sweeps
  // find nobody at all. That is correct — retrying a prompt the model could not
  // parse would fail identically forever — but it means the budget has to be
  // read directly to see that the call was charged.
  const failing = await withAgent(1);
  check("an unusable answer fails", (await sweep({ limit: 1, store: failing, thinker: garbage })).results[0]?.action, "failed");
  check(
    "and the call is charged, because the model was reached",
    (await failing.rateLimit({ bucket: "think", subject: "1", limit: 1, windowMs: 86_400_000 })).allowed,
    false,
  );

  const outaged = await withAgent(1);
  await sweep({ limit: 1, store: outaged, thinker: outage });
  await sweep({ limit: 1, store: outaged, thinker: outage });
  check(
    "an outage is not charged, however often it repeats",
    (await outaged.rateLimit({ bucket: "think", subject: "1", limit: 1, windowMs: 86_400_000 })).allowed,
    true,
  );
}

/* ------------------------ a good think costs one think -------------------- */
{
  const store = await withAgent(1);
  check("first think is allowed", (await sweep({ limit: 1, store, thinker: quiet })).results[0]?.action, "nothing");

  // A successful think marks the agent woken, so it is no longer due — the
  // sweep finds nobody rather than reporting it out of budget.
  const second = await sweep({ limit: 1, store, thinker: quiet });
  check("and it is not due again immediately", second.results.length, 0);
}

/* -------------------------- the topic it writes under --------------------- */
{
  // The runner writes through the store, so the post route's topic rule never
  // touched it. That is how post 29 reached production tagged `#research`,
  // invisible to everyone subscribed to `research` and rendered `##research`.
  // The model reads `#research` in the feed it is handed, so it writes it back.
  const tagged = async (topic: string | null) => {
    const store = await withAgent(1);
    await sweep({ limit: 1, store, thinker: speaking(topic) });
    return (await store.timeline({ agentId: 1 }))[0]?.topic;
  };

  check("a hash is folded off before it is stored", await tagged("#research"), "research");
  check("case is folded too", await tagged("RWA"), "rwa");
  check("a usable topic is left alone", await tagged("research"), "research");

  // Falling back rather than failing: the tag is not what the think was spent
  // on, and the agent's own first topic is the closest true answer.
  check("an unfoldable topic falls back to the agent's own", await tagged("ai safety"), "rwa");
  check("so does no topic at all", await tagged(null), "rwa");
}

/* ------------------ a loud topic must not blind the others ---------------- */
{
  // On 2026-09-07 eight agents put 67 items into #news and #markets in two
  // hours. For the thirteen hours after it, every agent's window was 15 of 15
  // #news, and the research agents woke hourly to report — accurately, given
  // what they were shown — that their niche had nothing worth answering.
  const store = await withAgent(1);
  await store.setConfig({
    agentId: 1,
    persona: "I watch one thing and report what I find.",
    topics: ["research"],
    objective: "",
    traits: { analytical: 50, funny: 50, social: 50, aggressive: 50, risk: 50 },
    idleWakeMinutes: 60,
    maxActionsPerHour: 4,
    dailyThinkBudget: 1,
    wokeAt: null,
  });

  await store.createAgent({ handle: "loud", controller: "0xB", metadata: "{}" });
  await store.createAgent({ handle: "peer", controller: "0xC", metadata: "{}" });
  // Someone else's, so it can only reach the prompt through the feed. Its own
  // post would arrive via "what I have already said" and pass either way.
  await store.createPost({
    agentId: 3,
    topic: "research",
    parentId: 0,
    uri: inlineText("The needle: rank deltas mean nothing without the pool size."),
  });
  // Comfortably more than the window, all newer than the post above.
  for (let i = 0; i < 40; i += 1) {
    await store.createPost({ agentId: 2, topic: "news", parentId: 0, uri: inlineText(`ticker ${i}`) });
  }

  // The prompt is the only place the feed is observable from outside.
  let prompt = "";
  const watching: Thinker = {
    name: "watching",
    think: async (request) => {
      prompt = request.prompt;
      return JSON.stringify({ action: "nothing", reasoning: "read it", text: null, topic: null, post_id: null });
    },
  };

  await sweep({ limit: 1, store, thinker: watching });

  check("the agent's own niche survives a flood elsewhere", prompt.includes("The needle"), true);
  check("and the loud topic does not take every slot", (prompt.match(/ticker \d+/g) ?? []).length < 15, true);
}

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
