import { MemoryStore } from "../dist/memory-store.js";
import { PostgresStore } from "../dist/postgres-store.js";

/**
 * `searchPosts` across both backends.
 *
 * The behaviour has to match: one is SQL with `ilike`, the other walks arrays,
 * and the page cannot tell which it is talking to. The properties that matter
 * are that every term must appear, that an empty filter matches nothing rather
 * than everything, and that a term is never treated as a pattern.
 */
let pass = 0, fail = 0, backend = "";
const check = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"}  ${backend.padEnd(9)}${name.padEnd(56)} ${ok ? "" : `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

const find = async (store: any, filter: Partial<{ terms: string[]; handles: string[]; topics: string[]; limit: number }>) =>
  (await store.searchPosts({ terms: [], handles: [], topics: [], limit: 50, ...filter })).map(
    (p: any) => p.postId,
  );

async function suite(name: string, fresh: () => Promise<any>) {
  backend = name;
  const store = await fresh();

  await store.createAgent({ handle: "alpha", controller: "0xA", metadata: "{}" });
  await store.createAgent({ handle: "beta", controller: "0xB", metadata: "{}" });

  // Stored as data URIs, which is what the query actually matches against.
  await store.createPost({ agentId: 1, topic: "rwa", parentId: 0, uri: "data:,tokenised%20treasury%20yield" });
  await store.createPost({ agentId: 2, topic: "news", parentId: 0, uri: "data:,treasury%20buyback%20results" });
  await store.createPost({ agentId: 1, topic: "news", parentId: 0, uri: "data:,a%20100%25%20increase" });

  check("a term finds the posts containing it", (await find(store, { terms: ["treasury"] })).sort(), [1, 2]);
  check("newest first", await find(store, { terms: ["treasury"] }), [2, 1]);
  check("every term must appear", await find(store, { terms: ["treasury", "yield"] }), [1]);
  check("  so an impossible pair matches nothing", await find(store, { terms: ["yield", "buyback"] }), []);
  check("matching is case-insensitive", await find(store, { terms: ["TREASURY"] }), [2, 1]);

  check("a topic narrows", await find(store, { terms: ["treasury"], topics: ["rwa"] }), [1]);
  check("a handle narrows", await find(store, { terms: ["treasury"], handles: ["beta"] }), [2]);
  check("  and a partial handle works", await find(store, { handles: ["alph"] }), [3, 1]);

  // An empty filter must not be read as "everything".
  check("nothing asked for is nothing returned", await find(store, {}), []);
  check("a term matching nothing returns nothing", await find(store, { terms: ["zzzz"] }), []);

  // `%` and `_` are LIKE wildcards. A search for "100%" must not match "1000".
  check("a percent sign is a character, not a wildcard", await find(store, { terms: ["100%"] }), [3]);
  check("  and an underscore is too", await find(store, { terms: ["increase_"] }), []);

  check("limit caps the result", (await find(store, { terms: ["treasury"], limit: 1 })).length, 1);
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
