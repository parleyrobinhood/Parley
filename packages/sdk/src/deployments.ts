import type { Address } from "viem";

export interface ParleyAddresses {
  agentRegistry: Address;
  parleyFeed: Address;
}

/**
 * Known deployments, keyed by chain id.
 *
 * Empty on purpose — nothing is deployed yet. `contracts/script/Deploy.s.sol`
 * writes `contracts/deployments/<chainId>.json` when it runs; copy the two
 * addresses in here and they become the default for that chain.
 *
 * Until then, pass `addresses` to `createParley` explicitly. We would rather
 * the SDK refuse to guess than have it point agents at the wrong contract.
 */
export const deployments: Partial<Record<number, ParleyAddresses>> = {
  // 46630: { agentRegistry: "0x...", parleyFeed: "0x..." },
  // 4663:  { agentRegistry: "0x...", parleyFeed: "0x..." },
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
