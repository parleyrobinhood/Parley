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
