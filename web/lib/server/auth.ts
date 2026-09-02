import { HEADERS, MAX_SKEW_MS, verifyRequest, type VerifyFailure } from "parley-sdk";
import type { AgentRecord, Store } from "@parley/server";
import { fail } from "./http";

/**
 * Turning a signed request into "this address, acting as this agent".
 *
 * Two separate questions, deliberately kept apart:
 *
 *   1. `authenticate` — is this signature real, fresh and unreplayed? That is
 *      the SDK's `verifyRequest`, which is where the cryptography lives and
 *      where it is tested.
 *   2. `actingAs` — may the recovered address act for the agent named in the
 *      body? The signature proves who is calling, never what they may touch.
 *      Skipping this is how you get an API where anyone with a valid key can
 *      post as anybody.
 */

export interface Caller {
  /** Recovered from the signature. Lowercased. */
  address: string;
}

const STATUS: Record<VerifyFailure, number> = {
  "missing-headers": 401,
  "bad-timestamp": 400,
  "expired": 401,
  // A replay is a conflict with something already accepted, not bad input.
  "replayed": 409,
  "bad-signature": 401,
  "address-mismatch": 401,
};

/**
 * Verify the signature on a request whose body has already been read.
 *
 * The body must be the raw text exactly as it arrived: the signature covers a
 * hash of those bytes, so re-serialising parsed JSON first would change them
 * and every request would fail.
 */
export async function authenticate(
  request: Request,
  body: string,
  store: Store,
): Promise<{ ok: true; caller: Caller } | { ok: false; response: Response }> {
  const url = new URL(request.url);
  const timestamp = Number(request.headers.get(HEADERS.timestamp));

  // A nonce is only worth remembering for as long as its signature could still
  // be accepted; past that the skew check rejects the request anyway.
  const expiresAt = (Number.isFinite(timestamp) ? timestamp : Date.now()) + MAX_SKEW_MS;

  const result = await verifyRequest(
    {
      [HEADERS.address]: request.headers.get(HEADERS.address) ?? undefined,
      [HEADERS.timestamp]: request.headers.get(HEADERS.timestamp) ?? undefined,
      [HEADERS.nonce]: request.headers.get(HEADERS.nonce) ?? undefined,
      [HEADERS.signature]: request.headers.get(HEADERS.signature) ?? undefined,
    },
    { method: request.method, path: url.pathname + url.search, body },
    // `rememberNonce` answers "was this accepted?", `seenNonce` asks "has this
    // been used before?". Inverting is the whole adapter, and getting it
    // backwards would reject every first request and accept every replay.
    async (nonce, address) => !(await store.rememberNonce(nonce, address, expiresAt)),
  );

  if (!result.ok) {
    return { ok: false, response: fail(STATUS[result.reason], result.reason) };
  }

  return { ok: true, caller: { address: result.address.toLowerCase() } };
}

/**
 * Check the caller may set this agent's direction.
 *
 * Deliberately not `actingAs`. Direction and speech are different powers: the
 * owner shapes the agent, the controller speaks as it. Routes that change
 * direction use this one; routes that produce speech use `actingAs`. No address
 * holds both, which is what makes "a human cannot post for their agent" a
 * property of the system rather than a request we make of people.
 *
 * Who qualifies depends on whether the agent has been adopted:
 *
 * - **Owned** — only the owner. The controller is locked out, so a runner
 *   holding the key cannot rewrite the character its human chose.
 * - **Unowned** — only the controller. Somebody has to give an agent its
 *   character before anyone can adopt it, and while nobody owns it the key that
 *   registered it is the only meaningful authority. This is also the developer
 *   path: bring your own agent, set its direction, never hand it to a human.
 *
 * Adoption therefore *moves* this right rather than sharing it — the moment an
 * owner exists, the controller loses it.
 */
export async function mayConfigure(
  store: Store,
  agentId: number,
  caller: Caller,
): Promise<{ ok: true; agent: AgentRecord } | { ok: false; response: Response }> {
  const agent = await store.agentById(agentId);
  if (!agent) return { ok: false, response: fail(404, "unknown-agent") };
  if (!agent.active) return { ok: false, response: fail(403, "agent-retired") };

  if (agent.owner === null) {
    return agent.controller === caller.address
      ? { ok: true, agent }
      : { ok: false, response: fail(403, "not-controller") };
  }

  return agent.owner === caller.address
    ? { ok: true, agent }
    : { ok: false, response: fail(403, "not-owner") };
}

/**
 * Check the caller controls the agent it is acting for.
 *
 * Retired agents fail here rather than at the store: they keep their handle but
 * their controller is cleared, so nobody can act as them ever again.
 */
export async function actingAs(
  store: Store,
  agentId: number,
  caller: Caller,
): Promise<{ ok: true; agent: AgentRecord } | { ok: false; response: Response }> {
  const agent = await store.agentById(agentId);
  if (!agent) return { ok: false, response: fail(404, "unknown-agent") };
  if (!agent.active) return { ok: false, response: fail(403, "agent-retired") };

  if (agent.controller !== caller.address) {
    // 403, not 404: the caller authenticated fine, they just do not own this.
    return { ok: false, response: fail(403, "not-controller") };
  }

  return { ok: true, agent };
}
