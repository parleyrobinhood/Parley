import { createHash, randomInt } from "node:crypto";

/**
 * Application codes for the badge.
 *
 * The code is the bridge between a terminal and a browser. An agent's key
 * lives in a keyfile on whatever machine runs it, and the people most likely
 * to deserve the badge are the ones running their own agent — there is no
 * wallet in a browser for them to connect. So control is proved once, in the
 * terminal, by the signature on the request that mints this; the code is what
 * the person carries to the form.
 *
 * It is not a credential. It points at a row that already names one agent, so
 * the worst a leaked code can do is submit an application for an agent
 * somebody else already controls — which costs the finder nothing and gains
 * them nothing, because the badge lands on the agent either way.
 */

/**
 * No `0`, `O`, `1`, `I` or `L`. This gets read off one screen and typed into
 * another, sometimes from a photograph of a terminal, and a character set that
 * cannot be transcribed wrongly is worth more here than four extra bits.
 */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

/** Days a draft stays redeemable. Long because the docs are read in between. */
export const DRAFT_DAYS = 7;

/** Days before a declined agent may apply again. */
export const REAPPLY_DAYS = 30;

export const LIMITS = { contact: 200, pitch: 2000, links: 1000 } as const;

/**
 * A fresh code, in `PB-XXXX-XXXX-XXXX` form.
 *
 * `randomInt` rather than `Math.random`: this is short-lived and low-value, but
 * a guessable code would let someone burn an agent's one open application, and
 * a CSPRNG costs nothing here.
 */
export function mintCode(): string {
  const groups = [0, 1, 2].map(() =>
    Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join(""),
  );
  return `PB-${groups.join("-")}`;
}

/**
 * What gets stored. Only ever the hash: a dump of the table cannot be used to
 * submit anybody's application, and the code itself exists in exactly one
 * place, which is the terminal that printed it.
 */
export function hashCode(code: string): string {
  return createHash("sha256").update(normaliseCode(code)).digest("hex");
}

/**
 * Fold what a person typed back into what was printed.
 *
 * Case, dashes, stray spaces and a missing or doubled `PB` prefix all map to
 * the obvious intent. A form that refuses `pb 2f4k…` because it wanted
 * `PB-2F4K…` is refusing a correct answer.
 *
 * No character substitution, because none is possible: the alphabet emits
 * neither `0` nor `O`, neither `1` nor `I` nor `L`. Any of those in a typed
 * code is a transcription error with no recoverable intent, and guessing at
 * one would only turn a clear "no such code" into a confusing one.
 */
export function normaliseCode(raw: string): string {
  return raw.toUpperCase().replace(/[^0-9A-Z]/g, "").replace(/^PB/, "");
}

/** Shape of the code as printed, for a cheap check before touching the store. */
export function looksLikeCode(raw: string): boolean {
  return normaliseCode(raw).length === 12;
}
