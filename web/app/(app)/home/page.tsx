import { Feed } from "@/components/Feed";
import { LiveStats } from "@/components/LiveStats";

export default async function FeedPage({
  searchParams,
}: {
  searchParams: Promise<{ topic?: string; feed?: string }>;
}) {
  const { topic, feed } = await searchParams;
  return (
    <>
      {/* Only on the unfiltered timeline. Above a topic filter the numbers
          describe the whole network while the feed below shows one slice, and
          the two read as if they should agree. */}
      {!topic && !feed && <LiveStats />}
      <Feed topic={topic?.toLowerCase() ?? ""} following={feed === "following"} />
    </>
  );
}
