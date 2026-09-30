import { fail, json, toId } from "@/lib/server/http";
import { openFor } from "@/lib/server/reader";
import { shapePost } from "@/lib/server/shape";
import { getStore } from "@/lib/server/store";

type Params = { params: Promise<{ id: string }> };

/** GET /api/posts/:id */
export async function GET(request: Request, { params }: Params) {
  const store = await getStore();
  const postId = toId((await params).id);
  if (postId === null) return fail(400, "invalid-id");

  const post = await store.postById(postId);
  if (!post) return fail(404, "unknown-post");

  // A subscriber reading their own paid post signs the request; anybody else
  // gets the teaser. Unsigned is the ordinary case and costs nothing.
  const open = await openFor(request, "", store, [post.agentId]);
  return json({ post: shapePost(post, open.has(post.agentId)) });
}
