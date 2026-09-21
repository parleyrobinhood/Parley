import { MemoryStore } from "../dist/memory-store.js";
import { PostgresStore } from "../dist/postgres-store.js";

/**
 * Applications for the operator's badge, across both backends.
 *
 * The rules worth holding are all about what a code can and cannot do: it is
 * bound to one agent when it is minted, it works once, it dies when the
 * application is submitted, and it expires. Those are the properties that let
 * the form take a code and nothing else — no typed agent id to mismatch.
 */
let pass = 0, fail = 0, backend = "";
const check = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"}  ${backend.padEnd(9)}${name.padEnd(56)} ${ok ? "" : `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

const HOUR = 60 * 60 * 1000;

async function suite(name: string, fresh: () => Promise<any>) {
  backend = name;
  const store = await fresh();

  await store.createAgent({ handle: "alpha", controller: "0xA", metadata: "{}" });
  await store.createAgent({ handle: "beta", controller: "0xB", metadata: "{}" });

  const soon = () => Date.now() + HOUR;

  /* Minting. */

  const draft = await store.openVerification({
    agentId: 1,
    requestedBy: "0xAA",
    codeHash: "hash-one",
    expiresAt: soon(),
  });
  check("a fresh draft names its agent", draft.agentId, 1);
  check("  and starts as a draft", draft.state, "draft");
  check("  and remembers who asked, lowercased", draft.requestedBy, "0xaa".toLowerCase());
  check("  and carries no pitch yet", draft.pitch, "");

  // The hash is the store's business. Nothing that reads a row gets it back,
  // so no route can leak a code it never sees.
  check("a record does not carry the code hash", "codeHash" in draft, false);

  /* Redeeming. */

  const found = await store.draftVerificationByCode("hash-one");
  check("a draft is found by its code", found?.requestId, draft.requestId);
  check("a wrong code finds nothing", await store.draftVerificationByCode("nope"), null);

  /* Re-running the command replaces the draft rather than stacking them. */

  const second = await store.openVerification({
    agentId: 1,
    requestedBy: "0xAA",
    codeHash: "hash-two",
    expiresAt: soon(),
  });
  check("a second draft replaces the first", await store.draftVerificationByCode("hash-one"), null);
  check("  and the new code works", (await store.draftVerificationByCode("hash-two"))?.requestId, second.requestId);
  check("  leaving one row for the agent", (await store.verificationsFor(1)).length, 1);

  /* Submitting. */

  await store.submitVerification({
    requestId: second.requestId,
    contact: "someone@example.com",
    pitch: "it reads filings and says when they disagree",
    links: "https://example.com",
  });

  const [submitted] = await store.verificationsFor(1);
  check("submitting moves it to pending", submitted.state, "pending");
  check("  and keeps what was written", submitted.pitch, "it reads filings and says when they disagree");
  check("  and stamps a time", typeof submitted.submittedAt, "number");

  // The property the whole design rests on: one code, one application.
  check("the code stops working once spent", await store.draftVerificationByCode("hash-two"), null);

  // And a second submission on the same row cannot overwrite the first.
  await store.submitVerification({
    requestId: second.requestId,
    contact: "someone-else@example.com",
    pitch: "different",
    links: "",
  });
  check("a submitted application cannot be rewritten", (await store.verificationsFor(1))[0].pitch,
    "it reads filings and says when they disagree");

  /* The queue. */

  let queue = await store.pendingVerifications();
  check("the queue holds what was submitted", queue.length, 1);
  check("  and names the agent", queue[0].agentId, 1);

  // A draft nobody submitted is not an application and must not appear.
  await store.openVerification({ agentId: 2, requestedBy: "0xB", codeHash: "hash-three", expiresAt: soon() });
  queue = await store.pendingVerifications();
  check("an unsubmitted draft is not in the queue", queue.length, 1);

  /* Expiry. */

  await store.openVerification({
    agentId: 2,
    requestedBy: "0xB",
    codeHash: "hash-stale",
    expiresAt: Date.now() - 1,
  });
  check("an expired draft cannot be redeemed", await store.draftVerificationByCode("hash-stale"), null);

  /* Deciding. */

  await store.decideVerification({
    requestId: second.requestId,
    state: "granted",
    decidedBy: "0xADMIN",
    note: "",
  });
  const [decided] = await store.verificationsFor(1);
  check("a decision closes the row", decided.state, "granted");
  check("  and records who made it, lowercased", decided.decidedBy, "0xadmin".toLowerCase());
  check("  and empties the queue", (await store.pendingVerifications()).length, 0);

  // Deciding is not granting. The badge moves through setVerified and nothing
  // else, so that there is one place to read when asking how an agent got it.
  check("deciding does not touch the badge itself", (await store.agentById(1)).verified, false);

  // A decided row is final: a second decision, from a stale tab or a second
  // admin, must not turn a grant into a decline.
  await store.decideVerification({
    requestId: second.requestId,
    state: "declined",
    decidedBy: "0xOTHER",
    note: "changed my mind",
  });
  check("a decided application cannot be decided again", (await store.verificationsFor(1))[0].state, "granted");

  // Ids are never reused. A count-based id breaks this whenever the draft
  // being replaced is not the newest row: the count falls by one, and the next
  // id lands on a submitted application that is still using it. The order
  // below is the one that does it — an older draft replaced while a newer
  // application sits above it.
  await store.createAgent({ handle: "gamma", controller: "0xC", metadata: "{}" });
  await store.createAgent({ handle: "delta", controller: "0xD", metadata: "{}" });

  await store.openVerification({ agentId: 3, requestedBy: "0xC", codeHash: "g-one", expiresAt: soon() });
  const live = await store.openVerification({ agentId: 4, requestedBy: "0xD", codeHash: "d-one", expiresAt: soon() });
  await store.submitVerification({ requestId: live.requestId, contact: "d@example.com", pitch: "delta", links: "" });
  await store.openVerification({ agentId: 3, requestedBy: "0xC", codeHash: "g-two", expiresAt: soon() });

  const everyId = (
    await Promise.all([1, 2, 3, 4].map((id) => store.verificationsFor(id)))
  ).flat().map((row: any) => row.requestId);
  check("an id is never handed out twice", new Set(everyId).size, everyId.length);
  check("  and the live application keeps its own", (await store.verificationsFor(4))[0].requestId, live.requestId);

  /* History. */

  const third = await store.openVerification({ agentId: 1, requestedBy: "0xA", codeHash: "hash-four", expiresAt: soon() });
  const history = await store.verificationsFor(1);
  check("history keeps the old application", history.length, 2);
  check("  newest first", history[0].requestId, third.requestId);
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
