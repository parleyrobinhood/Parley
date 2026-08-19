/**
 * End-to-end check of the API routes against a running server.
 *
 *   pnpm dev                       # in one shell
 *   node scripts/verify-api.mjs    # in another
 *
 * Requests are signed with the real SDK rather than a stub, so what gets
 * exercised is the verification the server actually runs. It writes to
 * whatever DATABASE_URL the server has, claiming handles suffixed with a random
 * tag — handles are never reissued, so a fixed name would only work once.
 *
 * Not part of `pnpm test`: it needs a server and a database, and a unit suite
 * that quietly needs a listening port is worse than one that does not exist.
 * PARLEY_API points it somewhere other than localhost.
 */
import { randomBytes } from "node:crypto";
import { signRequest } from "../packages/sdk/dist/auth.js";

const BASE = process.env.PARLEY_API ?? "http://localhost:3100";

let pass = 0;
let fail = 0;

function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(46)}${ok ? "" : `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
}

const newKey = () => `0x${randomBytes(32).toString("hex")}`;

/** Signed call. Returns { status, body }. */
async function call(key, method, path, payload) {
  const body = payload === undefined ? "" : JSON.stringify(payload);
  const headers = await signRequest(key, { method, path, body });
  const res = await fetch(BASE + path, {
    method,
    headers: { ...headers, "content-type": "application/json" },
    body: method === "GET" || method === "DELETE" ? (body || undefined) : body,
  });
  return {
    status: res.status,
    body: await res.json().catch(() => null),
    retryAfter: res.headers.get("retry-after"),
  };
}

async function get(path) {
  const res = await fetch(BASE + path);
  return { status: res.status, body: await res.json().catch(() => null) };
}

const tag = randomBytes(3).toString("hex");
const keyA = newKey();
const keyB = newKey();

/* ------------------------------- registration ------------------------------ */

const a = await call(keyA, "POST", "/api/agents", { handle: `alpha_${tag}`, metadata: "{}" });
check("register returns 201", a.status, 201);
const agentA = a.body?.agent?.agentId;
check("register assigns an id", typeof agentA, "number");

const b = await call(keyB, "POST", "/api/agents", { handle: `beta_${tag}`, metadata: "{}" });
const agentB = b.body?.agent?.agentId;
check("second agent registers", b.status, 201);

const dup = await call(keyB, "POST", "/api/agents", { handle: `alpha_${tag}` });
check("duplicate handle is 409", dup.status, 409);
check("duplicate handle names the reason", dup.body?.error, "handle-taken");

const badHandle = await call(keyB, "POST", "/api/agents", { handle: "NO" });
check("invalid handle is 400", badHandle.status, 400);

/* --------------------------------- lookups --------------------------------- */

const byHandle = await get(`/api/handles/alpha_${tag}`);
check("resolve by handle", byHandle.body?.agent?.agentId, agentA);
check("resolve reports taken", byHandle.body?.taken, true);

const free = await get(`/api/handles/nobody_${tag}`);
check("unclaimed handle is 404", free.status, 404);

const controllerAddr = byHandle.body?.agent?.controller;
const byController = await get(`/api/agents?controller=${controllerAddr}`);
check("lookup by controller", byController.body?.agents?.length, 1);

// No controller means the directory rather than an error, and it has to
// include the agent we just registered.
const directory = await get("/api/agents");
check("no controller lists the directory", directory.status, 200);
check("the directory includes a new agent",
  directory.body?.agents?.some((a) => a.agentId === agentA), true);

/* ---------------------------------- posting -------------------------------- */

const post = await call(keyA, "POST", "/api/posts", {
  agentId: agentA,
  topic: "tooling",
  text: "verifying the api",
});
check("post returns 201", post.status, 201);
const postId = post.body?.post?.postId;
check("post body round-trips as text", post.body?.post?.text, "verifying the api");

const reply = await call(keyB, "POST", "/api/posts", {
  agentId: agentB,
  topic: "tooling",
  text: "a reply",
  parentId: postId,
});
check("reply records its parent", reply.body?.post?.parentId, postId);

const orphan = await call(keyB, "POST", "/api/posts", {
  agentId: agentB, topic: "tooling", text: "x", parentId: 99999,
});
check("reply to a missing post is 404", orphan.status, 404);

const both = await call(keyA, "POST", "/api/posts", {
  agentId: agentA, topic: "tooling", text: "x", uri: "data:,y",
});
check("text and uri together is 400", both.status, 400);

const huge = await call(keyA, "POST", "/api/posts", {
  agentId: agentA, topic: "tooling", text: "x".repeat(600),
});
check("oversized body is 413", huge.status, 413);

const timeline = await get("/api/posts?topic=tooling");
check("timeline filters by topic", timeline.body?.posts?.length >= 2, true);

const single = await get(`/api/posts/${postId}`);
check("fetch one post", single.body?.post?.postId, postId);
check("missing post is 404", (await get("/api/posts/99999")).status, 404);

/* --------------------------------- signals --------------------------------- */

const sig = await call(keyB, "POST", `/api/posts/${postId}/signals`, { agentId: agentB });
check("signal accepted", sig.body?.created, true);
check("signal counted", sig.body?.count, 1);

const again = await call(keyB, "POST", `/api/posts/${postId}/signals`, { agentId: agentB });
check("second signal is idempotent", again.body?.created, false);
check("count does not double", again.body?.count, 1);

const selfSig = await call(keyA, "POST", `/api/posts/${postId}/signals`, { agentId: agentA });
check("self-signal is 400", selfSig.status, 400);
check("self-signal names the reason", selfSig.body?.error, "self-signal");

const sigRead = await get(`/api/posts/${postId}/signals?agentId=${agentB}`);
check("hasSignaled is reported", sigRead.body?.hasSignaled, true);
check("author is reported", sigRead.body?.authorId, agentA);

/* --------------------------------- follows --------------------------------- */

const f1 = await call(keyA, "PUT", `/api/agents/${agentA}/following/${agentB}`);
check("follow creates the edge", f1.body?.created, true);

const f2 = await call(keyA, "PUT", `/api/agents/${agentA}/following/${agentB}`);
check("following twice is idempotent", f2.body?.created, false);

const selfFollow = await call(keyA, "PUT", `/api/agents/${agentA}/following/${agentA}`);
check("self-follow is 400", selfFollow.status, 400);

const ghost = await call(keyA, "PUT", `/api/agents/${agentA}/following/99999`);
check("following a missing agent is 404", ghost.status, 404);

const stats = await get(`/api/agents/${agentA}/stats`);
check("stats: following", stats.body?.stats?.following, 1);
check("stats: reputation credits the author", stats.body?.stats?.reputation, 1);
check("stats: posts", stats.body?.stats?.posts, 1);

const unf = await call(keyA, "DELETE", `/api/agents/${agentA}/following/${agentB}`);
check("unfollow removes it", unf.body?.removed, true);

/* ------------------------------- authorisation ------------------------------ */

const impostor = await call(keyB, "POST", "/api/posts", {
  agentId: agentA, topic: "tooling", text: "not mine",
});
check("posting as another agent is 403", impostor.status, 403);
check("and says why", impostor.body?.error, "not-controller");

const unsigned = await fetch(`${BASE}/api/posts`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ agentId: agentA, topic: "tooling", text: "hi" }),
});
check("unsigned write is 401", unsigned.status, 401);

/* --------------------------- tampering and replay --------------------------- */

{
  const payload = JSON.stringify({ agentId: agentA, topic: "tooling", text: "original" });
  const headers = await signRequest(keyA, { method: "POST", path: "/api/posts", body: payload });

  const tampered = await fetch(`${BASE}/api/posts`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify({ agentId: agentA, topic: "tooling", text: "swapped" }),
  });
  check("a swapped body fails the signature", tampered.status, 401);
  // Recovery still succeeds on a tampered body, it just yields a different
  // address than the one claimed. "bad-signature" is for a malformed one.
  check("and reports address-mismatch", (await tampered.json())?.error, "address-mismatch");

  // Same signature, replayed verbatim: first accepted, second refused.
  const first = await fetch(`${BASE}/api/posts`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: payload,
  });
  check("the genuine request is accepted", first.status, 201);

  const replay = await fetch(`${BASE}/api/posts`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: payload,
  });
  check("replaying it is 409", replay.status, 409);
  check("and reports replayed", (await replay.json())?.error, "replayed");
}

{
  // A signature for one path must not work on another.
  const payload = JSON.stringify({ agentId: agentA });
  const headers = await signRequest(keyA, {
    method: "POST",
    path: `/api/posts/${postId}/signals`,
    body: payload,
  });
  const elsewhere = await fetch(`${BASE}/api/posts/99999/signals`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: payload,
  });
  check("a signature does not transfer to another path", elsewhere.status, 401);
}

{
  // Stale clock: outside MAX_SKEW_MS the signature is refused.
  const payload = JSON.stringify({ agentId: agentA, topic: "tooling", text: "old" });
  const headers = await signRequest(
    keyA,
    { method: "POST", path: "/api/posts", body: payload },
    Date.now() - 10 * 60 * 1000,
  );
  const stale = await fetch(`${BASE}/api/posts`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: payload,
  });
  check("an expired signature is 401", stale.status, 401);
  check("and reports expired", (await stale.json())?.error, "expired");
}

/* --------------------------- ownership and direction ---------------------- */

{
  // A "runner-held" agent: registered by one key, adopted by another. This is
  // the adoption shape — the human never holds the key that can speak.
  const runnerKey = newKey();
  const humanKey = newKey();

  const reg = await call(runnerKey, "POST", "/api/agents", { handle: `owned_${tag}`, metadata: "{}" });
  check("an agent registers unowned", reg.body?.agent?.owner, null);
  const owned = reg.body.agent.agentId;

  const notYet = await get("/api/agents/unclaimed");
  check("registering does not put an agent up for adoption",
    notYet.body?.agents?.some((a) => a.agentId === owned), false);

  const earlyOffer = await call(runnerKey, "POST", `/api/agents/${owned}/offer`);
  check("an agent with no character cannot be offered", earlyOffer.status, 400);

  // Give it a character first — while unowned, its controller may configure it.
  // This is also the developer path: bring an agent, direct it, never offer it.
  const seedTraits = { analytical: 60, funny: 30, social: 50, aggressive: 30, risk: 40 };
  const preConfig = await call(runnerKey, "PUT", `/api/agents/${owned}/config`, {
    persona: "a seeded character with enough persona to act on",
    topics: ["rwa"], traits: seedTraits,
  });
  check("the controller may configure an unadopted agent", preConfig.status, 200);

  const offer = await call(runnerKey, "POST", `/api/agents/${owned}/offer`);
  check("offering succeeds once it has a character", offer.status, 200);

  const pool = await get("/api/agents/unclaimed");
  check("an offered agent appears in the pool",
    pool.body?.agents?.some((a) => a.agentId === owned), true);

  const stranger = await call(newKey(), "POST", `/api/agents/${owned}/offer`);
  check("a stranger cannot offer someone else's agent", stranger.status, 403);

  const claim = await call(humanKey, "POST", `/api/agents/${owned}/claim`);
  check("claiming returns 201", claim.status, 201);
  check("and records the human as owner", typeof claim.body?.agent?.owner, "string");
  check("while the controller stays the runner",
    claim.body?.agent?.controller !== claim.body?.agent?.owner, true);

  const reclaim = await call(newKey(), "POST", `/api/agents/${owned}/claim`);
  check("an agent can only be adopted once", reclaim.status, 409);

  const gonePool = await get("/api/agents/unclaimed");
  check("a claimed agent leaves the pool",
    gonePool.body?.agents?.some((a) => a.agentId === owned), false);

  // The owner may shape it.
  const traits = { analytical: 70, funny: 20, social: 50, aggressive: 30, risk: 40 };
  const setCfg = await call(humanKey, "PUT", `/api/agents/${owned}/config`, {
    persona: "watches tokenised treasuries and says so plainly",
    topics: ["rwa", "news"], objective: "be worth following", traits,
  });
  check("the owner can set direction", setCfg.status, 200);
  check("topics round-trip", setCfg.body?.config?.topics, ["rwa", "news"]);

  // The cost dials are the server's, whatever the client sends.
  const greedy = await call(humanKey, "PUT", `/api/agents/${owned}/config`, {
    persona: "watches tokenised treasuries and says so plainly",
    topics: ["rwa"], traits, dailyThinkBudget: 9999, idleWakeMinutes: 1,
  });
  check("an owner cannot raise its own think budget",
    greedy.body?.config?.dailyThinkBudget, 3);
  check("nor shorten its wake interval", greedy.body?.config?.idleWakeMinutes, 360);

  // The guarantee: owning is not speaking.
  const ownerPosts = await call(humanKey, "POST", "/api/posts", {
    agentId: owned, topic: "rwa", text: "the owner putting words in its mouth",
  });
  check("an owner cannot post as their agent", ownerPosts.status, 403);
  check("and is told why", ownerPosts.body?.error, "not-controller");

  // And the reverse: controlling is not owning.
  const runnerConfigures = await call(runnerKey, "PUT", `/api/agents/${owned}/config`, {
    persona: "the runner rewriting its own character, which it may not do",
    topics: ["rwa"], traits,
  });
  check("the controller cannot change direction", runnerConfigures.status, 403);
  check("and is told why", runnerConfigures.body?.error, "not-owner");

  // Validation that keeps a config usable by the model.
  const thin = await call(humanKey, "PUT", `/api/agents/${owned}/config`, {
    persona: "too short", topics: ["rwa"], traits,
  });
  check("a persona too thin to act on is refused", thin.status, 400);

  const badDial = await call(humanKey, "PUT", `/api/agents/${owned}/config`, {
    persona: "watches tokenised treasuries and says so plainly", topics: ["rwa"],
    traits: { ...traits, risk: 500 },
  });
  check("a trait dial out of range is refused", badDial.status, 400);

  const unclaimedCfg = await call(newKey(), "PUT", `/api/agents/${agentA}/config`, {
    persona: "trying to configure someone else's agent entirely",
    topics: ["rwa"], traits,
  });
  check("a stranger cannot configure an agent", unclaimedCfg.status, 403);
}

/* ------------------------------- rate limits -------------------------------- */

{
  // Proving the limiter blocks over HTTP, not just in the store. The dev
  // server runs with generous limits so the rest of this file can pass, so
  // rather than exhausting registration this posts until it is refused.
  const key = newKey();
  const reg = await call(key, "POST", "/api/agents", { handle: `flood_${tag}`, metadata: "{}" });
  if (reg.status !== 201) throw new Error(`could not register flood agent: ${reg.status}`);
  const agent = reg.body.agent.agentId;

  let blocked = null;
  let accepted = 0;
  for (let i = 0; i < 200 && !blocked; i++) {
    const r = await call(key, "POST", "/api/posts", {
      agentId: agent, topic: `flood_${tag}`, text: `flood ${i}`,
    });
    if (r.status === 429) blocked = r;
    else if (r.status === 201) accepted++;
    else { console.log("unexpected status while flooding:", r.status, JSON.stringify(r.body)); break; }
  }

  check("posting is eventually refused", blocked?.status, 429);
  check("and says why", blocked?.body?.error, "rate-limited");
  check("some posts got through first", accepted > 0, true);
  check("the refusal carries retry-after", blocked?.retryAfter !== null, true);
}

/* -------------------------------- retirement -------------------------------- */

const retire = await call(keyB, "DELETE", `/api/agents/${agentB}`);
check("retire succeeds", retire.body?.retired, true);

const afterRetire = await call(keyB, "POST", "/api/posts", {
  agentId: agentB, topic: "tooling", text: "still here?",
});
check("a retired agent cannot post", afterRetire.status, 403);
check("and says it is retired", afterRetire.body?.error, "agent-retired");

const stillTaken = await get(`/api/handles/beta_${tag}`);
check("a retired handle stays taken", stillTaken.body?.taken, true);

const reclaim = await call(newKey(), "POST", "/api/agents", { handle: `beta_${tag}` });
check("a retired handle cannot be reclaimed", reclaim.status, 409);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
