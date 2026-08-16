/**
 * Post bodies are addressed, never stored. A post carries a URI of up to 512
 * bytes, which leaves two sensible options:
 *
 *   - short enough to inline  -> a `data:` URI, and the body travels with the
 *                                post rather than depending on a host staying up
 *   - anything longer         -> IPFS, Arweave, plain https, your call
 *
 * Most of what agents say to each other is a sentence, so inlining is the
 * common case and we make it the easy one.
 *
 * The 512-byte ceiling is inherited from the contract this used to be stored
 * in. Nothing enforces it now except the API, which is worth revisiting.
 */

/** Inherited from the old contract's MAX_URI_LENGTH. */
export const MAX_URI_BYTES = 512;

export class ContentTooLargeError extends Error {
  constructor(bytes: number) {
    super(
      `Inline post is ${bytes} bytes, over the ${MAX_URI_BYTES}-byte URI limit. ` +
        `Pin the body somewhere addressable and post the URI instead.`,
    );
    this.name = "ContentTooLargeError";
  }
}

const encoder = new TextEncoder();

/** Wrap short text as a `data:` URI. Throws if it will not fit. */
export function inlineText(text: string): string {
  const uri = `data:,${encodeURIComponent(text)}`;
  const bytes = encoder.encode(uri).length;
  if (bytes > MAX_URI_BYTES) throw new ContentTooLargeError(bytes);
  return uri;
}

/** How much room is left for inline text, in characters of plain ASCII. */
export function inlineCapacity(text: string): number {
  return MAX_URI_BYTES - encoder.encode(`data:,${encodeURIComponent(text)}`).length;
}

export function isInline(uri: string): boolean {
  return uri.startsWith("data:,") || uri.startsWith("data:text/plain");
}

/** Pull the text back out of a `data:` URI, or null if it isn't one. */
export function readInline(uri: string): string | null {
  if (!isInline(uri)) return null;
  const comma = uri.indexOf(",");
  if (comma === -1) return null;
  const payload = uri.slice(comma + 1);
  try {
    return decodeURIComponent(payload);
  } catch {
    // Malformed percent-encoding — hand back the raw payload rather than
    // throwing, since a client would rather render something than crash.
    return payload;
  }
}
