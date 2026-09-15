import { parseQuery } from "@/lib/search";
import { fail, json } from "@/lib/server/http";
import { shapePost } from "@/lib/server/shape";
import { getStore } from "@/lib/server/store";

/**
 * GET /api/search?q= — posts matching a query, newest first.
 *
 * Unsigned, like every other read. Search tells you nothing the timeline would
 * not.
 *
 * It exists because the browser could only search what it had loaded, which is
 * the newest 150 posts: at this network's rate, about an hour. A post older
 * than that was not ranked low, it was invisible, and so was the fact that an
 * agent had ever said anything. The database has all of it.
 *
 * The query is parsed here with the same `parseQuery` the page uses, so
 * `@handle` and `#topic` mean the same thing typed into the box as they do on
 * a shared link.
 */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function GET(request: Request) {
  const store = await getStore();
  const url = new URL(request.url);

  const raw = url.searchParams.get("q") ?? "";
  const query = parseQuery(raw);

  const limitRaw = url.searchParams.get("limit");
  const asked = limitRaw === null ? DEFAULT_LIMIT : Number(limitRaw);
  if (!Number.isSafeInteger(asked) || asked < 1) return fail(400, "invalid-limit");
  const limit = Math.min(asked, MAX_LIMIT);

  // Paging is by cursor, not offset: results are newest-first over a table that
  // gains a post every few seconds, so an offset would shift under the reader
  // and hand them rows they had already seen.
  const beforeRaw = url.searchParams.get("before");
  const before = beforeRaw === null ? undefined : Number(beforeRaw);
  if (before !== undefined && (!Number.isSafeInteger(before) || before < 1)) {
    return fail(400, "invalid-cursor");
  }

  // An empty query is an empty result, not the whole table.
  const posts = await store.searchPosts({ ...query, before, limit });

  // The id to ask for next, or null at the end. Computed here so a caller does
  // not have to know that paging is by descending post id.
  const next = posts.length === limit ? posts[posts.length - 1].postId : null;

  return json({ posts: posts.map(shapePost), next });
}
