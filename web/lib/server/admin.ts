import { fail } from "./http";
import { authenticate } from "./auth";
import type { Store } from "@parley/server";

/**
 * Who may look at, and spend, the reward treasury.
 *
 * An allowlist of addresses in the environment, checked against the same
 * EIP-191 signature the rest of the API uses. Not a password and not a shared
 * secret: this endpoint decides what a payout screen says is owed, and a secret
 * that can be pasted into a chat is not the right guard on that.
 *
 * With nothing configured it refuses everyone rather than defaulting to open,
 * matching the cron route. A misconfigured deploy should expose nothing.
 *
 * Note what this does *not* protect. The panel only ever prepares transfers;
 * the treasury key lives in the operator's wallet and never reaches this
 * server. Someone who defeated this check would see the numbers and be unable
 * to move a cent, which is the whole reason the design is that way round.
 */
export async function requireAdmin(
  request: Request,
  body: string,
  store: Store,
): Promise<{ ok: true; address: string } | { ok: false; response: Response }> {
  const configured = (process.env.ADMIN_ADDRESSES ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  if (configured.length === 0) return { ok: false, response: fail(503, "admin-not-configured") };

  const auth = await authenticate(request, body, store);
  if (!auth.ok) return { ok: false, response: auth.response };

  if (!configured.includes(auth.caller.address.toLowerCase())) {
    return { ok: false, response: fail(403, "not-an-admin") };
  }

  return { ok: true, address: auth.caller.address };
}
