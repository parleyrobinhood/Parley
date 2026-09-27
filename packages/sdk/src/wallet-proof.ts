import { recoverMessageAddress, type Hex } from "viem";
import { normaliseWallet } from "./card.js";

/**
 * Proving an agent holds the address it says it does.
 *
 * Until now a payout wallet was a string on the agent's card, written by
 * whoever controls the agent and checked by nobody. Three agents were pointed
 * at one address and nothing objected. That was survivable while the only
 * consequence was the operator paying the wrong agent from their own treasury.
 * It stops being survivable the moment money moves between users, because the
 * same string is then a claim on somebody else's revenue.
 *
 * **Two signatures, proving two different things.** The request itself is
 * signed by the agent's controller or owner, which proves the caller may act
 * for this agent. The body carries a second signature, made by the *wallet*,
 * over a message naming this agent. That proves whoever holds the address
 * agreed to be named by it.
 *
 * Either alone is useless. A wallet signature without the first would let
 * anybody bind their own address to somebody else's agent and collect its
 * rewards. A request signature without the second is what we have today: a
 * claim.
 *
 * The message is deliberately readable. A wallet shows it to a person before
 * they sign, and "sign this hex blob" is how people are phished — anyone
 * signing this should be able to see exactly which agent they are agreeing to
 * be paid as.
 */

/** How long a proof message stays signable, in ms. */
export const PROOF_WINDOW_MS = 10 * 60 * 1000;

export interface WalletProofClaim {
  agentId: number;
  /** Checksummed. */
  address: string;
  /** Unique per proof, remembered by the server so one cannot be replayed. */
  nonce: string;
  issuedAt: number;
}

/**
 * The exact text a wallet signs.
 *
 * Every field that decides what the proof *means* is in here. Without the
 * agent id, a proof made for one agent would bind the address to any other;
 * without the nonce and timestamp it would be good forever, which for a
 * message a person may sign on a website is not a property worth having.
 */
export function walletProofMessage(claim: WalletProofClaim): string {
  // Canonical here rather than at the call sites. A wallet that presents its
  // address lowercased would otherwise sign different bytes than the server
  // rebuilds, and the proof would fail for a reason nobody could see: the two
  // messages read identically to a person. Left as given when it is not an
  // address at all, since verification refuses those before recovery.
  const address = normaliseWallet(claim.address) ?? claim.address.trim();
  return [
    "Parley wallet proof",
    "",
    `I control this address and agree to be paid as agent ${claim.agentId}.`,
    "",
    `address: ${address}`,
    `agent: ${claim.agentId}`,
    `nonce: ${claim.nonce}`,
    `issued: ${new Date(claim.issuedAt).toISOString()}`,
  ].join("\n");
}

export type ProofFailure =
  | "invalid-address"
  | "bad-timestamp"
  | "expired"
  | "bad-signature"
  | "address-mismatch";

export type ProofResult =
  | { ok: true; address: string }
  | { ok: false; reason: ProofFailure };

/**
 * Check a wallet signature against the claim it was made for.
 *
 * Recovers the signer and compares it to the address in the message rather
 * than to anything the caller passed separately — the two must be the same
 * string, or a proof could be made for one address and submitted as another.
 */
export async function verifyWalletProof(
  claim: WalletProofClaim,
  signature: string,
  now = Date.now(),
): Promise<ProofResult> {
  const address = normaliseWallet(claim.address);
  if (!address) return { ok: false, reason: "invalid-address" };

  if (!Number.isFinite(claim.issuedAt)) return { ok: false, reason: "bad-timestamp" };
  // Both directions: a proof from the future is as suspect as a stale one, and
  // a clock nobody checks is a window somebody widens.
  if (Math.abs(now - claim.issuedAt) > PROOF_WINDOW_MS) return { ok: false, reason: "expired" };

  // `walletProofMessage` normalises the address itself, so a wallet that
  // signed over a lowercase form and a server rebuilding from a checksummed
  // one produce the same bytes.
  const message = walletProofMessage({ ...claim, address });

  let recovered: string;
  try {
    recovered = await recoverMessageAddress({ message, signature: signature as Hex });
  } catch {
    return { ok: false, reason: "bad-signature" };
  }

  if (recovered.toLowerCase() !== address.toLowerCase()) {
    return { ok: false, reason: "address-mismatch" };
  }

  return { ok: true, address };
}
