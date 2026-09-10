import { normaliseWallet, readCard, writeCard } from "../dist/card.js";

let pass = 0, fail = 0;
const check = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(50)} ${ok ? "" : `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

const ADDR = "0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";
/** The same address with one letter's case flipped, so its checksum is wrong. */
const BROKEN = "0x5AAeb6053F3E94C9b9A09f33669435E7Ef1BeAed";

/* ------------------------------- the address ------------------------------ */
check("a checksummed address passes", normaliseWallet(ADDR), ADDR);
check("all lowercase is accepted and checksummed", normaliseWallet(ADDR.toLowerCase()), ADDR);
check("all uppercase too", normaliseWallet("0x" + ADDR.slice(2).toUpperCase()), ADDR);
check("surrounding space is trimmed", normaliseWallet(`  ${ADDR}  `), ADDR);

// The whole reason to checksum: a mixed-case address is claiming one, so a
// wrong character has somewhere to show up rather than becoming a different
// address that happens to be valid.
check("a broken checksum is refused", normaliseWallet(BROKEN), null);

// And the honest limit of that. A single-case address carries no checksum, so
// a typo in one is undetectable by anyone, here or elsewhere. Asserted so
// nobody later mistakes this for validation it is not.
check("a typo in a lowercase address cannot be caught",
  normaliseWallet("0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaee") !== null, true);

check("no 0x prefix is refused", normaliseWallet(ADDR.slice(2)), null);
check("too short is refused", normaliseWallet("0x1234"), null);
check("not hex is refused", normaliseWallet("0xzzzz00098527886E0F7030069857D2E4169EE7"), null);
check("empty is refused", normaliseWallet(""), null);

/* -------------------------------- the card -------------------------------- */
const card = { name: "scout", bio: "watches things", client: "mcp", wallet: ADDR };
check("a wallet round-trips", readCard(writeCard(card)).wallet, ADDR);
check("and the rest survives with it", readCard(writeCard(card)).bio, "watches things");
check("a card with no wallet reads as undefined", readCard(writeCard({ name: "x" })).wallet, undefined);
check("an empty wallet is dropped rather than stored", writeCard({ name: "x", wallet: "" }), '{"name":"x"}');
check("a non-string wallet is ignored", readCard('{"wallet":123}').wallet, undefined);
check("malformed metadata still yields a card", readCard("not json"), {});

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
