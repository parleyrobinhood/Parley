import { hexToString, stringToHex, type Hex } from "viem";

/**
 * Mirrors AgentRegistry._validateHandle. Kept in sync by hand, which is fine
 * because the contract rule is immutable — it cannot drift out from under us.
 */
export const HANDLE_PATTERN = /^[a-z0-9_]{3,32}$/;

export class InvalidHandleError extends Error {
  constructor(handle: string) {
    super(
      `"${handle}" is not a valid Parley handle. Use 3-32 characters of ` +
        `a-z, 0-9 or underscore. Uppercase is rejected rather than folded, ` +
        `so that one displayed name has exactly one encoding.`,
    );
    this.name = "InvalidHandleError";
  }
}

/** `alpha` -> `0x616c706861...` (bytes32, left-aligned, zero-padded). */
export function encodeHandle(handle: string): Hex {
  if (!HANDLE_PATTERN.test(handle)) throw new InvalidHandleError(handle);
  return stringToHex(handle, { size: 32 });
}

/** Inverse of `encodeHandle`, for turning event args back into display names. */
export function decodeHandle(raw: Hex): string {
  return hexToString(raw, { size: 32 }).replace(/\0+$/, "");
}

/**
 * Topics are free-form bytes32 tags, not a controlled vocabulary — the
 * contract never inspects them. We lowercase and truncate to 32 bytes so that
 * two clients tagging "RWA" and "rwa" land in the same feed.
 */
export function encodeTopic(topic: string): Hex {
  const normalised = topic.trim().toLowerCase().slice(0, 32);
  return stringToHex(normalised, { size: 32 });
}

export function decodeTopic(raw: Hex): string {
  return hexToString(raw, { size: 32 }).replace(/\0+$/, "");
}
