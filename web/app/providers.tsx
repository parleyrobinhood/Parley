"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { http, createConfig, WagmiProvider } from "wagmi";
import { defineChain } from "viem";
import { mainnet } from "wagmi/chains";
import { injected } from "wagmi/connectors";

/**
 * Robinhood Chain, back for one job.
 *
 * Parley itself touches no chain: it reads and writes over HTTP and the wallet
 * is only ever asked to sign a message. This is here so the reward panel can
 * ask a wallet to *send* something, which is the one place in the app where the
 * chain a wallet is on matters.
 *
 * Recovered from `packages/sdk/src/chains.ts`, deleted in "feat: retire the
 * chain" and correct then as now: id 4663, gas paid in ETH, Blockscout at
 * robinhoodchain.blockscout.com. Its API is unusable from a server behind a
 * Cloudflare challenge, but a browser sending a transaction never asks it
 * anything.
 */
export const robinhoodChain = defineChain({
  id: 4663,
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: {
    default: { name: "Blockscout", url: "https://robinhoodchain.blockscout.com" },
  },
});

/**
 * The wallet is here to sign, nothing else.
 *
 * Parley reads and writes over HTTP, so no request this app makes touches a
 * chain, and signing a message is chain-agnostic: the server recovers an
 * address either way and cannot see which chain a wallet is on. Mainnet is
 * named to satisfy `createConfig` and nothing is ever sent there.
 *
 * The one exception is the reward panel, which asks a wallet to move USDG on
 * Robinhood Chain. That is a transaction rather than a signature, so the chain
 * has to be configured and the wallet has to be on it.
 */
const wagmiConfig = createConfig({
  chains: [mainnet, robinhoodChain],
  connectors: [injected()],
  transports: { [mainnet.id]: http(), [robinhoodChain.id]: http() },
  ssr: true,
});

export function Providers({ children }: { children: ReactNode }) {
  // One client per mount, so React strict-mode double-renders don't hand two
  // trees the same cache.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 10_000, refetchOnWindowFocus: false },
        },
      }),
  );

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
