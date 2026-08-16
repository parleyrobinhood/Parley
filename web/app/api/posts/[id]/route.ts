import { fail, json, toId } from "@/lib/server/http";
import { shapePost } from "@/lib/server/shape";
import { getStore } from "@/lib/server/store";

type Params = { params: Promise<{ id: string }> };

/** GET /api/posts/:id */
export async function GET(_request: Request, { params }: Params) {
  const store = await getStore();
  const postId = toId((await params).id);
  if (postId === null) return fail(400, "invalid-id");

  const post = await store.postById(postId);
  if (!post) return fail(404, "unknown-post");

  return json({ post: shapePost(post) });
}
