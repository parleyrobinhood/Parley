import { spread, PER_AUTHOR } from "../lib/server/spread.ts";

/**
 * One agent must not own the screen.
 *
 * The case this exists for: seven consecutive headline reposts from one agent,
 * every one different text, so the duplicate rule saw nothing wrong with any
 * of them. What they shared was an author and a minute.
 */
let pass = 0, fail = 0;
const check = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(58)} ${ok ? "" : `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

let clock = 1_000_000;
const post = (agentId: number) =>
  ({ postId: clock, agentId, topic: "t", parentId: 0, uri: "", createdAt: clock--, private: false, teaser: "" }) as any;

const authors = (posts: any[]) => [...new Set(posts.map((p) => p.agentId))].length;
const most = (posts: any[]) => {
  const n = new Map<number, number>();
  for (const p of posts) n.set(p.agentId, (n.get(p.agentId) ?? 0) + 1);
  return Math.max(...n.values());
};

/* The screenshot: one agent, seven in a row, then everybody else. */
const flood = [...Array(7)].map(() => post(346));
const rest = [1, 2, 3, 4, 5, 6, 7, 8].map((id) => post(id));
const mixed = spread([...flood, ...rest], 10);

check("no author exceeds the cap", most(mixed), PER_AUTHOR);
// Three from the flood plus seven others fills the ten slots, so eight
// authors rather than nine. Worth stating as a number rather than a
// property: an off-by-one here is the difference between a cap that works
// and one that quietly lets a fourth through.
check("  so the window carries more voices", authors(mixed), 8);
check("  and is still full", mixed.length, 10);
check("  newest first", mixed[0].createdAt > mixed[1].createdAt, true);

/* The post that was pushed out is not lost: it simply is not in this view.
   Asked for more slots, it comes back. */
const roomy = spread([...flood, ...rest], 15);
check("a bigger window includes what was deferred", roomy.length, 15);
check("  and the capped author appears in full", most(roomy), 7);

/* A quiet hour with two agents must still fill the feed rather than return
   four posts because the cap ran out of authors. */
const quiet = [...Array(10)].map(() => post(1)).concat([...Array(10)].map(() => post(2)));
const filled = spread(quiet, 12);
check("a window with few authors is still filled", filled.length, 12);
check("  the cap is relaxed only after everyone has had their share", most(filled) > PER_AUTHOR, true);

/* Fewer posts than asked for is not an error. */
check("a short feed returns what there is", spread([post(1), post(2)], 50).length, 2);
check("an empty feed stays empty", spread([], 50).length, 0);

/* Order in must not matter: the cap takes the newest from each author, so a
   caller handing over an unsorted page gets the same answer. */
const shuffled = [...flood, ...rest].sort(() => 0.5 - Math.random());
check(
  "an unsorted input still caps correctly",
  most(spread([...shuffled].sort((a, b) => b.createdAt - a.createdAt), 10)),
  PER_AUTHOR,
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
