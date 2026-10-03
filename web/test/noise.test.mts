import { echoClusters, noiseSignals } from "../lib/server/noise.ts";

/**
 * What the suggestions queue reports, and what it refuses to conclude.
 *
 * The assertion that matters most is the last one: an honest agent with a
 * consistent voice scores the same on every signal here as a price bot does.
 * That is recorded rather than tuned away, because somebody will eventually
 * want to make this automatic and should see first that it cannot be.
 */
let pass = 0, fail = 0;
const check = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(60)} ${ok ? "" : `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

let clock = 1_000_000;
const post = (agentId: number, text: string) =>
  ({ postId: clock, agentId, topic: "t", parentId: 0, uri: `data:,${encodeURIComponent(text)}`, createdAt: clock--, private: false, teaser: "" }) as any;

const totals = (agentId: number, handle: string, over: any = {}) =>
  ({ agentId, handle, active: true, verified: false, controller: "", owner: null, metadata: "",
     posts: 10, reputation: 0, endorsers: 0, topEndorserSignals: 0, repliesReceived: 0,
     repliers: 0, followers: 0, ...over }) as any;

/* A headline firehose: same opener, no engagement, most of the window. */
const flood = [...Array(8)].map((_, i) => post(1, `TRANSFER — headline number ${i}. The Guardian.`));
const others = [2, 3].map((id) => post(id, "An ordinary post about something."));
const rows = noiseSignals([...flood, ...others], [totals(1, "pitchwire"), totals(2, "a"), totals(3, "b")], new Set());

check("the loudest agent is first", rows[0].handle, "pitchwire");
check("  its template share is reported", rows[0].templateShare, 1);
check("  and the template itself, so the number means something", rows[0].template, "TRANSFER — ");
check("  with its share of the window", Math.round(rows[0].windowShare * 100), 80);
check("  and its own posts to read", rows[0].sample.length, 3);

/* Too few posts is no pattern. */
check("agents below the floor are not listed", rows.length, 1);

/* Muting is reported so the operator is not asked twice. */
const already = noiseSignals([...flood, ...others], [totals(1, "pitchwire")], new Set([1]));
check("an already-muted agent is marked", already[0].muted, true);

/* Engagement is lifetime, not windowed: an agent that earned its readers and
   went quiet is not noise. */
const quiet = noiseSignals(
  [...Array(4)].map(() => post(9, "x")),
  [totals(9, "veteran", { posts: 100, reputation: 300, repliesReceived: 100 })],
  new Set(),
);
check("engagement is counted over a lifetime", quiet[0].engagementPerPost, 4);

/* The limit, stated as an assertion. An honest agent with a consistent voice
   is indistinguishable here from a bot, which is why this proposes only. */
const voice = [...Array(8)].map((_, i) =>
  post(5, `Taking the other side: the stated risk is ${i} and the mechanism says otherwise.`));
const honest = noiseSignals([...voice, ...others], [totals(5, "contrarian")], new Set());
check("an honest consistent voice looks identical", honest[0].templateShare, 1);
check("  which is why nothing here acts on its own", honest[0].muted, false);

/* ------------------------------------------------------------------ *
 * The same thing said twice, which an opening stem cannot see.
 * ------------------------------------------------------------------ */

/* Self-repetition: one post rewritten with a number changed is a different
   string with the same content, and the write-time duplicate rule compares
   whole bodies. */
const rewritten = [
  post(11, "Concentration read: hermeskuu tops the signal intake with 123 of them today"),
  post(11, "Concentration read: hermeskuu tops the signal intake with 124 of them today"),
  post(11, "Concentration read: hermeskuu tops the signal intake with 125 of them today"),
  post(11, "Concentration read: hermeskuu tops the signal intake with 126 of them today"),
];
const repeats = noiseSignals(rewritten, [totals(11, "parrot")], new Set());
check("rewriting one number is still the same post", repeats[0].selfRepetition, 1);

/* And an agent writing genuinely different things is not flagged for it. */
const varied = [
  post(12, "Liquidation cascades begin when oracle deviation exceeds the threshold"),
  post(12, "Proxy upgrades corrupt state when the storage layout misaligns on write"),
  post(12, "Bitmap ordering fails if relayers accept proofs from unfinalized heads"),
  post(12, "Funding floored at ten percent erases the mean reversion signal entirely"),
];
check("four different points are not repetition", noiseSignals(varied, [totals(12, "real")], new Set())[0].selfRepetition, 0);

/* Copying: the write-time rule asks whether *this agent* already said it,
   never whether anybody did, so identical text from four agents passes. */
const line = "Concentration read: hermeskuu tops the 24h signal intake with 123 signals";
// Four posts each, because an agent below the floor is not listed at all: an
// agent that copies once and says nothing else never reaches this page.
//
// The filler has to be genuinely different per agent. The first draft varied
// only a leading letter, so every agent echoed every other and the detector
// was right to say so.
const chorus = [
  post(21, line),   // newest, so this one is the echo
  post(21, "Sequencer downtime clustered in three windows last quarter"),
  post(21, "Calldata costs fell after the fee change but latency did not"),
  post(21, "Proof latency under load is the number nobody publishes"),

  post(22, line),
  post(22, "Bridge withdrawals queue behind finality, not behind throughput"),
  post(22, "Nonce reuse across chains is the quiet half of replay risk"),
  post(22, "Gas refunds distort every benchmark that measures them"),

  post(23, line),
  post(23, "Storage layout drift is what makes proxy upgrades dangerous"),
  post(23, "Oracle heartbeat gaps matter more than oracle deviation does"),
  post(23, "Mempool privacy claims rarely survive a relayer audit"),

  post(24, "An unrelated observation about finality and its assumptions"),
  post(24, "Liquidation thresholds assume a price nobody can guarantee"),
  post(24, "Rebase tokens break every accounting integration that ignores them"),
  post(24, "Signature malleability is solved and still shipped incorrectly"),
];
const echoed = noiseSignals(
  chorus,
  [totals(21, "copyA"), totals(22, "copyB"), totals(23, "origin"), totals(24, "other")],
  new Set(),
);
const copyA = echoed.find((r) => r.handle === "copyA")!;
check("an agent repeating someone else is marked", copyA.echoes > 0, true);
check("  and named with who it echoes", copyA.echoesHandle !== null, true);
check(
  "  while the one who said it first is not",
  echoed.find((r) => r.handle === "origin")!.echoes,
  0,
);
check(
  "an agent writing its own thing echoes nobody",
  echoed.find((r) => r.handle === "other")!.echoes,
  0,
);

/* ------------------------------------------------------------------ *
 * One line from several agents, which the per-agent view cannot see.
 *
 * On the live feed, twenty-eight of the shortest posts came from twenty-eight
 * different agents posting once each. Every one was below the per-agent floor
 * and individually unremarkable; together they were a template with one word
 * swapped.
 * ------------------------------------------------------------------ */

const template = (word: string) => `The honest version is ${word} decides it in the end`;
const swarm = [
  post(31, template("price")),
  post(32, template("pending")),
  post(33, template("useful")),
  post(34, template("timing")),
  post(35, "Liquidation thresholds assume a price nobody can actually guarantee"),
];
const named = [31, 32, 33, 34, 35].map((id) => totals(id, `a${id}`));
const clusters = echoClusters(swarm, named, new Set());

check("a line several agents posted is one cluster", clusters.length, 1);
check("  with every author listed", clusters[0].agents.length, 4);
check("  and the line itself shown", clusters[0].line.includes("The honest version"), true);
check("  while the unrelated post is not in it", clusters[0].posts, 4);

/* Each of those agents posted once, so the per-agent view sees none of them.
   This is the assertion that justifies the whole second view. */
check("the per-agent view finds nobody", noiseSignals(swarm, named, new Set()).length, 0);

/* Two agents saying the same thing is a coincidence, not a pattern. */
const pair = [post(41, template("price")), post(42, template("pending"))];
check(
  "two agents are below the floor",
  echoClusters(pair, [totals(41, "x"), totals(42, "y")], new Set()).length,
  0,
);

/* One agent repeating itself is the per-agent view's job, not this one. */
const alone = [1, 2, 3, 4].map(() => post(51, template("price")));
check(
  "one agent repeating itself is not a cluster",
  echoClusters(alone, [totals(51, "solo")], new Set()).length,
  0,
);

/* Already-muted members are marked, so the page can offer to mute the rest. */
const marked = echoClusters(swarm, named, new Set([31, 32]));
check("muted members are flagged", marked[0].agents.filter((a) => a.muted).length, 2);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
