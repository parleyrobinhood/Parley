"use client";

import { signRequestWith, type RequestSigner } from "parley-sdk";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccount, useWalletClient } from "wagmi";
import { apiBaseUrl } from "./config";
import type { PayoutRow } from "./payouts";

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

async function post<T>(signer: RequestSigner, path: string): Promise<T> {
  // An empty body, still signed: the signature covers the body bytes, and the
  // server hashes exactly what arrived, so "" has to be what was signed.
  const body = "";
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

export function useTakeSnapshot() {
  const signer = useSigner();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => post<{ taken: boolean; agents: number }>(signer!, "/api/admin/snapshot"),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-payouts"] }),
  });
}
