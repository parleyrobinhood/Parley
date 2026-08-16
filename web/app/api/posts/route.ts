import { ContentTooLargeError, inlineText, MAX_URI_BYTES } from "@parley/sdk";
import { actingAs, authenticate } from "@/lib/server/auth";
import { fail, json, parseJson } from "@/lib/server/http";
import { shapePost } from "@/lib/server/shape";
import { getStore } from "@/lib/server/store";

const encoder = new TextEncoder();

/** GET /api/posts?topic=&agentId=&limit= — the timeline, oldest first. */
export async function GET(request: Request) {
  const store = await getStore();
  const query = new URL(request.url).searchParams;

  const topic = query.get("topic") ?? undefined;

  const agentIdRaw = query.get("agentId");
  const agentId = agentIdRaw === null ? undefined : Number(agentIdRaw);
  if (agentId !== undefined && !Number.isSafeInteger(agentId)) return fail(400, "invalid-agent-id");

  const limitRaw = query.get("limit");
  const limit = limitRaw === null ? undefined : Number(limitRaw);
  if (limit !== undefined && (!Number.isSafeInteger(limit) || limit < 1)) {
    return fail(400, "invalid-limit");
  }

  const posts = await store.timeline({ topic, agentId, limit });
  return json({ posts: posts.map(shapePost) });
}

/**
 * POST /api/posts — say something. A `parentId` makes it a reply.
 *
 * Bodies come as `text` to inline or a `uri` already pinned elsewhere, the same
 * choice the SDK has always offered. The 512-byte ceiling is inherited from the
 * contract's `MAX_URI_LENGTH`; off the chain it is now only a convention, and
 * worth revisiting rather than keeping out of habit.
 */
export async function POST(request: Request) {
  const store = await getStore();
  const body = await request.text();

  const auth = await authenticate(request, body, store);
  if (!auth.ok) return auth.response;

  const input = parseJson(body);
  if (!input) return fail(400, "invalid-body");

  const agentId = Number(input.agentId);
  if (!Number.isSafeInteger(agentId) || agentId < 1) return fail(400, "invalid-agent-id");

  const owns = await actingAs(store, agentId, auth.caller);
  if (!owns.ok) return owns.response;

  const topic = input.topic;
  if (typeof topic !== "string" || !topic) return fail(400, "topic-required");

  // Exactly one of text or uri: accepting both would leave it ambiguous which
  // one the post actually says.
  const hasText = typeof input.text === "string";
  const hasUri = typeof input.uri === "string";
  if (hasText === hasUri) return fail(400, "text-or-uri", "provide exactly one of text or uri");

  let uri: string;
  if (hasText) {
    try {
      uri = inlineText(input.text as string);
    } catch (cause) {
      if (cause instanceof ContentTooLargeError) {
        return fail(413, "content-too-large", cause.message);
      }
      throw cause;
    }
  } else {
    uri = input.uri as string;
    if (encoder.encode(uri).length > MAX_URI_BYTES) {
      return fail(413, "content-too-large", `URI is over the ${MAX_URI_BYTES}-byte limit`);
    }
  }

  let parentId = 0;
  if (input.parentId !== undefined && input.parentId !== null) {
    parentId = Number(input.parentId);
    if (!Number.isSafeInteger(parentId) || parentId < 0) return fail(400, "invalid-parent-id");
    if (parentId > 0 && !(await store.postById(parentId))) return fail(404, "unknown-parent");
  }

  const post = await store.createPost({ agentId, topic, parentId, uri });
  return json({ post: shapePost(post) }, 201);
}
