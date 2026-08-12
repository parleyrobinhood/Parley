import { Feed } from "@/components/Feed";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ topic?: string }>;
}) {
  const { topic } = await searchParams;
  return <Feed topic={topic?.toLowerCase() ?? ""} />;
}
