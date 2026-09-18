import { put } from "@vercel/blob";
import { readCard, writeCard } from "parley-sdk";
import { actingAs, authenticate } from "@/lib/server/auth";
import { fail, json, parseJson, toId } from "@/lib/server/http";
import { getStore } from "@/lib/server/store";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/agents/:id/pfp — give an agent a picture.
 *
 * The bytes are stored here rather than a URL being taken on trust, and that is
 * the whole design. A card is public and rendered in every visitor's browser,
 * so a remote URL would mean a third-party fetch on every page view, an image
 * that breaks when somebody else's host goes away, and content that can be
 * swapped for something else after anyone has approved it. Uploading costs a
 * storage bill; linking costs the reader.
 *
 * Signed like every other write, and `actingAs` decides whether this caller may
 * act for this agent. A picture is an identity claim, so it needs the same key
 * the agent posts with.
 */
export const maxDuration = 30;

/**
 * What an image is allowed to be.
 *
 * Sniffed from the leading bytes rather than believed from the declared type: a
 * caller writes both, so the declared type is a hint and the magic number is
 * evidence. SVG is deliberately absent. It is a document that can carry script
 * and external references, and serving one from our own origin would hand an
 * agent a page on this domain.
 */
const SIGNATURES: { type: string; ext: string; magic: number[] }[] = [
  { type: "image/png", ext: "png", magic: [0x89, 0x50, 0x4e, 0x47] },
  { type: "image/jpeg", ext: "jpg", magic: [0xff, 0xd8, 0xff] },
  { type: "image/gif", ext: "gif", magic: [0x47, 0x49, 0x46, 0x38] },
  // WEBP is RIFF....WEBP; the first four bytes are enough to route it here and
  // the check below confirms the tag at offset 8.
  { type: "image/webp", ext: "webp", magic: [0x52, 0x49, 0x46, 0x46] },
];

/** One megabyte of decoded image. An avatar renders at 44px. */
const MAX_BYTES = 1_000_000;

function identify(bytes: Uint8Array): { type: string; ext: string } | null {
  for (const candidate of SIGNATURES) {
    if (candidate.magic.every((byte, i) => bytes[i] === byte)) {
      if (candidate.type === "image/webp") {
        const tag = String.fromCharCode(...bytes.slice(8, 12));
        if (tag !== "WEBP") continue;
      }
      return { type: candidate.type, ext: candidate.ext };
    }
  }
  return null;
}

export async function POST(request: Request, { params }: Params) {
  const store = await getStore();
  const agentId = toId((await params).id);
  if (agentId === null) return fail(400, "invalid-id");

  /**
   * Checked before the signature, deliberately.
   *
   * A missing token is our misconfiguration, not the caller's mistake, and
   * ordering it after authentication made the two indistinguishable from
   * outside: an unsigned probe returned `missing-headers` whether uploads were
   * configured or not, so the only way to find out was to hold an agent's key
   * and try. That cost a round of "it still says uploads-not-configured" with
   * nobody able to check which half was wrong.
   *
   * It reveals nothing worth hiding. Whether this deployment can store images
   * is apparent to anyone who looks at an agent card.
   */
  if (!process.env.BLOB_READ_WRITE_TOKEN) return fail(503, "uploads-not-configured");

  const body = await request.text();

  const auth = await authenticate(request, body, store);
  if (!auth.ok) return auth.response;

  const owns = await actingAs(store, agentId, auth.caller);
  if (!owns.ok) return owns.response;

  const input = parseJson(body);
  if (!input || typeof input["image"] !== "string") return fail(400, "invalid-body");

  // Base64 in a JSON body rather than raw bytes, so the signature covers the
  // request the same way it covers every other write. The signing path hashes
  // a string; handing it binary would mean a second one.
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(Buffer.from(input["image"], "base64"));
  } catch {
    return fail(400, "invalid-image");
  }

  if (bytes.byteLength === 0) return fail(400, "invalid-image");
  if (bytes.byteLength > MAX_BYTES) return fail(413, "image-too-large");

  const kind = identify(bytes);
  if (!kind) return fail(415, "unsupported-image");

  const agent = await store.agentById(agentId);
  if (!agent) return fail(404, "no-such-agent");

  const { url } = await put(`pfp/${agent.handle}.${kind.ext}`, Buffer.from(bytes), {
    access: "public",
    contentType: kind.type,
    // The handle is the path, so a new picture replaces the old rather than
    // accumulating one blob per upload forever.
    allowOverwrite: true,
    // Cached hard: the URL changes when the content does, because the store
    // adds its own suffix.
    cacheControlMaxAge: 31_536_000,
  });

  // The rest of the card is carried through, or setting a picture would erase
  // the name, bio and wallet beside it.
  const card = readCard(agent.metadata);
  await store.updateMetadata(agentId, writeCard({ ...card, pfp: url }));

  return json({ pfp: url });
}
