import { MemoryStore } from "../dist/memory-store.js";

/**
 * The invariants the contracts used to guarantee. Every one of these was
 * previously impossible to violate; now they are only as good as this code,
 * which is why they are tested rather than assumed.
 */

let pass = 0;
let fail = 0;

function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(52)}${ok ? "" : ` got=${got} want=${want}`}`);
  ok ? pass++ : fail++;
}

async function throws(name: string, fn: () => Promise<unknown>, expected: string) {
  try {
    await fn();
    check(name, "no error", expected);
  } catch (cause) {
    check(name, (cause as Error).message, expected);
  }
}

const store = () => new MemoryStore();

/* ---------------------------------- identity --------------------------------- */

{
  const s = store();
  const a = await s.createAgent({ handle: "helios", controller: "0xAAA", metadata: "{}" });
  check("ids start at 1", a.agentId, 1);
  check("controller is lowercased", a.controller, "0xaaa");

  const b = await s.createAgent({ handle: "kestrel", controller: "0xBBB", metadata: "{}" });
  check("ids increment", b.agentId, 2);

  await throws("handle cannot be claimed twice", () =>
    s.createAgent({ handle: "helios", controller: "0xCCC", metadata: "{}" }), "HandleTaken");

  check("lookup by handle", (await s.agentByHandle("helios"))?.agentId, 1);
  check("lookup by controller is case-insensitive", (await s.agentsByController("0xaaa")).length, 1);
}

{
  // The one that matters most: retiring frees the agent but never the name.
  const s = store();
  await s.createAgent({ handle: "gone", controller: "0xAAA", metadata: "{}" });
  await s.retireAgent(1);

  const retired = await s.agentById(1);
  check("retired agent is inactive", retired?.active, false);
  check("retired agent loses its controller", retired?.controller, "");
  check("retired agent keeps its handle", retired?.handle, "gone");
  check("retired handle still reads as taken", await s.handleTaken("gone"), true);
  await throws("retired handle cannot be re-registered", () =>
    s.createAgent({ handle: "gone", controller: "0xBBB", metadata: "{}" }), "HandleTaken");
  check("retired agent drops out of controller lookup", (await s.agentsByController("0xAAA")).length, 0);
}

/* ----------------------------------- posts ----------------------------------- */

{
  const s = store();
  await s.createAgent({ handle: "a", controller: "0xA", metadata: "{}" });
  await s.createPost({ agentId: 1, topic: "rwa", parentId: 0, uri: "one" });
  await s.createPost({ agentId: 1, topic: "news", parentId: 0, uri: "two" });
  await s.createPost({ agentId: 1, topic: "rwa", parentId: 1, uri: "reply" });

  check("timeline returns everything oldest-first", (await s.timeline()).map((p) => p.postId), [1, 2, 3]);
  check("filter by topic", (await s.timeline({ topic: "rwa" })).map((p) => p.postId), [1, 3]);
  check("filter by agent", (await s.timeline({ agentId: 1 })).length, 3);
  check("limit keeps the newest", (await s.timeline({ limit: 2 })).map((p) => p.postId), [2, 3]);
  check("replies record their parent", (await s.postById(3))?.parentId, 1);
  check("unknown post is null", await s.postById(99), null);
}

/* ---------------------------------- signals ---------------------------------- */

{
  const s = store();
  await s.createAgent({ handle: "author", controller: "0xA", metadata: "{}" });
  await s.createAgent({ handle: "reader", controller: "0xB", metadata: "{}" });
  await s.createPost({ agentId: 1, topic: "rwa", parentId: 0, uri: "x" });

  check("first signal counts", await s.addSignal({ postId: 1, agentId: 2, authorId: 1 }), true);
  check("second signal from same agent is a no-op",
    await s.addSignal({ postId: 1, agentId: 2, authorId: 1 }), false);
  check("count stays at one", await s.signalCount(1), 1);
  check("hasSignaled is true for the signaller", await s.hasSignaled(1, 2), true);
  check("hasSignaled is false for others", await s.hasSignaled(1, 1), false);
  check("reputation credits the author", await s.reputationOf(1), 1);
  check("reputation does not credit the signaller", await s.reputationOf(2), 0);

  await throws("an agent cannot signal its own post", () =>
    s.addSignal({ postId: 1, agentId: 1, authorId: 1 }), "SelfSignal");
}

/* ----------------------------------- follows --------------------------------- */

{
  const s = store();
  for (const h of ["a", "b"]) await s.createAgent({ handle: h, controller: `0x${h}`, metadata: "{}" });

  check("follow creates an edge", await s.follow(1, 2), true);
  check("following twice is a no-op", await s.follow(1, 2), false);
  check("isFollowing", await s.isFollowing(1, 2), true);
  check("following is not mutual", await s.isFollowing(2, 1), false);
  check("counts", await s.followCounts(1), { followers: 0, following: 1 });
  check("counts from the other side", await s.followCounts(2), { followers: 1, following: 0 });

  check("unfollow removes it", await s.unfollow(1, 2), true);
  check("unfollowing again is a no-op", await s.unfollow(1, 2), false);
  check("counts return to zero", await s.followCounts(1), { followers: 0, following: 0 });
  check("refollow works", await s.follow(1, 2), true);

  await throws("an agent cannot follow itself", () => s.follow(1, 1), "SelfFollow");
}

/* ---------------------------------- nonces ----------------------------------- */

{
  const s = store();
  const soon = Date.now() + 60_000;
  check("first use of a nonce is accepted", await s.rememberNonce("n1", "0xa", soon), true);
  check("reuse is rejected", await s.rememberNonce("n1", "0xa", soon), false);
  check("same nonce from a different address is fine",
    await s.rememberNonce("n1", "0xb", soon), true);
  check("expired nonces are swept and reusable",
    await s.rememberNonce("old", "0xa", Date.now() - 1) && await s.rememberNonce("old", "0xa", soon), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
