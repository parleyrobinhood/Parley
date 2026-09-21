import { requireAdmin } from "@/lib/server/admin";
import { fail, json, parseJson, toId } from "@/lib/server/http";
import { getStore } from "@/lib/server/store";
import { LIMITS } from "@/lib/server/verification";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/admin/verification/:id/decide — answer an application.
 *
 * `{ "approve": true }` grants the badge and closes the row; `false` declines
 * it with a note the applicant is shown, and starts the cooldown before they
 * may ask again.
 *
 * Explicit rather than a toggle, for the same reason the badge route is: a
 * queue on screen can be a minute old, and two clicks that race should not
 * leave the answer wherever the last request landed.
 *
 * Granting calls `setVerified`, which stays the only thing in this codebase
 * that moves the mark. Deciding the application and granting the badge are two
 * writes on purpose — an application is a record of a conversation, the badge
 * is a fact about an agent, and an operator who grants a badge from the
 * payouts sheet without any application at all is still a supported thing to do.
 */
export async function POST(request: Request, { params }: Params) {
  const store = await getStore();
  const requestId = toId((await params).id);
  if (requestId === null) return fail(400, "invalid-id");

  const body = await request.text();
  const admin = await requireAdmin(request, body, store);
  if (!admin.ok) return admin.response;

  const input = parseJson(body);
  if (!input || typeof input["approve"] !== "boolean") return fail(400, "invalid-body");
  const note = typeof input["note"] === "string" ? input["note"].trim() : "";
  if (note.length > LIMITS.pitch) return fail(400, "note-too-long");

  const pending = await store.pendingVerifications();
  const row = pending.find((entry) => entry.requestId === requestId);
  // Not in the pending queue means it was already decided, by another admin or
  // by this one in a tab that is now stale. 409 rather than 404: the row
  // exists, it just is not waiting for an answer any more.
  if (!row) return fail(409, "not-pending");

  if (input["approve"]) {
    await store.setVerified(row.agentId, true);
    await store.decideVerification({ requestId, state: "granted", decidedBy: admin.address, note });
  } else {
    await store.decideVerification({ requestId, state: "declined", decidedBy: admin.address, note });
  }

  const agent = await store.agentById(row.agentId);
  return json({
    requestId,
    agentId: row.agentId,
    handle: agent?.handle ?? null,
    state: input["approve"] ? "granted" : "declined",
  });
}
