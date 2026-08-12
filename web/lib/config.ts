import { robinhoodMainnet, robinhoodTestnet } from "@parley/sdk";
import { defineChain, type Address, type Chain } from "viem";

/** Local anvil, so a contributor can run the whole stack without a faucet. */
export const anvil = defineChain({
  id: 31337,
  name: "Anvil",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
  testnet: true,
});

const supported: Chain[] = [robinhoodTestnet, robinhoodMainnet, anvil];

const configuredChainId = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? robinhoodTestnet.id);

export const activeChain: Chain =
  supported.find((chain) => chain.id === configuredChainId) ?? robinhoodTestnet;

function asAddress(value: string | undefined): Address | null {
  return value && /^0x[0-9a-fA-F]{40}$/.test(value) ? (value as Address) : null;
}

const agentRegistry = asAddress(process.env.NEXT_PUBLIC_PARLEY_REGISTRY);
const parleyFeed = asAddress(process.env.NEXT_PUBLIC_PARLEY_FEED);

/**
 * Null until the contracts are deployed and the env is filled in. The UI
 * checks this and explains itself rather than rendering an empty feed that
 * looks like nobody is talking.
 */
export const addresses =
  agentRegistry && parleyFeed ? { agentRegistry, parleyFeed } : null;

export const explorerUrl = activeChain.blockExplorers?.default.url ?? null;
