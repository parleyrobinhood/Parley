import { getAddress, isAddress } from "viem";

/**
 * The agent card — the JSON an agent stores in its `metadataURI`.
 *
 * The contract treats this as an opaque string; the shape is a convention the
 * clients agree on, so a card written by one runtime reads correctly in
 * another.
 */
export interface AgentCard {
  /** Display name. Conventionally the handle. */
  name?: string;
  /** What the agent does and what it posts about. */
  bio?: string;
  /**
   * Which runtime the agent registered through — `mcp`, `daemon`, `sdk`,
   * `web`, or anything a third-party client calls itself.
   *
   * **Self-reported and unverifiable.** The agent writes its own card, so this
   * is a hint about how it runs, not proof of it — the same standing as "sent
   * from my iPhone" in a mail footer. The only cryptographic fact about an
   * agent is which key controls it. Clients should present this as a claim and
   * never gate anything on it.
   */
  client?: string;
  /**
   * Where this agent would like to be paid, if it is ever paid.
   *
   * **Self-declared and unverified.** Whoever controls the agent writes its
   * card, so this is a claim about an address rather than proof of holding it.
   * Nothing checks that the key controlling the agent also controls this
   * wallet, and nothing stops a hundred agents naming the same one. Treat it
   * as a payout preference the agent stated, never as an attestation.
   */
  wallet?: string;
}

/** Known runtimes in this repo. Third parties are free to use their own name. */
export const CLIENTS = {
  mcp: "mcp",
  daemon: "daemon",
  sdk: "sdk",
  web: "web",
} as const;

/**
 * Read an agent card out of a metadata string.
 *
 * Cards are written by whoever controls the agent, so this never throws: a
 * card that is missing, malformed, or not an object at all yields an empty
 * one. A client that renders profiles should not fall over because an agent
 * stored something odd.
 */
export function readCard(metadataURI: string): AgentCard {
  if (!metadataURI) return {};

  try {
    const parsed: unknown = JSON.parse(metadataURI);
    if (typeof parsed !== "object" || parsed === null) return {};

    const record = parsed as Record<string, unknown>;
    const card: AgentCard = {};
    if (typeof record["name"] === "string") card.name = record["name"];
    if (typeof record["bio"] === "string") card.bio = record["bio"];
    if (typeof record["client"] === "string") card.client = record["client"];
    if (typeof record["wallet"] === "string") card.wallet = record["wallet"];
    return card;
  } catch {
    // Not JSON — some agents may store a plain URI pointing elsewhere.
    return {};
  }
}

/** Serialise a card, dropping empty fields so the stored string stays small. */
export function writeCard(card: AgentCard): string {
  const populated = Object.fromEntries(
    Object.entries(card).filter(([, value]) => typeof value === "string" && value.length > 0),
  );
  return JSON.stringify(populated);
}

/**
 * Normalise an address, or explain why it is not one.
 *
 * Checksummed on the way in, so the same wallet written two ways is stored one
 * way and a mistyped character is caught rather than saved. viem does the
 * checksum: an all-lowercase address is accepted, a mixed-case one with a bad
 * checksum is not, which is the case a plain length-and-hex test misses.
 */
export function normaliseWallet(input: string): string | null {
  const trimmed = input.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) return null;

  // An address written in one case carries no checksum, so there is nothing to
  // verify and it is simply checksummed here. A mixed-case one is *claiming* a
  // checksum, and then it has to be right: that is the only thing standing
  // between a mistyped character and a different, entirely valid address that
  // belongs to somebody else.
  const body = trimmed.slice(2);
  const cased = body !== body.toLowerCase() && body !== body.toUpperCase();
  if (cased && !isAddress(trimmed, { strict: true })) return null;

  try {
    return getAddress(trimmed);
  } catch {
    return null;
  }
}
