import { keccak256, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { recoverMessageAddress } from "viem";

/**
 * Request signing.
 *
 * An agent proves who it is the same way it always did — by holding a key —
 * except the signature now covers an HTTP request instead of a transaction,
 * and the server recovers the address instead of the chain. Keys carry over
 * untouched: same curve, same address, same file on disk.
 *
 * Signed requests rather than bearer tokens because a token is a secret in
 * flight: anything that sees it can replay it forever. A signature is scoped
 * to one request, expires on its own, and there is nothing on the server worth
 * stealing — it stores addresses, never keys.
 */

/** Clock skew allowed between agent and server. */
export const MAX_SKEW_MS = 5 * 60 * 1000;

export const HEADERS = {
  address: "x-parley-address",
  timestamp: "x-parley-timestamp",
  nonce: "x-parley-nonce",
  signature: "x-parley-signature",
} as const;

export interface SignedHeaders {
  [HEADERS.address]: string;
  [HEADERS.timestamp]: string;
  [HEADERS.nonce]: string;
  [HEADERS.signature]: string;
}

/**
 * The exact bytes both sides sign.
 *
 * Every field that decides what the request *does* is in here. Leaving any of
 * them out means a signature captured for one call can be replayed against
 * another: without the path, a signed `follow` becomes a signed `retire`;
 * without the body hash, the arguments can be swapped underneath a valid
 * signature.
 *
 * The version prefix is deliberate — if this format ever changes, old
 * signatures must stop verifying rather than mean something new.
 */
export function canonicalMessage(input: {
  method: string;
  path: string;
  timestamp: number;
  nonce: string;
  body: string;
}): string {
  return [
    "parley-auth-v1",
    input.method.toUpperCase(),
    input.path,
    String(input.timestamp),
    input.nonce,
    keccak256(toHex(input.body)),
  ].join("\n");
}

/** A nonce with enough entropy that collisions are not a practical concern. */
export function newNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Sign a request. Returns the headers to send with it. */
export async function signRequest(
  privateKey: Hex,
  input: { method: string; path: string; body?: string },
  now = Date.now(),
): Promise<SignedHeaders> {
  const account = privateKeyToAccount(privateKey);
  const timestamp = now;
  const nonce = newNonce();
  const body = input.body ?? "";

  const signature = await account.signMessage({
    message: canonicalMessage({ ...input, timestamp, nonce, body }),
  });

  return {
    [HEADERS.address]: account.address,
    [HEADERS.timestamp]: String(timestamp),
    [HEADERS.nonce]: nonce,
    [HEADERS.signature]: signature,
  };
}

export type VerifyFailure =
  | "missing-headers"
  | "bad-timestamp"
  | "expired"
  | "replayed"
  | "bad-signature"
  | "address-mismatch";

export type VerifyResult =
  | { ok: true; address: `0x${string}`; nonce: string; timestamp: number }
  | { ok: false; reason: VerifyFailure };

/**
 * Verify a signed request.
 *
 * `seenNonce` is asked *after* the signature checks out. Recording nonces for
 * requests that were never valid would let anyone fill the replay store with
 * junk by posting garbage signatures.
 */
export async function verifyRequest(
  headers: Record<string, string | undefined>,
  input: { method: string; path: string; body?: string },
  seenNonce: (nonce: string, address: string) => Promise<boolean> | boolean,
  now = Date.now(),
): Promise<VerifyResult> {
  const address = headers[HEADERS.address];
  const timestampRaw = headers[HEADERS.timestamp];
  const nonce = headers[HEADERS.nonce];
  const signature = headers[HEADERS.signature];

  if (!address || !timestampRaw || !nonce || !signature) {
    return { ok: false, reason: "missing-headers" };
  }

  const timestamp = Number(timestampRaw);
  if (!Number.isFinite(timestamp)) return { ok: false, reason: "bad-timestamp" };

  // Bounded on both sides: a future-dated signature would otherwise stay valid
  // for as long as the sender cared to claim.
  if (Math.abs(now - timestamp) > MAX_SKEW_MS) return { ok: false, reason: "expired" };

  let recovered: `0x${string}`;
  try {
    recovered = await recoverMessageAddress({
      message: canonicalMessage({ ...input, timestamp, nonce, body: input.body ?? "" }),
      signature: signature as Hex,
    });
  } catch {
    return { ok: false, reason: "bad-signature" };
  }

  if (recovered.toLowerCase() !== address.toLowerCase()) {
    return { ok: false, reason: "address-mismatch" };
  }

  if (await seenNonce(nonce, recovered.toLowerCase())) {
    return { ok: false, reason: "replayed" };
  }

  return { ok: true, address: recovered, nonce, timestamp };
}
