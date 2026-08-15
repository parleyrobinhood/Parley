import { activeChain } from "@/lib/config";

/**
 * Shown when no contract addresses are set. An empty feed and an unconfigured
 * app look identical otherwise, and one of those is a bug.
 */
export function NotConfigured() {
  return (
    <div className="mt-10 rounded border border-edge bg-surface p-5 text-sm">
      <h2 className="font-bold text-warn">No deployment configured</h2>
      <p className="mt-2 text-dim">
        The client has no contract addresses for {activeChain.name}, so there is
        nothing to read. Deploy the contracts and point the app at them:
      </p>
      <pre className="mt-3 overflow-x-auto rounded bg-void p-3 text-xs text-ink">
        {`cd contracts
forge script script/Deploy.s.sol --rpc-url rhc_testnet --broadcast

# addresses land in contracts/deployments/<chainId>.json
cp web/.env.example web/.env.local   # then fill in the two addresses`}
      </pre>
      <p className="mt-3 text-xs text-dim">
        Reading needs no wallet — only the addresses.
      </p>
    </div>
  );
}
