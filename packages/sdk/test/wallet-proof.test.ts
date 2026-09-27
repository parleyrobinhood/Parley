import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import {
  PROOF_WINDOW_MS,
  verifyWalletProof,
  walletProofMessage,
} from "../dist/wallet-proof.js";

/**
 * Wallet proof: the second signature, made by the address rather than by the
 * agent's key.
 *
 * What it has to stop is one thing — somebody naming an address they do not
 * hold, or holding an address and having it bound to an agent they do not
 * control. The first is this file; the second is the route's job and is tested
 * there, because a signature cannot know who owns an agent.
 */
let pass = 0, fail = 0;
const check = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(58)} ${ok ? "" : `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

const key = generatePrivateKey();
const wallet = privateKeyToAccount(key);
const claim = {
  agentId: 42,
  address: wallet.address,
  nonce: "abc123",
  issuedAt: Date.now(),
};
const sign = (c: typeof claim) => wallet.signMessage({ message: walletProofMessage(c) });

/* The message a person actually reads before signing. */
const text = walletProofMessage(claim);
check("the message names the agent", text.includes("agent 42"), true);
check("  and the address", text.includes(wallet.address), true);
check("  and is readable rather than a hex blob", text.startsWith("Parley wallet proof"), true);

/* The happy path. */
const good = await verifyWalletProof(claim, await sign(claim));
check("a wallet's own signature verifies", good.ok, true);
check("  and returns the checksummed address", good.ok && good.address, wallet.address);

/* Somebody else's signature over the same claim. */
const stranger = privateKeyToAccount(generatePrivateKey());
const forged = await stranger.signMessage({ message: walletProofMessage(claim) });
check(
  "another key signing the same words proves nothing",
  (await verifyWalletProof(claim, forged)).ok,
  false,
);

/* A proof made for one agent, submitted for another. This is the whole reason
   the agent id is inside the signed text. */
const elsewhere = await verifyWalletProof({ ...claim, agentId: 43 }, await sign(claim));
check("a proof for one agent does not work for another", elsewhere.ok, false);

/* Same for the address: signed over one, submitted as another. */
const swapped = await verifyWalletProof(
  { ...claim, address: stranger.address },
  await sign(claim),
);
check("a proof cannot be re-pointed at a different address", swapped.ok, false);

/* Freshness, both directions. A clock nobody checks is a window somebody widens. */
const stale = { ...claim, issuedAt: Date.now() - PROOF_WINDOW_MS - 1000 };
check("a stale proof is refused", (await verifyWalletProof(stale, await sign(stale))).ok, false);
const future = { ...claim, issuedAt: Date.now() + PROOF_WINDOW_MS + 1000 };
check("  and so is one from the future", (await verifyWalletProof(future, await sign(future))).ok, false);

/* Garbage in. */
check("a malformed signature is refused, not thrown", (await verifyWalletProof(claim, "0xnope")).ok, false);
check(
  "an address that is not one is refused before any recovery",
  (await verifyWalletProof({ ...claim, address: "not-an-address" }, await sign(claim))).reason,
  "invalid-address",
);

/* Casing. A wallet may present any casing and the message is rebuilt from the
   normalised form, so a lowercase claim still verifies. */
const lowered = { ...claim, address: wallet.address.toLowerCase() };
check("a lowercase address still verifies", (await verifyWalletProof(lowered, await sign(lowered))).ok, true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
