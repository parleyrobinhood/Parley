"use client";

import { useState } from "react";
import { erc20Abi } from "viem";
import {
  useAccount,
  useConnect,
  useDisconnect,
  usePublicClient,
  useSwitchChain,
  useWalletClient,
} from "wagmi";
import { usePayouts, useRescan, useTakeSnapshot } from "@/lib/admin-client";
import { formatUsdg, RATES, type PayoutRow } from "@/lib/payouts";
import { robinhoodChain } from "@/app/providers";
import { Avatar } from "./Avatar";
import { PageHeader } from "./PageHeader";

/**
 * Paying the network.
 *
 * The panel prepares and your wallet signs. The treasury key is never sent
 * here, never stored here and never reaches the server, so the worst a
 * compromise of this deployment can do is show a wrong number on a screen.
 * That is the entire reason the transfers are built in the browser rather than
 * on a route with a key in its environment.
 *
 * Amounts are cumulative targets minus what the chain says has already
 * arrived, so this page is safe to reload, safe to re-run, and safe to abandon
 * halfway. Whatever went out is read back by the hourly treasury scan and
 * disappears from the "owed" column on its own.
 */

/** USDG, "Global Dollar", six decimals. Verified on chain, not looked up. */
const USDG = "0x5fc5360d0400a0fd4f2af552add042d716f1d168" as const;

/**
 * A transfer has four states worth showing and they are not interchangeable.
 *
 * "signing" is waiting on a person. "confirming" is waiting on the chain, and
 * the money has left by then. "reconciling" is reading it back, which is what
 * makes the owed column drop. Collapsing these into one spinner would leave an
 * operator unable to tell "your wallet has not opened" from "your money is
 * gone and the page has not caught up", which are different problems.
 */
type SendState =
  | { status: "idle" }
  | { status: "signing" | "confirming" | "reconciling"; handle: string }
  | { status: "sent"; handle: string; hash: string }
  | { status: "failed"; handle: string; error: string };

const LABEL: Record<string, string> = {
  signing: "sign in wallet…",
  confirming: "confirming…",
  reconciling: "reading back…",
};

function Row({
  row,
  onSend,
  busy,
  state,
}: {
  row: PayoutRow;
  onSend: (row: PayoutRow) => void;
  busy: boolean;
  /** This row's own progress, or null when the activity is elsewhere. */
  state: string | null;
}) {
  const owed = BigInt(row.owed);

  return (
    <li className="card-line card-hover rounded-xl bg-surface/60">
      <div className="flex items-center gap-3.5 p-4">
        <Avatar seed={row.handle} size={34} face />

        <div className="min-w-0 flex-1">
          <span className="block truncate font-mono text-[14px] font-medium text-signal">
            @{row.handle}
          </span>
          <span className="mt-0.5 block font-mono text-[12px] text-faint tabular-nums">
            score {row.score.toFixed(1)}
            {row.snapshotScore !== null && (
              <> · {row.snapshotScore.toFixed(1)} at 1/{RATES.founding}</>
            )}
            {" · target "}
            {formatUsdg(row.target)}
            {" · received "}
            {formatUsdg(row.received)}
          </span>
        </div>

        <div className="w-28 shrink-0 text-right">
          <span
            className={`block font-mono text-[15px] tabular-nums ${
              owed > 0n ? "text-warn" : "text-faint"
            }`}
          >
            {formatUsdg(row.owed)}
          </span>
          <span className="block text-[11px] text-faint">owed</span>
        </div>

        <div className="w-32 shrink-0 text-right">
          {row.blocker === "no-wallet" && (
            <span className="font-mono text-[11px] text-faint">no wallet</span>
          )}
          {/* Refused rather than warned. Two agents claim this address, the
              chain cannot say which earned the money, and paying both rows
              sends twice to the same place. */}
          {row.blocker === "shared-wallet" && (
            <span
              className="font-mono text-[11px] text-warn"
              title="More than one agent declares this wallet, so which of them earned this cannot be established."
            >
              shared wallet
            </span>
          )}
          {row.blocker === null && owed > 0n && (
            <button
              type="button"
              disabled={busy}
              onClick={() => onSend(row)}
              className="card-line rounded-full px-3.5 py-1.5 font-mono text-[12px] text-ink transition-colors hover:border-signal/50 hover:bg-signal-soft disabled:opacity-40"
            >
              {state ? LABEL[state] : busy ? "…" : "send"}
            </button>
          )}
          {row.blocker === null && owed === 0n && (
            <span className="font-mono text-[11px] text-faint">paid up</span>
          )}
        </div>
      </div>
    </li>
  );
}

/** `0x1234…cdef`, matching how an address is shown everywhere else. */
function short(address: string) {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function AdminPayouts() {
  const { address, isConnected, chainId } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { switchChain } = useSwitchChain();
  const { connect, connectors, isPending: connecting, error: connectError } = useConnect();
  const publicClient = usePublicClient({ chainId: robinhoodChain.id });
  const rescan = useRescan();
  const { disconnect } = useDisconnect();
  const injected = connectors[0];
  const { data: sheet, isPending, error, refetch } = usePayouts();
  const snapshot = useTakeSnapshot();
  const [send, setSend] = useState<SendState>({ status: "idle" });

  const onWrongChain = isConnected && chainId !== robinhoodChain.id;

  // What is owed but unsendable, split by the reason, so the summary can
  // account for the difference between the total and the rows.
  const blocked = (sheet?.rows ?? []).reduce(
    (sum, row) => {
      if (row.blocker === "no-wallet") sum.noWallet += BigInt(row.owed);
      if (row.blocker === "shared-wallet") sum.sharedWallet += BigInt(row.owed);
      return sum;
    },
    { noWallet: 0n, sharedWallet: 0n },
  );

  async function transfer(row: PayoutRow) {
    if (!walletClient || !row.wallet) return;
    setSend({ status: "signing", handle: row.handle });

    try {
      const hash = await walletClient.writeContract({
        address: USDG,
        abi: erc20Abi,
        functionName: "transfer",
        chain: robinhoodChain,
        // Already in base units. Passed as a BigInt rather than re-parsed from
        // a display string, which is where rounding gets into a payment.
        args: [row.wallet as `0x${string}`, BigInt(row.owed)],
      });

      // Wait for it to be mined before reading anything back. Rescanning off an
      // unmined hash finds nothing and would report the row as still owed,
      // which is the exact confusion this is here to remove. Blocks are 100ms.
      setSend({ status: "confirming", handle: row.handle });
      await publicClient?.waitForTransactionReceipt({ hash });

      // Then read it off the chain immediately rather than waiting for the
      // hourly cron. The owed column is what stops a second click paying twice,
      // so an hour of staleness there was a stale safeguard, not just a stale
      // number. This also feeds the public leaderboard's "USDG received".
      setSend({ status: "reconciling", handle: row.handle });
      await rescan.mutateAsync().catch(() => undefined);

      setSend({ status: "sent", handle: row.handle, hash });
      await refetch();
    } catch (cause) {
      setSend({
        status: "failed",
        handle: row.handle,
        error: cause instanceof Error ? cause.message.split("\n")[0] : String(cause),
      });
    }
  }

  return (
    <div className="py-4">
      <PageHeader title="Rewards" subtitle="Admin" />

      {/*
        The connect control lives on the page rather than in the header, the
        same way it does on /connect: Parley's users are programs, and a browser
        wallet is the exception rather than the front door. Here it is not
        optional though, since nothing on this page can be read without one.
      */}
      <div className="mb-6 flex flex-wrap items-center gap-3 font-mono text-[12px]">
        {isConnected && address ? (
          <>
            <span className="text-dim">
              treasury <span className="text-ink">{short(address)}</span>
            </span>
            <button
              type="button"
              onClick={() => disconnect()}
              className="card-line rounded-full px-3 py-1.5 text-dim transition-colors hover:border-warn/60 hover:text-warn"
            >
              disconnect
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              disabled={!injected || connecting}
              onClick={() => injected && connect({ connector: injected })}
              className="card-line rounded-full px-4 py-1.5 text-ink transition-colors hover:border-signal/50 hover:bg-signal-soft disabled:opacity-40"
            >
              {connecting ? "connecting…" : "Connect the treasury wallet"}
            </button>
            {!injected && (
              <span className="text-faint">No injected wallet found in this browser.</span>
            )}
            {connectError && <span className="text-warn">{connectError.message}</span>}
          </>
        )}
      </div>

      {!isConnected && (
        <p className="text-[15px] text-dim">
          Nothing is shown until a wallet signs for it. The panel never holds a key: it
          reads what is owed and hands each transfer to your wallet to sign.
        </p>
      )}

      {onWrongChain && (
        <div className="mb-4 rounded-lg border border-warn/40 bg-warn/5 p-4">
          <p className="text-sm text-warn">
            This wallet is not on Robinhood Chain, so a transfer would go to the wrong
            network.
          </p>
          <button
            type="button"
            onClick={() => switchChain({ chainId: robinhoodChain.id })}
            className="card-line mt-3 rounded-full px-4 py-1.5 font-mono text-[12px] text-ink hover:border-signal/50"
          >
            Switch to Robinhood Chain
          </button>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-warn/30 bg-warn/5 p-4">
          <p className="text-sm font-medium text-warn">Could not load the sheet</p>
          <p className="mt-1 font-mono text-xs break-words text-dim">
            {error instanceof Error ? error.message : String(error)}
          </p>
        </div>
      )}

      {isConnected && isPending && !error && (
        <p className="font-mono text-[13px] text-faint">Signing and loading…</p>
      )}

      {sheet && (
        <>
          <div className="mb-5 flex flex-wrap items-center gap-x-6 gap-y-2 font-mono text-[13px] text-dim">
            <span>
              payable now{" "}
              <span className="text-warn tabular-nums">{formatUsdg(sheet.payable)} USDG</span>
            </span>
            {/* Why the payable figure is smaller than the column of amounts
                underneath it. Without this, a sheet where every row is blocked
                reads as a broken total rather than as a network that has not
                told us where to send anything. */}
            {blocked.noWallet > 0n && (
              <span className="text-faint tabular-nums">
                {formatUsdg(blocked.noWallet.toString())} held back, no wallet set
              </span>
            )}
            {blocked.sharedWallet > 0n && (
              <span className="text-faint tabular-nums">
                {formatUsdg(blocked.sharedWallet.toString())} held back, wallet claimed twice
              </span>
            )}
            <span className="text-faint">
              1/{sheet.rates.founding} on scores at the snapshot, 1/{sheet.rates.ongoing} after
            </span>
            {sheet.snapshotTaken ? (
              <span className="text-faint tabular-nums">
                snapshot held for {sheet.snapshotCount} agents
              </span>
            ) : (
              <button
                type="button"
                onClick={() => snapshot.mutate()}
                disabled={snapshot.isPending}
                className="card-line rounded-full px-3.5 py-1.5 text-[12px] text-ink hover:border-signal/50 disabled:opacity-40"
              >
                {snapshot.isPending ? "freezing…" : "Take the founding snapshot"}
              </button>
            )}
          </div>

          {/* Until a snapshot exists every agent is on the ongoing rate, which
              is not what was intended for the ones already here. Saying so is
              cheaper than an operator wondering why the totals look low. */}
          {!sheet.snapshotTaken && (
            <p className="mb-5 max-w-2xl text-[14px] leading-relaxed text-faint">
              No snapshot has been taken, so every agent is currently valued at 1/
              {sheet.rates.ongoing}. Taking it freezes today&rsquo;s scores at 1/
              {sheet.rates.founding} for the agents already here. It cannot be retaken.
            </p>
          )}

          {snapshot.error && (
            <p className="mb-4 font-mono text-[12px] text-warn">
              {snapshot.error instanceof Error ? snapshot.error.message : "Snapshot failed"}
            </p>
          )}

          {send.status === "sent" && (
            <p className="mb-4 font-mono text-[12px] text-signal">
              Paid @{send.handle}.{" "}
              <a
                href={`${robinhoodChain.blockExplorers.default.url}/tx/${send.hash}`}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                {send.hash.slice(0, 10)}…
              </a>{" "}
              Read back off the chain, so the row above is settled and the leaderboard
              shows it received.
            </p>
          )}
          {send.status === "failed" && (
            <p className="mb-4 font-mono text-[12px] break-words text-warn">
              @{send.handle}: {send.error}
            </p>
          )}

          <ul className="space-y-2">
            {sheet.rows.map((row) => (
              <Row
                key={row.agentId}
                row={row}
                onSend={transfer}
                busy={send.status !== "idle" && send.status !== "sent" && send.status !== "failed"}
                state={send.status !== "idle" && "handle" in send && send.handle === row.handle ? send.status : null}
              />
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
