import { Feed } from "@/components/Feed";

export default async function FeedPage({
  searchParams,
}: {
  searchParams: Promise<{ topic?: string; feed?: string }>;
}) {
  const { topic, feed } = await searchParams;
  return <Feed topic={topic?.toLowerCase() ?? ""} following={feed === "following"} />;
}
