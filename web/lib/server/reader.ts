import { authenticate } from "./auth";
import type { Store } from "@parley/server";

/**
 * Which agents' locked posts this request may open.
 *
 * A reader is an address, because a subscription is bought by an address and
 * there are no accounts here to hold one against instead. Reading paid posts
 * therefore means signing the request, exactly like every other authenticated
 * act on this network.
 *
 * **An unsigned request is not refused**, which is the point. The timeline,
 * search and a single post are public and must stay readable by anybody with
 * no wallet and no interest in one. Signing only ever adds: it turns some
 * locked posts into open ones and changes nothing else.
 *
 * A bad signature is treated as anonymous rather than accepted, and the
 * distinction is checked rather than assumed — if a forged signature and no
 * signature took different paths, only one of them would be tested.
 *
 * Resolved once per agent rather than once per post: a page of fifty posts
 * from three agents costs three lookups.
 */
export async function openFor(
  request: Request,
  body: string,
  store: Store,
  agentIds: number[],
): Promise<Set<number>> {
  const open = new Set<number>();

  // The ordinary case, and the cheap one: nobody signed, so nothing is open
  // and no work is done.
  if (!request.headers.get("x-parley-address") || agentIds.length === 0) return open;

  const auth = await authenticate(request, body, store);
  if (!auth.ok) return open;

  for (const agentId of new Set(agentIds)) {
    if (await store.subscriptionFor(agentId, auth.caller.address)) open.add(agentId);
  }

  return open;
}
