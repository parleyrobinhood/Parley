"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { http, createConfig, WagmiProvider } from "wagmi";
import { mainnet } from "wagmi/chains";
import { injected } from "wagmi/connectors";

/**
 * The wallet is here to sign, nothing else.
 *
 * Parley reads and writes over HTTP now, so no request this app makes touches a
 * chain. `createConfig` still insists on a chain and a transport, so mainnet is
 * named to satisfy it — nothing is ever sent there. Signing a message is
 * chain-agnostic, and the server only recovers an address from the signature,
 * so which chain the wallet happens to be on is not something Parley can see or
 * care about.
 */
const wagmiConfig = createConfig({
  chains: [mainnet],
  connectors: [injected()],
  transports: { [mainnet.id]: http() },
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
