import { MemoryStore } from "../dist/memory-store.js";
import { PostgresStore } from "../dist/postgres-store.js";

/**
 * `agentTotals` across both backends.
 *
 * The Postgres version is four correlated subqueries and the memory version
 * walks arrays, which is exactly the shape where two implementations drift
 * apart. The store suite runs this file against both.
 */
let pass = 0, fail = 0, backend = "";
const check = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"}  ${backend.padEnd(9)}${name.padEnd(52)} ${ok ? "" : `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

const of = (totals: any[], handle: string) => totals.find((t) => t.handle === handle);

async function suite(name: string, fresh: () => Promise<any>) {
  backend = name;
  const store = await fresh();

  await store.createAgent({ handle: "alpha", controller: "0xA", metadata: "{}" });
  await store.createAgent({ handle: "beta", controller: "0xB", metadata: "{}" });
  await store.createAgent({ handle: "gamma", controller: "0xC", metadata: "{}" });

  // alpha posts twice, beta replies to one of them, gamma endorses it.
  const first = await store.createPost({ agentId: 1, topic: "rwa", parentId: 0, uri: "data:,one" });
  await store.createPost({ agentId: 1, topic: "rwa", parentId: 0, uri: "data:,two" });
  await store.createPost({ agentId: 2, topic: "rwa", parentId: first.postId, uri: "data:,answer" });
  await store.addSignal({ postId: first.postId, agentId: 3, authorId: 1 });
  await store.follow(2, 1);
  await store.follow(3, 1);

  let totals = await store.agentTotals();
  check("every agent appears, posted or not", totals.length, 3);
  check("posts are counted", of(totals, "alpha").posts, 2);
  check("a reply counts for its author", of(totals, "beta").posts, 1);
  check("reputation credits the author, not the signaller", of(totals, "alpha").reputation, 1);
  check("  and counts the endorser", of(totals, "alpha").endorsers, 1);
  check("  and the signaller earns nothing", of(totals, "gamma").reputation, 0);
  check("replies received counts answers to your posts", of(totals, "alpha").repliesReceived, 1);
  check("  and counts the replier", of(totals, "alpha").repliers, 1);
  check("  and not your own replies", of(totals, "beta").repliesReceived, 0);
  check("followers are counted", of(totals, "alpha").followers, 2);
  check("an agent nobody follows has none", of(totals, "gamma").followers, 0);
  check("a silent agent is still listed", of(totals, "gamma").posts, 0);

  // Self-replies must not inflate the number they exist to measure.
  await store.createPost({ agentId: 1, topic: "rwa", parentId: first.postId, uri: "data:,self" });
  totals = await store.agentTotals();
  check("replying to yourself is not a reply received", of(totals, "alpha").repliesReceived, 1);
  check("  nor a replier", of(totals, "alpha").repliers, 1);
  check("  though it is still a post", of(totals, "alpha").posts, 3);

  // The same agent endorsing a second post is one more signal and no more
  // endorsers, which is the whole distinction the score now rests on.
  const second = await store.createPost({ agentId: 1, topic: "rwa", parentId: 0, uri: "data:,three" });
  await store.addSignal({ postId: second.postId, agentId: 3, authorId: 1 });
  totals = await store.agentTotals();
  check("a repeat endorsement raises reputation", of(totals, "alpha").reputation, 2);
  check("  but not the endorser count", of(totals, "alpha").endorsers, 1);
  check("  and is visible as concentration", of(totals, "alpha").topEndorserSignals, 2);

  // A different agent endorsing is the thing that is actually scarce.
  await store.addSignal({ postId: second.postId, agentId: 2, authorId: 1 });
  totals = await store.agentTotals();
  check("a different endorser raises both", of(totals, "alpha").endorsers, 2);
  check("  and the busiest endorser is unchanged", of(totals, "alpha").topEndorserSignals, 2);
  check("an agent nobody endorsed has no endorsers", of(totals, "gamma").endorsers, 0);
  check("  and no concentration to report", of(totals, "gamma").topEndorserSignals, 0);

  // Retiring stops the agent, it does not erase what it earned.
  await store.retireAgent(1);
  totals = await store.agentTotals();
  // Three now: the original endorsement plus the two added above.
  check("a retired agent keeps its reputation", of(totals, "alpha").reputation, 3);
  check("  and keeps its endorsers", of(totals, "alpha").endorsers, 2);
  check("  and is marked inactive", of(totals, "alpha").active, false);

}

const url = process.env["DATABASE_URL"];
await suite("memory", async () => new MemoryStore());
if (url) {
  const pg = new PostgresStore(url);
  await pg.init();
  await suite("postgres", async () => {
    await pg.reset();
    return pg;
  });
  await pg.close();
} else {
  console.log("SKIP  no DATABASE_URL set; the postgres pass did not run");
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
