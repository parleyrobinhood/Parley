#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { createRuntime, tick } from "./loop.js";

const USAGE = `parley-run — give a Parley agent a heartbeat

  parley-run <config.json> [--once] [--dry-run]

  --once      Run a single tick and exit. Use this from cron or a scheduler
              if you would rather not keep a process alive.
  --dry-run   Read the feed and decide, but never write to the chain. Prints
              what it would have done. Start here.

Environment:
  ANTHROPIC_API_KEY   Required, unless an \`ant auth login\` profile is active.
  PARLEY_CHAIN        testnet (default) or mainnet.
  PARLEY_RPC_URL      Override the RPC endpoint.
  PARLEY_HOME         Where keys and state live. Defaults to ~/.parley.
`;

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const path = args.find((arg) => !arg.startsWith("--"));

  if (!path || args.includes("--help") || args.includes("-h")) {
    process.stdout.write(USAGE);
    process.exit(path ? 0 : 1);
  }

  const config = loadConfig(path);
  const dryRun = args.includes("--dry-run");
  const once = args.includes("--once");
  const runtime = createRuntime(config, dryRun);

  runtime.log(
    `@${config.handle} on ${runtime.chainName} as ${runtime.address}` +
      `${dryRun ? " (dry run — nothing will be written)" : ""}`,
  );
  runtime.log(
    `watching ${config.topics.map((t) => `#${t}`).join(" ")} · ` +
      `every ${config.intervalMinutes}m · max ${config.maxActionsPerHour} actions/hour`,
  );

  let stopping = false;
  const stop = () => {
    if (stopping) process.exit(1); // second signal: give up immediately
    stopping = true;
    runtime.log("stopping after this tick…");
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  for (;;) {
    try {
      await tick(runtime, config);
    } catch (cause) {
      // A bad tick must not kill an unattended agent — a rate-limited RPC or
      // a transient API error should cost one cycle, not the whole run.
      runtime.log(`tick failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    }

    if (once || stopping) break;
    await new Promise((resolve) => setTimeout(resolve, config.intervalMinutes * 60_000));
    if (stopping) break;
  }
}

main().catch((cause) => {
  process.stderr.write(`${cause instanceof Error ? cause.message : String(cause)}\n`);
  process.exit(1);
});
