import { allocate, allocateAll, formatUsdg, totalPayable, RATES } from "../lib/payouts.ts";

/**
 * What leaves the treasury.
 *
 * Every assertion here is about money, and two properties matter more than the
 * rest: a target never falls, and paying twice moves nothing the second time.
 * Both are what make the panel safe to reload, re-run and abandon halfway.
 */
let pass = 0;
let fail = 0;

function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(60)}${ok ? "" : ` got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
}

const row = (over: Partial<Parameters<typeof allocate>[0]> = {}) =>
  allocate({
    agentId: 1,
    handle: "a",
    score: 0,
    wallet: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    snapshotScore: null,
    received: "0",
    sharedWallet: false,
    ...over,
  });

check("the two rates are 1/5 and 1/10", [RATES.founding, RATES.ongoing], [5, 10]);

/* The ongoing rate, for an agent that arrived after the snapshot. */
check("no snapshot means everything at 1/10", row({ score: 100 }).target, "10000000");

/* The founding rate, and the split that makes both rates true at once. */
check(
  "a snapshotted agent earns 1/5 on what it had",
  row({ score: 100, snapshotScore: 100 }).target,
  "20000000",
);
check(
  "  and 1/10 on everything since",
  row({ score: 150, snapshotScore: 100 }).target,
  "25000000",
);
check(
  "  which is more than the ongoing rate alone would give",
  BigInt(row({ score: 150, snapshotScore: 100 }).target) >
    BigInt(row({ score: 150, snapshotScore: null }).target),
  true,
);

/* Monotonicity. A target that could fall would mean asking for money back,
   and there is no way to ask. */
check(
  "a target never falls as score rises",
  [200, 400, 800].map((score) => row({ score, snapshotScore: 200 }).target),
  ["40000000", "60000000", "100000000"],
);
check(
  "a score below its own snapshot cannot reduce the target",
  row({ score: 50, snapshotScore: 200 }).target,
  row({ score: 200, snapshotScore: 200 }).target,
);

/* Idempotence. This is the property the whole panel rests on. */
check("owed is target minus what already arrived", row({ score: 100, received: "4000000" }).owed, "6000000");
check("  fully paid owes nothing", row({ score: 100, received: "10000000" }).owed, "0");
check(
  "  and an overpayment never goes negative",
  row({ score: 100, received: "99000000" }).owed,
  "0",
);
check("an agent with no score is owed nothing", row({ score: 0 }).owed, "0");

/* Blockers. Both refuse rather than warn. */
check("no wallet blocks the row", row({ wallet: null, score: 100 }).blocker, "no-wallet");
check("a shared wallet blocks it too", row({ sharedWallet: true, score: 100 }).blocker, "shared-wallet");
check("an ordinary row is not blocked", row({ score: 100 }).blocker, null);

/* The total is what the operator is about to spend, so blocked rows must not
   be in it: they are amounts no transfer will move. */
const sheet = allocateAll([
  { agentId: 1, handle: "payable", score: 100, wallet: "0xa", snapshotScore: null, received: "0", sharedWallet: false },
  { agentId: 2, handle: "nowallet", score: 100, wallet: null, snapshotScore: null, received: "0", sharedWallet: false },
  { agentId: 3, handle: "shared", score: 100, wallet: "0xb", snapshotScore: null, received: "0", sharedWallet: true },
]);
check("the total counts only what can actually be sent", totalPayable(sheet), "10000000");
check("payable rows sort above blocked ones owed the same", sheet[0].handle, "payable");
check("  and blocked rows sink to the bottom", sheet.map((r) => r.blocker !== null), [false, true, true]);

/* Display. Flooring matters: a page that rounds up promises more than the
   transfer moves. */
check("base units render as money", formatUsdg("81000000"), "81.00");
check("  fractions floor rather than round", formatUsdg("1999999"), "1.99");
check("  and thousands are grouped", formatUsdg("2018208816"), "2,018.20");
check("zero renders as zero", formatUsdg("0"), "0.00");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
