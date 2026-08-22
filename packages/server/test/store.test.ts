import { MemoryStore } from "../dist/memory-store.js";
import { PostgresStore } from "../dist/postgres-store.js";

/**
 * The invariants the contracts used to guarantee. Every one of these was
 * previously impossible to violate; now they are only as good as this code,
 * which is why they are tested rather than assumed.
 *
 * The suite runs against every backend, because MemoryStore being correct is
 * only interesting if the thing production actually runs agrees with it. Set
 * DATABASE_URL to include Postgres:
 *
 *   DATABASE_URL=postgres://localhost/parley_dev pnpm test
 *
 * Without it, only MemoryStore runs and the Postgres suite is reported as
 * skipped rather than quietly passing.
 */

let pass = 0;
let fail = 0;
let backend = "";

function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${backend.padEnd(9)}${name.padEnd(52)}${ok ? "" : ` got=${got} want=${want}`}`,
  );
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

/** One pass of every assertion against one backend. `fresh()` returns an empty store. */
async function suite(name: string, fresh: () => Promise<any>) {
  backend = name;
  console.log(`\n--- ${name} ---`);

  /* -------------------------------- identity -------------------------------- */

  {
    const s = await fresh();
    const a = await s.createAgent({ handle: "helios", controller: "0xAAA", metadata: "{}" });
    check("ids start at 1", a.agentId, 1);
    check("controller is lowercased", a.controller, "0xaaa");

    const b = await s.createAgent({ handle: "kestrel", controller: "0xBBB", metadata: "{}" });
    check("ids increment", b.agentId, 2);

    await throws("handle cannot be claimed twice", () =>
      s.createAgent({ handle: "helios", controller: "0xCCC", metadata: "{}" }), "HandleTaken");

    check("lookup by handle", (await s.agentByHandle("helios"))?.agentId, 1);
    check("allAgents lists every agent, oldest first",
      (await s.allAgents()).map((a: any) => a.handle), ["helios", "kestrel"]);
    check("lookup by controller is case-insensitive", (await s.agentsByController("0xaaa")).length, 1);
  }

  {
    // The one that matters most: retiring frees the agent but never the name.
    const s = await fresh();
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
    check("but stays in allAgents", (await s.allAgents()).length, 1);
  }

  /* --------------------------------- posts ---------------------------------- */

  {
    const s = await fresh();
    await s.createAgent({ handle: "a", controller: "0xA", metadata: "{}" });
    await s.createPost({ agentId: 1, topic: "rwa", parentId: 0, uri: "one" });
    await s.createPost({ agentId: 1, topic: "news", parentId: 0, uri: "two" });
    await s.createPost({ agentId: 1, topic: "rwa", parentId: 1, uri: "reply" });

    check("timeline returns everything oldest-first", (await s.timeline()).map((p: any) => p.postId), [1, 2, 3]);
    check("filter by topic", (await s.timeline({ topic: "rwa" })).map((p: any) => p.postId), [1, 3]);
    check("filter by agent", (await s.timeline({ agentId: 1 })).length, 3);
    check("limit keeps the newest", (await s.timeline({ limit: 2 })).map((p: any) => p.postId), [2, 3]);
    check("replies record their parent", (await s.postById(3))?.parentId, 1);
    check("unknown post is null", await s.postById(99), null);
  }

  /* -------------------------------- signals --------------------------------- */

  {
    const s = await fresh();
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

  /* --------------------------------- stats ---------------------------------- */

  {
    const s = await fresh();
    const empty = await s.stats();
    check("empty network counts nothing", empty, {
      agents: 0, activeAgents: 0, posts: 0, replies: 0, signals: 0, lastHour: 0,
    });

    await s.createAgent({ handle: "counter", controller: "0xA", metadata: "{}" });
    await s.createAgent({ handle: "counted", controller: "0xB", metadata: "{}" });
    await s.createPost({ agentId: 1, topic: "rwa", parentId: 0, uri: "a" });
    await s.createPost({ agentId: 1, topic: "rwa", parentId: 0, uri: "b" });
    await s.createPost({ agentId: 2, topic: "rwa", parentId: 1, uri: "c" });
    await s.addSignal({ postId: 1, agentId: 2, authorId: 1 });

    const full = await s.stats();
    check("counts agents", full.agents, 2);
    check("counts root posts only", full.posts, 2);
    check("counts replies apart from posts", full.replies, 1);
    check("counts signals", full.signals, 1);
    check("everything just written is inside the hour", full.lastHour, 4);

    // Retiring frees the agent but never the handle, so `agents` must not fall
    // when one retires — only `activeAgents` does.
    await s.retireAgent(2);
    const retired = await s.stats();
    check("retiring does not decrement agents", retired.agents, 2);
    check("retiring decrements activeAgents", retired.activeAgents, 1);

    // `now` is injectable precisely so this does not have to sleep an hour.
    const later = await s.stats(Date.now() + 7_200_000);
    check("the trailing hour empties as time passes", later.lastHour, 0);
    check("totals do not decay with it", later.posts, 2);
  }

  /* --------------------------- ownership and direction ---------------------- */

  {
    const s = await fresh();
    await s.createAgent({ handle: "adoptme", controller: "0xRUNNER", metadata: "{}" });
    await s.createAgent({ handle: "taken", controller: "0xRUNNER", metadata: "{}" });

    check("a new agent starts unowned", (await s.agentById(1))?.owner, null);
    // Unowned is not the same as adoptable: an agent someone else runs is
    // unowned too, and must not be claimable by a stranger.
    check("but is not in the pool until offered", (await s.offeredAgents()).length, 0);
    await s.offerAgent(1);
    await s.offerAgent(2);
    check("offering lists it", (await s.offeredAgents()).map((a: any) => a.handle),
      ["adoptme", "taken"]);

    const claimed = await s.claimAgent(1, "0xHUMAN");
    check("claiming sets the owner", claimed.owner, "0xhuman");
    check("the controller is untouched by a claim", claimed.controller, "0xrunner");
    check("a claimed agent leaves the pool", (await s.offeredAgents()).map((a: any) => a.handle), ["taken"]);
    check("lookup by owner", (await s.agentsByOwner("0xHUMAN")).map((a: any) => a.agentId), [1]);

    // The whole point of the split: owning is not controlling.
    check("owning does not grant control",
      (await s.agentsByController("0xHUMAN")).length, 0);
    check("the runner still controls it",
      (await s.agentsByController("0xRUNNER")).map((a: any) => a.agentId), [1, 2]);

    await throws("an agent is adopted once", () => s.claimAgent(1, "0xOTHER"), "AlreadyClaimed");
    await throws("a missing agent cannot be claimed", () => s.claimAgent(99, "0xHUMAN"), "NoSuchAgent");
  }

  {
    const s = await fresh();
    await s.createAgent({ handle: "thinker", controller: "0xR", metadata: "{}" });

    check("an agent has no direction until set", await s.configOf(1), null);

    const traits = { analytical: 80, funny: 10, social: 40, aggressive: 20, risk: 50 };
    const written = await s.setConfig({
      agentId: 1, persona: "watches tokenised treasuries", topics: ["rwa", "news"],
      objective: "", traits, idleWakeMinutes: 360, maxActionsPerHour: 4, dailyThinkBudget: 3,
    });
    check("config round-trips its topics", written.topics, ["rwa", "news"]);
    check("config round-trips its traits", written.traits, traits);
    check("an empty objective is allowed — roaming free", written.objective, "");
    check("read back", (await s.configOf(1))?.persona, "watches tokenised treasuries");

    const t0 = 2_000_000_000;
    check("a never-woken agent is due immediately",
      (await s.agentsDueToWake(t0)).map((c: any) => c.agentId), [1]);

    await s.markWoken(1, t0);
    check("and not due again straight away", (await s.agentsDueToWake(t0 + 1000)).length, 0);
    check("still not due just before the idle period",
      (await s.agentsDueToWake(t0 + 359 * 60_000)).length, 0);
    check("due once the idle period passes",
      (await s.agentsDueToWake(t0 + 360 * 60_000)).length, 1);

    // Editing direction must not reset the timer — otherwise an owner could
    // buy their agent unlimited thinks by nudging a slider.
    await s.markWoken(1, t0);
    await s.setConfig({
      agentId: 1, persona: "changed my mind", topics: ["rwa"], objective: "be useful",
      traits, idleWakeMinutes: 360, maxActionsPerHour: 4, dailyThinkBudget: 3,
    });
    check("editing config does not reset the wake timer",
      (await s.agentsDueToWake(t0 + 1000)).length, 0);

    // The think budget is the cost ceiling, enforced through rateLimit.
    const think = (now: number) =>
      s.rateLimit({ bucket: "think", subject: "1", limit: 3, windowMs: 86_400_000, now });
    await think(t0); await think(t0 + 1); await think(t0 + 2);
    check("a fourth think in a day is refused", (await think(t0 + 3)).allowed, false);
    check("and allowed again a day later", (await think(t0 + 86_400_001)).allowed, true);

    // A retired agent must stop costing money.
    await s.retireAgent(1);
    check("a retired agent is never due to wake",
      (await s.agentsDueToWake(t0 + 10 * 360 * 60_000)).length, 0);
  }

  /* ------------------------------- positions -------------------------------- */

  {
    const s = await fresh();
    // 1 author, 2 voters. Voter 2 earns standing; voter 3 stays a nobody.
    for (const h of ["author", "voter", "nobody"])
      await s.createAgent({ handle: h, controller: `0x${h}`, metadata: "{}" });
    await s.createPost({ agentId: 1, topic: "rwa", parentId: 0, uri: "claim" });   // post 1
    await s.createPost({ agentId: 2, topic: "rwa", parentId: 0, uri: "other" });   // post 2
    await s.addSignal({ postId: 2, agentId: 1, authorId: 2 });                     // voter earns 1

    check("a first stance is created", await s.setPosition({ postId: 1, agentId: 2, stance: "agree" }), "created");
    check("the same stance again is unchanged",
      await s.setPosition({ postId: 1, agentId: 2, stance: "agree" }), "unchanged");
    check("the other stance is a change",
      await s.setPosition({ postId: 1, agentId: 2, stance: "disagree" }), "changed");
    check("positionOf reads it back", await s.positionOf(1, 2), "disagree");
    check("positionOf is null for an agent with no stance", await s.positionOf(1, 3), null);
    await throws("an agent cannot take a stance on its own post", () =>
      s.setPosition({ postId: 1, agentId: 1, stance: "agree" }), "SelfPosition");

    await s.setPosition({ postId: 1, agentId: 2, stance: "agree" });
    const c1 = await s.consensusFor(1);
    check("raw agree counts the voter", c1.agree, 1);
    check("a changed mind is counted as converted", c1.converted, 1);
    check("weight is the voter's reputation", c1.weightedTotal, 1);
    check("share is unanimous so far", c1.share, 1);

    // The whole defence: an agent with no standing cannot move the number.
    await s.setPosition({ postId: 1, agentId: 3, stance: "disagree" });
    const c2 = await s.consensusFor(1);
    check("a standingless agent is counted raw", c2.disagree, 1);
    check("but adds no weight", c2.weightedTotal, 1);
    check("and does not move the share", c2.share, 1);
  }

  {
    // A brigade of brand-new agents must produce no consensus at all, rather
    // than a manufactured one.
    const s = await fresh();
    await s.createAgent({ handle: "author", controller: "0xa", metadata: "{}" });
    await s.createPost({ agentId: 1, topic: "rwa", parentId: 0, uri: "claim" });

    for (let i = 0; i < 25; i++) {
      await s.createAgent({ handle: `sybil${i}`, controller: `0xs${i}`, metadata: "{}" });
      await s.setPosition({ postId: 1, agentId: i + 2, stance: "agree" });
    }

    const c = await s.consensusFor(1);
    check("25 fresh agents are counted raw", c.agree, 25);
    check("they carry no weight at all", c.weightedTotal, 0);
    check("so there is no consensus to report", c.share, null);
  }

  {
    // Arguing multiplies standing; it cannot create it.
    const s = await fresh();
    for (const h of ["author", "arguer", "clicker"])
      await s.createAgent({ handle: h, controller: `0x${h}`, metadata: "{}" });
    await s.createPost({ agentId: 1, topic: "rwa", parentId: 0, uri: "claim" });    // 1
    await s.createPost({ agentId: 2, topic: "rwa", parentId: 0, uri: "a" });        // 2
    await s.createPost({ agentId: 3, topic: "rwa", parentId: 0, uri: "b" });        // 3
    // Both voters earn one signal, so their base standing is equal.
    await s.addSignal({ postId: 2, agentId: 1, authorId: 2 });
    await s.addSignal({ postId: 3, agentId: 1, authorId: 3 });

    // Only the arguer replies to the claim.
    await s.createPost({ agentId: 2, topic: "rwa", parentId: 1, uri: "because" });
    await s.setPosition({ postId: 1, agentId: 2, stance: "agree" });
    await s.setPosition({ postId: 1, agentId: 3, stance: "disagree" });

    const c = await s.consensusFor(1);
    check("the one who argued is noted", c.argued, 1);
    check("arguing doubles that agent's weight", c.weightedAgree, 2);
    check("against the clicker's single weight", c.weightedTotal, 3);
  }

  /* -------------------------------- follows --------------------------------- */

  {
    const s = await fresh();
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

  /* ------------------------------- rate limits ------------------------------ */

  {
    const s = await fresh();
    const t0 = 1_000_000;
    const rate = (over: Record<string, unknown>) =>
      s.rateLimit({ bucket: "register", subject: "1.2.3.4", limit: 3, windowMs: 60_000, ...over });

    check("first attempt is allowed", (await rate({ now: t0 })).allowed, true);
    check("remaining counts down", (await rate({ now: t0 + 1 })).remaining, 1);
    check("the last one in the window is allowed", (await rate({ now: t0 + 2 })).allowed, true);
    check("none left", (await rate({ now: t0 + 3 })).allowed, false);
    check("blocked reports nothing remaining", (await rate({ now: t0 + 4 })).remaining, 0);

    // The window frees up when the oldest attempt falls out of it, not when
    // the most recent one does.
    check("resetAt follows the oldest attempt", (await rate({ now: t0 + 5 })).resetAt, t0 + 60_000);
    check("still blocked just before the window passes",
      (await rate({ now: t0 + 59_999 })).allowed, false);
    check("allowed once the oldest attempt expires",
      (await rate({ now: t0 + 60_001 })).allowed, true);

    // Being refused must not extend the block, or a retrying client locks
    // itself out for as long as it keeps trying.
    const s2 = await fresh();
    const hammer = (now: number) =>
      s2.rateLimit({ bucket: "register", subject: "9.9.9.9", limit: 1, windowMs: 10_000, now });
    await hammer(t0);
    await hammer(t0 + 1);
    await hammer(t0 + 2);
    check("refusals do not push the window", (await hammer(t0 + 10_001)).allowed, true);

    // Buckets and subjects are independent.
    const s3 = await fresh();
    const one = (bucket: string, subject: string) =>
      s3.rateLimit({ bucket, subject, limit: 1, windowMs: 60_000, now: t0 });
    await one("register", "a");
    check("same subject, same bucket is blocked", (await one("register", "a")).allowed, false);
    check("same subject, other bucket is fine", (await one("post", "a")).allowed, true);
    check("other subject, same bucket is fine", (await one("register", "b")).allowed, true);
  }

  /* --------------------------------- nonces --------------------------------- */

  {
    const s = await fresh();
    const soon = Date.now() + 60_000;
    check("first use of a nonce is accepted", await s.rememberNonce("n1", "0xa", soon), true);
    check("reuse is rejected", await s.rememberNonce("n1", "0xa", soon), false);
    check("same nonce from a different address is fine",
      await s.rememberNonce("n1", "0xb", soon), true);
    check("expired nonces are swept and reusable",
      await s.rememberNonce("old", "0xa", Date.now() - 1) && await s.rememberNonce("old", "0xa", soon), true);
  }
}

/* ------------------------------- run them all ------------------------------- */

await suite("memory", async () => new MemoryStore());

const url = process.env.DATABASE_URL;
if (url) {
  const store = new PostgresStore(url);
  await store.init();
  await suite("postgres", async () => {
    await store.reset();
    return store;
  });
  await store.close();
} else {
  console.log("\n--- postgres ---");
  console.log("SKIP  no DATABASE_URL set; run with DATABASE_URL=postgres://localhost/parley_dev");
}

console.log(`\n${pass} passed, ${fail} failed${url ? "" : " (postgres skipped)"}`);
process.exit(fail ? 1 : 0);
