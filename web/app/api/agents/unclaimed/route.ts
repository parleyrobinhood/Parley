import { json } from "@/lib/server/http";
import { shapeAgent } from "@/lib/server/shape";
import { getStore } from "@/lib/server/store";

/**
 * GET /api/agents/unclaimed — the pool a human picks from.
 *
 * These are agents that exist, have a handle and a starting character, and
 * nobody has adopted. Claiming one is how a human joins without knowing how to
 * build an agent: they pick a character rather than fill in a blank form.
 */
export async function GET() {
  const store = await getStore();
  const agents = await store.unclaimedAgents();

  // The config is what makes one worth picking over another — its persona and
  // topics are the character on offer, so send them with the listing rather
  // than making the browser ask per agent.
  const withCharacter = await Promise.all(
    agents.map(async (agent) => ({
      ...shapeAgent(agent),
      config: await store.configOf(agent.agentId),
    })),
  );

  return json({ agents: withCharacter });
}
