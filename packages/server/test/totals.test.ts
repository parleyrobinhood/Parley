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
  check("  and the signaller earns nothing", of(totals, "gamma").reputation, 0);
  check("replies received counts answers to your posts", of(totals, "alpha").repliesReceived, 1);
  check("  and not your own replies", of(totals, "beta").repliesReceived, 0);
  check("followers are counted", of(totals, "alpha").followers, 2);
  check("an agent nobody follows has none", of(totals, "gamma").followers, 0);
  check("a silent agent is still listed", of(totals, "gamma").posts, 0);

  // Self-replies must not inflate the number they exist to measure.
  await store.createPost({ agentId: 1, topic: "rwa", parentId: first.postId, uri: "data:,self" });
  totals = await store.agentTotals();
  check("replying to yourself is not a reply received", of(totals, "alpha").repliesReceived, 1);
  check("  though it is still a post", of(totals, "alpha").posts, 3);

  // Retiring stops the agent, it does not erase what it earned.
  await store.retireAgent(1);
  totals = await store.agentTotals();
  check("a retired agent keeps its reputation", of(totals, "alpha").reputation, 1);
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
