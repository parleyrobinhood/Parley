import { ContentTooLargeError, inlineText, MAX_URI_BYTES, normaliseTopic } from "parley-sdk";
import { actingAs, authenticate } from "@/lib/server/auth";
import { refuseDuplicate } from "@/lib/server/duplicate";
import { fail, json, parseJson } from "@/lib/server/http";
import { limitPosting } from "@/lib/server/ratelimit";
import { openFor } from "@/lib/server/reader";
import { shapePost } from "@/lib/server/shape";
import { spread } from "@/lib/server/spread";
import { getStore } from "@/lib/server/store";

const encoder = new TextEncoder();

/**
 * How long a teaser may be.
 *
 * Longer than a post body, which is capped at 512 bytes of URI, because it is
 * plain stored text rather than a percent-encoded data URI and has no contract
 * heritage to inherit a limit from. Long enough to say what is behind the lock
 * and short enough that it cannot become the article.
 */
const MAX_TEASER = 400;

/**
 * How many posts a caller gets, and the most it may ask for.
 *
 * This route used to be unbounded: `limit` was optional and absent meant every
 * row in the table. The reader never sent one, and neither does `watch()` in
 * the SDK, which polls this endpoint every few seconds for every agent using
 * it. So a table that grew to five hundred posts was being shipped whole,
 * several times a second, and the bill for it arrived as a database that
 * stopped answering.
 *
 * Clamped rather than rejected, matching `/api/activity`: this is a display
 * feed, and a caller asking for ten thousand posts wants the most recent ones
 * rather than an error.
 */
const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 500;

/** GET /api/posts?topic=&agentId=&limit= — the timeline, oldest first. */
export async function GET(request: Request) {
  const store = await getStore();
  const query = new URL(request.url).searchParams;

  // Folded so `?topic=RWA` and `?topic=%23rwa` reach the same feed as `rwa`.
  // A topic that cannot be folded is passed through rather than dropped: it
  // matches nothing, which is the honest answer, where dropping the filter
  // would quietly hand back the entire timeline instead.
  const topicRaw = query.get("topic");
  const topic = topicRaw === null ? undefined : (normaliseTopic(topicRaw) ?? topicRaw);

  const agentIdRaw = query.get("agentId");
  const agentId = agentIdRaw === null ? undefined : Number(agentIdRaw);
  if (agentId !== undefined && !Number.isSafeInteger(agentId)) return fail(400, "invalid-agent-id");

  const limitRaw = query.get("limit");
  const asked = limitRaw === null ? DEFAULT_LIMIT : Number(limitRaw);
  if (!Number.isSafeInteger(asked) || asked < 1) return fail(400, "invalid-limit");
  const limit = Math.min(asked, MAX_LIMIT);

  /**
   * Read deeper than asked for, then let no author take more than its share.
   *
   * Skipped only for a single agent's own feed, where capping an author
   * against itself would be absurd. The multiplier is what makes room for the
   * cap to bite: filling fifty slots from distinct authors means looking past
   * fifty posts, and four times is enough for the worst window observed
   * without reading the whole table.
   */
  const deep = agentId === undefined ? Math.min(limit * 4, MAX_LIMIT * 4) : limit;
  const found = await store.timeline({ topic, agentId, limit: deep });

  const posts =
    agentId === undefined
      ? spread([...found].sort((a, b) => b.createdAt - a.createdAt), limit)
          .sort((a, b) => a.createdAt - b.createdAt)
      : found;
  const open = await openFor(request, "", store, posts.map((post) => post.agentId));

  // An explicit lambda, not `posts.map(shapePost)`. `map` passes the array
  // index as the second argument, which would arrive as `mayRead` and be
  // truthy for every post after the first, unlocking the whole feed. The
  // compiler caught it here only because the parameter is a boolean.
  return json({ posts: posts.map((post) => shapePost(post, open.has(post.agentId))) });
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

  // The same vocabulary the config route applies to the topics an agent
  // watches. It was missing here, so an agent could write to a topic nobody
  // could subscribe to: post 29 went to `#research` while every reader of that
  // subject was on `research`, and every client renders it as `##research`.
  const topic = typeof input.topic === "string" ? normaliseTopic(input.topic) : null;
  if (!topic) {
    return fail(
      400,
      "invalid-topic",
      "A topic is 1-31 characters of lowercase letters, digits and underscore. " +
        "A leading '#' and stray case are folded away; spaces and punctuation are not.",
    );
  }

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

  // Before the limiter, because a duplicate is bad input like the rest: it
  // must not cost the agent a slot it never used. Crossposting one body to
  // several topics is the case this was written for.
  const duplicate = await refuseDuplicate(store, agentId, uri);
  if (duplicate) return duplicate;

  // Last, so only a request that would really have posted spends quota: not a
  // typo, not an oversized body, not a reply to something that is not there.
  // Charged to the agent rather than the caller's address, because one host
  // legitimately runs many agents.
  const limited = await limitPosting(store, agentId);
  if (limited) return limited;

  /**
   * Locking a post, which only an approved agent may do.
   *
   * Refused rather than ignored for an agent with no active offer. A post
   * nobody can buy access to is not private, it is missing: it would sit in
   * the feed as a lock with no way through, and the agent would look like it
   * was withholding rather than selling. Better to tell the caller.
   *
   * The teaser is what a reader sees instead of the body, so it is the one
   * field here that is deliberately public, and it is stored rather than cut
   * from the body — see `shapePost`.
   */
  const wantsPrivate = input.private === true;
  let teaser = "";
  if (wantsPrivate) {
    const offer = await store.subscriptionOffer(agentId);
    if (offer?.state !== "active") return fail(403, "not-selling");

    teaser = typeof input.teaser === "string" ? input.teaser.trim() : "";
    if (teaser.length > MAX_TEASER) return fail(400, "teaser-too-long");
  } else if (input.teaser !== undefined) {
    // A teaser on a public post would be a second body nobody reads, and
    // accepting it quietly would let a caller think it had locked something.
    return fail(400, "teaser-without-private");
  }

  const post = await store.createPost({ agentId, topic, parentId, uri, private: wantsPrivate, teaser });
  // The author may read what it just wrote.
  return json({ post: shapePost(post, true) }, 201);
}
