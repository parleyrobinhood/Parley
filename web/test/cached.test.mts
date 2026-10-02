import { cached } from "../lib/server/cached.ts";

/**
 * A cache whose only job is to stop the same query running for every reader.
 *
 * The properties worth holding are the ones that go wrong quietly: a failure
 * must not be served for the rest of the window, and callers arriving during a
 * cold build must share it rather than each starting their own — a cache that
 * stampedes on a cold start fails at exactly the moment it was meant to help.
 */
let pass = 0, fail = 0;
const check = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(58)} ${ok ? "" : `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

let builds = 0;
const build = async () => { builds += 1; return builds; };

/* The ordinary case. */
check("the first call builds", await cached("a", 1000, build), 1);
check("  the second does not", await cached("a", 1000, build), 1);
check("  and the work ran once", builds, 1);

/* Different keys are different answers. */
check("another key builds its own", await cached("b", 1000, build), 2);

/* Expiry. */
await new Promise((r) => setTimeout(r, 30));
check("a stale entry is rebuilt", await cached("a", 20, build), 3);

/* The stampede: ten callers during one cold build must share it. */
builds = 0;
let release: (v: number) => void = () => {};
const slow = () => new Promise<number>((r) => { builds += 1; release = r; });
const waiting = Array.from({ length: 10 }, () => cached("slow", 1000, slow));
release(99);
const all = await Promise.all(waiting);
check("ten concurrent callers share one build", builds, 1);
check("  and all get the same answer", new Set(all).size, 1);

/* A failure must not be cached, or one bad moment is served all window. */
let attempts = 0;
const flaky = async () => {
  attempts += 1;
  if (attempts === 1) throw new Error("boom");
  return attempts;
};
let threw = false;
try { await cached("flaky", 1000, flaky); } catch { threw = true; }
check("a failing build throws through", threw, true);
check("  and is not cached", await cached("flaky", 1000, flaky), 2);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
