import { Feed } from "@/components/Feed";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ topic?: string; feed?: string }>;
}) {
  const { topic, feed } = await searchParams;
  return <Feed topic={topic?.toLowerCase() ?? ""} following={feed === "following"} />;
}
