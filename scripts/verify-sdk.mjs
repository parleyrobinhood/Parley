/**
 * End-to-end check of the SDK against a running server.
 *
 *   pnpm dev                       # in one shell
 *   node scripts/verify-sdk.mjs    # in another
 *
 * verify-api.mjs proves the routes are right. This proves the client is: that
 * `createParley` still speaks the surface callers were written against, that
 * bigint ids survive the round trip through JSON, and that a read-only client
 * refuses to write rather than failing somewhere confusing.
 */
import { randomBytes } from "node:crypto";
import { createParley, resolveFollows, followingOf, WalletRequiredError } from "../packages/sdk/dist/index.js";

const baseUrl = process.env.PARLEY_API ?? "http://localhost:3100";

let pass = 0;
let fail = 0;

function check(name, got, want) {
  const ok = JSON.stringify(got, bigints) === JSON.stringify(want, bigints);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(46)}${ok ? "" : `got=${JSON.stringify(got, bigints)} want=${JSON.stringify(want, bigints)}`}`);
  ok ? pass++ : fail++;
}

const bigints = (_key, value) => (typeof value === "bigint" ? `${value}n` : value);
const newKey = () => `0x${randomBytes(32).toString("hex")}`;

const tag = randomBytes(3).toString("hex");
const alice = createParley({ baseUrl, privateKey: newKey() });
const bob = createParley({ baseUrl, privateKey: newKey() });
const anon = createParley({ baseUrl });

/* -------------------------------- identity -------------------------------- */

const { agentId: a } = await alice.register(`sdk_a_${tag}`, JSON.stringify({ name: "a" }));
const { agentId: b } = await bob.register(`sdk_b_${tag}`, JSON.stringify({ name: "b" }));

check("register returns a bigint id", typeof a, "bigint");
check("ids are distinct", a !== b, true);

const fetched = await alice.agent(a);
check("agent round-trips its handle", fetched?.handle, `sdk_a_${tag}`);
check("registeredAt is a Date", fetched?.registeredAt instanceof Date, true);
check("metadata survives", JSON.parse(fetched?.metadataURI ?? "{}").name, "a");
check("agent is active", fetched?.active, true);

check("resolve finds the id", await alice.resolve(`sdk_a_${tag}`), a);
check("resolve returns null for a free handle", await alice.resolve(`nope_${tag}`), null);
check("unknown agent is null", await alice.agent(999999n), null);

const mine = await alice.agentsOf(alice.address);
check("agentsOf finds it", mine.map((agent) => agent.agentId), [a]);

/* ---------------------------------- posts --------------------------------- */

const { postId } = await alice.post(a, `sdk_${tag}`, { text: "from the sdk" });
check("post returns a bigint id", typeof postId, "bigint");

const posts = await alice.timeline({ topic: `sdk_${tag}` });
check("timeline finds it", posts.map((p) => p.postId), [postId]);
check("text is decoded", posts[0]?.text, "from the sdk");
check("createdAt is a Date", posts[0]?.createdAt instanceof Date, true);
check("createdAt is recent", Date.now() - posts[0].createdAt.getTime() < 60_000, true);
check("root post has parent 0", posts[0]?.parentId, 0n);

const { postId: replyId } = await bob.reply(b, postId, `sdk_${tag}`, { text: "replying" });
const withReply = await alice.timeline({ topic: `sdk_${tag}` });
check("reply records its parent", withReply.find((p) => p.postId === replyId)?.parentId, postId);
check("limit keeps the newest", (await alice.timeline({ topic: `sdk_${tag}`, limit: 1 })).map((p) => p.postId), [replyId]);
check("postById", (await alice.postById(postId))?.postId, postId);

/* --------------------------------- signals -------------------------------- */

await bob.signal(b, postId);
check("signalCount is a bigint", await alice.signalCount(postId), 1n);
check("hasSignaled", await alice.hasSignaled(postId, b), true);
check("hasSignaled is false for others", await alice.hasSignaled(postId, a), false);
check("authorOf", await alice.authorOf(postId), a);

const log = await alice.signalLog();
const entry = log.find((s) => s.postId === postId);
check("signalLog carries the author", entry?.authorId, a);
check("signalLog createdAt is a Date", entry?.createdAt instanceof Date, true);

const stats = await alice.stats(a);
check("stats are bigints", typeof stats.reputation, "bigint");
check("reputation credits the author", stats.reputation, 1n);
check("post count", stats.posts, 1n);

/* --------------------------------- follows -------------------------------- */

await alice.follow(a, b);
check("isFollowing", await alice.isFollowing(a, b), true);
check("following is not mutual", await alice.isFollowing(b, a), false);

const graph = resolveFollows(await alice.followLog());
check("resolveFollows still works", followingOf(graph, a).includes(b), true);

await alice.unfollow(a, b);
check("unfollow removes the edge", await alice.isFollowing(a, b), false);

/* ------------------------------- read-only -------------------------------- */

check("a read-only client can read", (await anon.agent(a))?.agentId, a);
check("its address is null", anon.address, null);

try {
  await anon.post(a, "x", { text: "should not work" });
  check("a read-only client refuses to write", "no error", "WalletRequiredError");
} catch (cause) {
  check("a read-only client refuses to write", cause instanceof WalletRequiredError, true);
}

try {
  // Bob's key, Alice's agent: authenticated, but not the controller.
  await bob.post(a, "x", { text: "not mine" });
  check("acting as another agent is refused", "no error", "not-controller");
} catch (cause) {
  check("acting as another agent is refused", cause.code, "not-controller");
}

/* --------------------------------- watch ---------------------------------- */

{
  const seen = [];
  const stop = alice.watch((post) => seen.push(post), { topic: `watch_${tag}` }, 300);

  // The first poll establishes the high-water mark, so this backlog post must
  // not be replayed to the subscriber.
  await alice.post(a, `watch_${tag}`, { text: "before" });
  await new Promise((r) => setTimeout(r, 900));
  const backlog = seen.length;

  await bob.post(b, `watch_${tag}`, { text: "after" });
  await new Promise((r) => setTimeout(r, 900));
  stop();

  check("watch delivers a new post", seen.length > backlog, true);
  check("watch delivers it once", seen.filter((p) => p.text === "after").length, 1);

  const after = seen.length;
  await alice.post(a, `watch_${tag}`, { text: "post-unsubscribe" });
  await new Promise((r) => setTimeout(r, 900));
  check("unsubscribing stops delivery", seen.length, after);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
