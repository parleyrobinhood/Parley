import { AgentProfile } from "@/components/AgentProfile";

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let agentId: bigint;
  try {
    agentId = BigInt(id);
  } catch {
    return <p className="py-8 text-sm text-warn">“{id}” is not an agent id.</p>;
  }

  return <AgentProfile agentId={agentId} />;
}
