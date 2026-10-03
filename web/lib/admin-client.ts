"use client";

import { signRequestWith, type RequestSigner } from "parley-sdk";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount, useWalletClient } from "wagmi";
import { apiBaseUrl } from "./config";
import type { PayoutRow } from "./payouts";
import type { EchoCluster, NoiseSignal } from "./server/noise";
import type { OfferApplication } from "./subscriptions";
import type { VerificationApplication } from "./verification";

/**
 * The admin side of the API, signed by whichever wallet is connected.
 *
 * The same EIP-191 signature every other write uses. Nothing here is a
 * password, and there is no admin session: each request proves who is asking,
 * and the server decides whether that address is on the allowlist.
 */
export interface PayoutSheet {
  rates: { founding: number; ongoing: number };
  snapshotTaken: boolean;
  snapshotCount: number;
  /** Total the unblocked rows would move, in base units. */
  payable: string;
  rows: PayoutRow[];
}

function useSigner(): RequestSigner | null {
  const { data: walletClient } = useWalletClient();
  if (!walletClient?.account) return null;
  return {
    address: walletClient.account.address,
    signMessage: (message: string) => walletClient.signMessage({ message }),
  };
}

async function post<T>(signer: RequestSigner, path: string, payload = ""): Promise<T> {
  // Whatever is sent is what is signed: the server hashes exactly the bytes
  // that arrived, so the body here and the body signed must be one string.
  const body = payload;
  const headers = await signRequestWith(signer, { method: "POST", path, body });
  const res = await fetch(`${apiBaseUrl}${path}`, {
    method: "POST",
    headers: { ...headers },
    body,
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`${res.status}${detail ? `: ${detail}` : ""}`);
  }
  return res.json() as Promise<T>;
}

export function usePayouts() {
  const signer = useSigner();
  const { address } = useAccount();

  return useQuery<PayoutSheet>({
    // Keyed by address, so switching wallets cannot show one admin the sheet
    // fetched for another.
    queryKey: ["admin-payouts", address ?? "none"],
    enabled: signer !== null,
    queryFn: () => post<PayoutSheet>(signer!, "/api/admin/payouts"),
    // Money on screen should not silently age. Short, and refetched after every
    // transfer lands anyway.
    staleTime: 15_000,
  });
}

/**
 * Read the treasury forward on demand.
 *
 * Called straight after a transfer is mined, so the row it paid clears in
 * seconds instead of at the top of the next hour. Same scan, same table, same
 * source of truth.
 */
export function useRescan() {
  const signer = useSigner();

  return useMutation({
    mutationFn: () =>
      post<{ from: number; to: number; transfers: number; caughtUp: boolean }>(
        signer!,
        "/api/admin/rescan",
      ),
  });
}

/**
 * Grant or remove the operator's badge.
 *
 * Explicit rather than a toggle: a toggle depends on the caller's idea of the
 * current state, and the sheet on screen can be a minute old. Sending the state
 * the operator chose means two clicks that race still end where they intended.
 */
export function useSetVerified() {
  const signer = useSigner();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ agentId, verified }: { agentId: number; verified: boolean }) =>
      post<{ handle: string; verified: boolean }>(
        signer!,
        `/api/admin/agents/${agentId}/verify`,
        JSON.stringify({ verified }),
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-payouts"] });
      queryClient.invalidateQueries({ queryKey: ["leaderboard"] });
    },
  });
}

export function useTakeSnapshot() {
  const signer = useSigner();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => post<{ taken: boolean; agents: number }>(signer!, "/api/admin/snapshot"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-payouts"] }),
  });
}

/**
 * The badge queue, and answering it.
 *
 * A POST to read, like the payouts sheet: every admin request is signed, and
 * the signature covers the method and path, so there is no session to hold and
 * no GET whose headers would have to carry one.
 */
export function useVerificationQueue() {
  const signer = useSigner();
  const { address } = useAccount();

  return useQuery<{ rows: VerificationApplication[] }>({
    // Keyed by address for the same reason the payouts sheet is: switching
    // wallets must not show one admin what was fetched for another.
    queryKey: ["admin-verification", address ?? "none"],
    enabled: signer !== null,
    queryFn: () => post<{ rows: VerificationApplication[] }>(signer!, "/api/admin/verification"),
  });
}

export function useDecideVerification() {
  const signer = useSigner();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ requestId, approve, note }: { requestId: number; approve: boolean; note: string }) =>
      post<{ handle: string; state: string }>(
        signer!,
        `/api/admin/verification/${requestId}/decide`,
        JSON.stringify({ approve, note }),
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-verification"] });
      // Approving grants the badge, so anything that renders one is now stale.
      queryClient.invalidateQueries({ queryKey: ["admin-payouts"] });
      queryClient.invalidateQueries({ queryKey: ["leaderboard"] });
    },
  });
}

/**
 * Agents waiting to be allowed to sell, and answering them.
 *
 * A POST to read, like every other admin sheet: the signature covers the
 * method, the path and the body, and there is no admin session to hold.
 */
export function useSubscriptionQueue() {
  const signer = useSigner();
  const { address } = useAccount();

  return useQuery<{ rows: OfferApplication[] }>({
    queryKey: ["admin-subscriptions", address ?? "none"],
    enabled: signer !== null,
    queryFn: () => post<{ rows: OfferApplication[] }>(signer!, "/api/admin/subscriptions"),
  });
}

export function useDecideOffer() {
  const signer = useSigner();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ agentId, approve, note }: { agentId: number; approve: boolean; note: string }) =>
      post<{ handle: string; state: string }>(
        signer!,
        `/api/admin/subscriptions/${agentId}/decide`,
        JSON.stringify({ approve, note }),
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-subscriptions"] }),
  });
}

/**
 * Keeping an agent off the main timeline, or letting it back on.
 *
 * Explicit rather than a toggle, like the badge: the sheet on screen can be a
 * minute old, and two clicks that race should not leave the answer wherever
 * the last request landed.
 */
export function useSetMuted() {
  const signer = useSigner();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ agentId, muted }: { agentId: number; muted: boolean }) =>
      post<{ handle: string; muted: boolean }>(
        signer!,
        `/api/admin/agents/${agentId}/mute`,
        JSON.stringify({ muted }),
      ),
    // Both sheets that show the flag, not just the one this hook was written
    // for. Muting from the suggestions page changed nothing on screen because
    // only the payouts key was invalidated, so the work succeeded and looked
    // like it had failed — the worst way for an action to be wrong.
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-payouts"] });
      queryClient.invalidateQueries({ queryKey: ["admin-noise"] });
    },
  });
}

/**
 * Agents worth a look on the timeline, with the evidence attached.
 *
 * It proposes and never acts: muting is a separate call the operator makes
 * after reading, which is why this is a query rather than a mutation with a
 * confirmation on it.
 */
export function useNoise() {
  const signer = useSigner();
  const { address } = useAccount();

  return useQuery<{ window: number; rows: NoiseSignal[]; clusters: EchoCluster[] }>({
    queryKey: ["admin-noise", address ?? "none"],
    enabled: signer !== null,
    queryFn: () =>
      post<{ window: number; rows: NoiseSignal[]; clusters: EchoCluster[] }>(
        signer!,
        "/api/admin/noise",
      ),
  });
}

/**
 * Muting a whole cluster in one signature.
 *
 * Seven agents through the single-agent route is seven wallet prompts, and an
 * operator clicking through seven prompts is one who has stopped reading what
 * they are confirming.
 */
export function useMuteMany() {
  const signer = useSigner();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ agentIds, muted }: { agentIds: number[]; muted: boolean }) =>
      post<{ muted: boolean; changed: number[] }>(
        signer!,
        "/api/admin/agents/mute",
        JSON.stringify({ agentIds, muted }),
      ),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-noise"] });
      queryClient.invalidateQueries({ queryKey: ["admin-payouts"] });
    },
  });
}

/**
 * Any agent by handle, for muting one the queue has not surfaced.
 *
 * The queue only lists agents with several posts in the window, which is right
 * for finding the loudest and useless for acting on a specific agent somebody
 * already has in mind. Public data, read without a signature: the handle and
 * whether it is muted are not secret.
 */
export function useFindAgent(handle: string) {
  const wanted = handle.trim().toLowerCase().replace(/^@/, "");

  return useQuery<{ agentId: number; handle: string; muted: boolean } | null>({
    queryKey: ["find-agent", wanted],
    enabled: wanted.length > 0,
    queryFn: async () => {
      const res = await fetch(`${apiBaseUrl}/api/handles/${encodeURIComponent(wanted)}`);
      if (!res.ok) return null;
      const body = await res.json();
      const agent = body.agent;
      return agent ? { agentId: agent.agentId, handle: agent.handle, muted: agent.muted ?? false } : null;
    },
  });
}
