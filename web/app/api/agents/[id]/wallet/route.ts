import { readCard, verifyWalletProof, type WalletProofClaim } from "parley-sdk";
import { fail, json, parseJson, toId } from "@/lib/server/http";
import { limitVerification } from "@/lib/server/ratelimit";
import { getStore } from "@/lib/server/store";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/agents/:id/wallet — confirm the agent holds the address it names.
 *
 * A payout address was a string on the agent's card, written by whoever
 * controls the agent and checked by nobody: three agents were pointed at one
 * address and nothing objected. Survivable while the worst case is the
 * operator paying the wrong agent out of their own treasury. Not survivable
 * once money moves between users, because the same string becomes a claim on
 * somebody else's revenue.
 *
 * **Two halves, and the first one already happened.** `--wallet` writes the
 * address to the card in a request signed by the agent's key, so the agent has
 * already said the address is its own. This route answers the other half: does
 * whoever holds the address agree? That answer can only come from the wallet,
 * which lives in a browser rather than in the terminal holding the agent's
 * key, so it arrives as its own signature over a message naming this agent.
 *
 * **So this needs no request signature, and requiring one would be wrong.**
 * The declaration is the agent's authorisation and it is already on the card.
 * Demanding the agent's key here too would mean the proof could only be made
 * on the machine running the agent, which is exactly where the wallet is not.
 *
 * A stranger cannot bind their address to somebody else's agent: that agent
 * never declared it, and the check below refuses on that rather than on who is
 * asking.
 */
export async function POST(request: Request, { params }: Params) {
  const store = await getStore();
  const agentId = toId((await params).id);
  if (agentId === null) return fail(400, "invalid-id");

  const limited = await limitVerification(store, request);
  if (limited) return limited;

  const input = parseJson(await request.text());
  if (!input) return fail(400, "invalid-body");

  const address = typeof input["address"] === "string" ? input["address"] : "";
  const signature = typeof input["signature"] === "string" ? input["signature"] : "";
  const nonce = typeof input["nonce"] === "string" ? input["nonce"] : "";
  const issuedAt = Number(input["issuedAt"]);
  if (!address || !signature || !nonce) return fail(400, "invalid-body");

  const agent = await store.agentById(agentId);
  if (!agent) return fail(404, "unknown-agent");

  // The agent has to have named this address itself. This is what stands in
  // for an authorisation header: the declaration was signed by the agent's key
  // when it was written, and a proof for an address the agent never claimed
  // would be somebody volunteering to be paid as an agent that never asked.
  const declared = new Set<string>();
  const onCard = readCard(agent.metadata).wallet;
  if (onCard) declared.add(onCard.toLowerCase());
  for (const claim of await store.walletClaims()) {
    if (claim.agentId === agentId) declared.add(claim.address.toLowerCase());
  }
  if (!declared.has(address.toLowerCase())) return fail(409, "not-declared");

  // The agent id comes from the path and is inside the signed text, so a proof
  // made for one agent cannot be submitted for another.
  const claim: WalletProofClaim = { agentId, address, nonce, issuedAt };
  const proof = await verifyWalletProof(claim, signature);
  if (!proof.ok) return fail(proof.reason === "expired" ? 401 : 400, proof.reason);

  // Charged to the wallet, because the signature that could be replayed is the
  // wallet's. Remembering it per caller would let one proof be spent again by
  // anybody who saw it.
  const fresh = await store.rememberNonce(nonce, proof.address.toLowerCase(), issuedAt + 60 * 60 * 1000);
  if (!fresh) return fail(409, "replayed");

  await store.proveWallet(agentId, proof.address);

  return json({ agentId, handle: agent.handle, address: proof.address, proved: true });
}
