import { MemoryStore } from "../dist/memory-store.js";
import { PostgresStore } from "../dist/postgres-store.js";

/**
 * The treasury ledger across both backends.
 *
 * Two properties matter more than the rest and both are here: an amount
 * accumulates rather than replaces, because a scan only ever carries the range
 * it just read, and the cursor moves with the credit, because a cursor that
 * moved without one loses payments silently while a credit without one doubles
 * every total on the next run.
 *
 * Amounts are decimal strings throughout. USDG has six decimals, so a payout
 * worth caring about is past what a double holds exactly, and a store that
 * quietly went through Number here would only be wrong for large numbers.
 */
let pass = 0, fail = 0, backend = "";
const check = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"}  ${backend.padEnd(9)}${name.padEnd(56)} ${ok ? "" : `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

const A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const got = (totals: any[], address: string) => totals.find((t) => t.address === address)?.received;

async function suite(name: string, fresh: () => Promise<any>) {
  backend = name;
  const store = await fresh();

  check("a scan that has never run starts at zero", await store.airdropCursor(), 0);
  check("  and nothing has been paid", await store.airdropTotals(), []);

  await store.creditAirdrops({ credits: [{ address: A, received: "1000000" }], scannedTo: 100 });
  check("a payment is recorded", got(await store.airdropTotals(), A), "1000000");
  check("  and the cursor moves with it", await store.airdropCursor(), 100);

  // The property the whole design rests on: a scan carries one range, so the
  // store has to add. Replacing here would mean every total was only ever the
  // last hour's payments.
  await store.creditAirdrops({ credits: [{ address: A, received: "500000" }], scannedTo: 200 });
  check("a second payment adds rather than replaces", got(await store.airdropTotals(), A), "1500000");
  check("  and the cursor moves again", await store.airdropCursor(), 200);

  await store.creditAirdrops({ credits: [{ address: B, received: "42" }], scannedTo: 300 });
  check("a second recipient is separate", got(await store.airdropTotals(), B), "42");
  check("  and does not disturb the first", got(await store.airdropTotals(), A), "1500000");

  // A range with no payments in it still has to move the cursor, or the scan
  // reads the same empty blocks forever and never reaches the head.
  await store.creditAirdrops({ credits: [], scannedTo: 400 });
  check("an empty range still advances the cursor", await store.airdropCursor(), 400);
  check("  and pays nobody", (await store.airdropTotals()).length, 2);

  // Beyond 2^53, which is where a Number implementation stops being exact and
  // a string one carries on being right.
  await store.creditAirdrops({
    credits: [{ address: B, received: "9007199254740993" }],
    scannedTo: 500,
  });
  // 42 already there, so the exact answer is 9007199254741035. A double would
  // give 9007199254741036, which is the point.
  check(
    "an amount past 2^53 survives exactly",
    got(await store.airdropTotals(), B),
    "9007199254741035",
  );

  // A card can declare any casing it likes; the chain hands back lowercase.
  // Both have to land on one row or an agent is paid twice on the board.
  await store.creditAirdrops({
    credits: [{ address: A.toUpperCase().replace("0X", "0x"), received: "1" }],
    scannedTo: 600,
  });
  check("casing does not split a recipient in two", (await store.airdropTotals()).length, 2);
  check("  and the amount landed on the same row", got(await store.airdropTotals(), A), "1500001");
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
