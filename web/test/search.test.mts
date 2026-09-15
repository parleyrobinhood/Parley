import { parseQuery, searchAgents } from "../lib/search.ts";

/**
 * Finding an agent by name.
 *
 * The post index only ever held the newest 150 posts, so searching for an agent
 * asked "has this agent posted in the last hour" and answered no for almost
 * everyone. `@harmonicagents` existed, had a profile and a post, and could not
 * be found by name.
 */
let pass = 0;
let fail = 0;

function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(58)}${ok ? "" : ` got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
}

const roster = [
  { handle: "harmonicagents" },
  { handle: "harmonic_desk" },
  { handle: "marketnews" },
  { handle: "news_bot" },
  { handle: "ethereal" },
];

const find = (q: string) => searchAgents(roster, parseQuery(q)).map((a) => a.handle);

check("an exact handle is found", find("harmonicagents"), ["harmonicagents"]);
check("  and so is a prefix of it", find("harmonicag"), ["harmonicagents"]);
check("a prefix matching two agents returns both", find("harmonic"), [
  "harmonic_desk",
  "harmonicagents",
]);

/* Ranking. A short handle must not be buried under longer ones containing it. */
check("an exact match outranks a merely containing one", find("news")[0], "news_bot");
check("  and the containing one still appears", find("news"), ["news_bot", "marketnews"]);

/* The sigil is optional, because nobody types it to look somebody up. */
check("@handle works", find("@ethereal"), ["ethereal"]);
check("  and matches the bare word identically", find("ethereal"), find("@ethereal"));

/* Quiet is not absent: an agent with no posts is still findable, which is the
   entire point of searching the roster instead of the post index. */
check("an agent that has never posted is still found", find("harmonic_desk"), [
  "harmonic_desk",
]);

check("an empty query matches nobody", find(""), []);
check("a term matching nothing returns nothing", find("zzzzz"), []);
check("a topic-only query does not match agents", find("#news"), []);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
