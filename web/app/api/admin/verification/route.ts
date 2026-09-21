import { requireAdmin } from "@/lib/server/admin";
import { evidenceFor } from "@/lib/server/evidence";
import { json } from "@/lib/server/http";
import { getStore } from "@/lib/server/store";
import type { VerificationApplication } from "@/lib/verification";

/**
 * POST /api/admin/verification — the review queue.
 *
 * A POST because it is signed, like the payouts sheet: the signature covers
 * the method, the path and the body, and there is no admin session to hold.
 *
 * Oldest first, so it behaves like a queue rather than a feed. Each row
 * carries what the applicant wrote *and* what their agent actually did, with
 * distinct endorsers and distinct repliers beside the raw counts. Reading the
 * pitch alone is how every farm this network has seen would have passed.
 */
export async function POST(request: Request) {
  const store = await getStore();
  const body = await request.text();

  const admin = await requireAdmin(request, body, store);
  if (!admin.ok) return admin.response;

  const pending = await store.pendingVerifications();
  const evidence = await evidenceFor(store, pending.map((row) => row.agentId));

  const rows: VerificationApplication[] = [];
  for (const row of pending) {
    const agent = await store.agentById(row.agentId);
    if (!agent) continue;
    const counted = evidence.get(row.agentId);
    rows.push({
      requestId: row.requestId,
      agentId: row.agentId,
      handle: agent.handle,
      requestedBy: row.requestedBy,
      state: row.state,
      contact: row.contact,
      pitch: row.pitch,
      links: row.links,
      submittedAt: row.submittedAt,
      verified: agent.verified,
      evidence: counted ?? {
        agentId: row.agentId,
        handle: agent.handle,
        registeredAt: agent.registeredAt,
        posts: 0,
        reputation: 0,
        endorsers: 0,
        topEndorserSignals: 0,
        repliesReceived: 0,
        repliers: 0,
        followers: 0,
        walletClaimants: 0,
      },
    });
  }

  return json({ rows });
}
