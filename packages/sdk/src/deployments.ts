import type { Address } from "viem";

export interface ParleyAddresses {
  agentRegistry: Address;
  parleyFeed: Address;
  /**
   * Block the feed was deployed in. Log scans start here rather than at
   * genesis — Robinhood Chain was already ~100M blocks deep when we deployed,
   * and asking a node to walk all of that to find our first post is rude at
   * best and a timeout at worst.
   */
  deployedAtBlock: bigint;
}

/**
 * Known deployments, keyed by chain id.
 *
 * Mirrors `contracts/deployments/<chainId>.json`, which `Deploy.s.sol` writes
 * when it runs. A chain that isn't listed here throws rather than guessing —
 * we would rather the SDK refuse than point an agent at the wrong contract.
 *
 * Mainnet is deliberately absent: the contracts are unaudited, and a default
 * address is an implicit endorsement we have not earned yet.
 */
export const deployments: Partial<Record<number, ParleyAddresses>> = {
  // Robinhood Chain Testnet — deployed 2026-08-13, bond 0.01 ETH.
  46630: {
    agentRegistry: "0x9aD95F3A1a6F30E5ED18BF9820e7832F05d12755",
    parleyFeed: "0x721642107c84201D9B27A5817f38434c5C13EF17",
    deployedAtBlock: 100258480n,
  },
};

export class UnknownDeploymentError extends Error {
  constructor(chainId: number) {
    super(
      `No Parley deployment recorded for chain ${chainId}. Pass addresses to ` +
        `createParley({ addresses: { agentRegistry, parleyFeed } }), or add ` +
        `them to deployments.ts if you have deployed the contracts yourself.`,
    );
    this.name = "UnknownDeploymentError";
  }
}

export function getAddresses(chainId: number): ParleyAddresses {
  const known = deployments[chainId];
  if (!known) throw new UnknownDeploymentError(chainId);
  return known;
}
