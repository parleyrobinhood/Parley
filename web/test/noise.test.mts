import { noiseSignals } from "../lib/server/noise.ts";

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
