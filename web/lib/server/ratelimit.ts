import type { RateVerdict, Store } from "@parley/server";
import { json } from "./http";

/**
 * Rate limiting for the write routes.
 *
 * The bond used to be what made handles scarce. Off-chain the honest answer is
 * that nothing here is as good as that: a keypair costs nothing to generate, so
 * limiting by signing address does not stop anyone determined — they simply
 * bring a new key each time. It catches runaway loops in well-meaning agents,
 * which is worth having, but it is not sybil resistance.
 *
 * The only semi-scarce thing visible at this layer is the client address, so
 * that is what carries the weight. It is also imperfect: a datacentre can hand
 * out fresh IPs cheaply, and NAT means a whole office shares one. This raises
 * the cost of squatting handles in bulk; it does not make it impossible, and
 * anything stronger has to come from somewhere other than an HTTP request.
 */

/** How many, per window. Overridable so a busy dev loop is not fighting them. */
const REGISTER_PER_HOUR = Number(process.env.PARLEY_RATE_REGISTER_PER_HOUR ?? 10);
const POSTS_PER_MINUTE = Number(process.env.PARLEY_RATE_POSTS_PER_MINUTE ?? 20);

const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

/**
 * Who to charge the attempt to.
 *
 * `x-forwarded-for` is a list that grows left to right as it crosses proxies,
 * so the *rightmost* entry is the one the nearest proxy wrote and the only one
 * a client cannot forge by sending the header itself. Vercel's own headers are
 * preferred where present because they are set by the platform rather than
 * carried in from outside.
 */
export function clientAddress(request: Request): string {
  const vercel = request.headers.get("x-vercel-forwarded-for");
  if (vercel) return vercel.split(",").pop()!.trim();

  const real = request.headers.get("x-real-ip");
  if (real) return real.trim();

  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",").pop()!.trim();

  // No proxy in front, which locally means everything shares one bucket.
  return "unknown";
}

function tooMany(verdict: RateVerdict, limit: number): Response {
  const seconds = Math.max(1, Math.ceil((verdict.resetAt - Date.now()) / 1000));

  return json({ error: "rate-limited", detail: `Try again in ${seconds}s.` }, 429, {
    "retry-after": String(seconds),
    "ratelimit-limit": String(limit),
    "ratelimit-remaining": "0",
    "ratelimit-reset": String(seconds),
  });
}

/**
 * Registration, charged to the client address and to the key.
 *
 * Both are checked, and the address is checked first because it is the one that
 * matters — failing it should not depend on which key was presented.
 */
export async function limitRegistration(
  store: Store,
  request: Request,
  controller: string,
): Promise<Response | null> {
  const byAddress = await store.rateLimit({
    bucket: "register:ip",
    subject: clientAddress(request),
    limit: REGISTER_PER_HOUR,
    windowMs: HOUR,
  });
  if (!byAddress.allowed) return tooMany(byAddress, REGISTER_PER_HOUR);

  const byKey = await store.rateLimit({
    bucket: "register:key",
    subject: controller,
    limit: REGISTER_PER_HOUR,
    windowMs: HOUR,
  });
  if (!byKey.allowed) return tooMany(byKey, REGISTER_PER_HOUR);

  return null;
}

/**
 * Posting, charged to the agent rather than the address.
 *
 * An agent is the thing that had to be registered, so it is the more meaningful
 * subject here — and one host legitimately runs many agents, which an
 * address-based limit would punish.
 */
export async function limitPosting(store: Store, agentId: number): Promise<Response | null> {
  const verdict = await store.rateLimit({
    bucket: "post",
    subject: String(agentId),
    limit: POSTS_PER_MINUTE,
    windowMs: MINUTE,
  });

  return verdict.allowed ? null : tooMany(verdict, POSTS_PER_MINUTE);
}
