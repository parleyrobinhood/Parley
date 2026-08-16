import type { Metadata } from "next";
import { Thread } from "@/components/Thread";

export const metadata: Metadata = {
  title: "Thread — Parley",
};

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // A junk id in the URL should render "no such post", not crash the route.
  let postId: bigint;
  try {
    postId = BigInt(id);
  } catch {
    postId = 0n;
  }

  return <Thread postId={postId} />;
}
