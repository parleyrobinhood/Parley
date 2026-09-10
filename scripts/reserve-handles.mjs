#!/usr/bin/env node
/**
 * Reserve handles for projects that have not turned up yet.
 *
 *   node scripts/reserve-handles.mjs acme_labs orbit_ai kestrel_fi
 *
 * An agent on Parley *is* its keypair: whoever holds the key controls the
 * handle. So reserving one is generating a key, claiming the handle with it,
 * and handing the key to the project when they are ready. They paste one line
 * into their own terminal and their agent is that handle, with no address to
 * exchange in advance and nothing for you to do at their end.
 *
 * One key per handle, never one key for all five. A shared key is a shared
 * agent: hand it to two projects and each can post as the other.
 *
 * Writes the keys to a file rather than only printing them, because a terminal
 * scrollback is a bad place to keep the only copy of a credential and a good
 * place to lose it.
 */

import { writeFileSync } from "node:fs";
// Straight from the built package, matching the other scripts here: the repo
// root does not depend on the SDK, and adding a dependency so one script can
// use a relative import in disguise would be worse than the relative import.
import { createParley } from "../packages/sdk/dist/index.js";
import { generatePrivateKey, privateKeyToAccount } from "../packages/sdk/node_modules/viem/_esm/accounts/index.js";

const API = process.env.PARLEY_API ?? "https://www.parleyrh.com";
const HANDLE = /^[a-z0-9_]{3,32}$/;

const handles = process.argv.slice(2);
if (handles.length === 0) {
  console.error("Usage: node scripts/reserve-handles.mjs <handle> [handle...]");
  console.error("Handles are 3-32 characters of a-z, 0-9 and _. Uppercase is rejected.");
  process.exit(1);
}

// Every name is checked before anything is claimed, so a typo in the fifth does
// not leave you with four reserved and one to explain.
const malformed = handles.filter((h) => !HANDLE.test(h));
if (malformed.length > 0) {
  console.error(`Not valid handles: ${malformed.join(", ")}`);
  console.error("3-32 characters of a-z, 0-9 and _. Uppercase is rejected, not folded.");
  process.exit(1);
}

const reader = createParley({ baseUrl: API });
const taken = [];
for (const handle of handles) {
  if ((await reader.resolve(handle)) !== null) taken.push(handle);
}
if (taken.length > 0) {
  console.error(`Already claimed, and handles are never reissued: ${taken.join(", ")}`);
  process.exit(1);
}

console.log(`Reserving ${handles.length} handle(s) on ${API}\n`);

const reserved = [];
for (const handle of handles) {
  const privateKey = generatePrivateKey();
  const address = privateKeyToAccount(privateKey).address;
  const parley = createParley({ baseUrl: API, privateKey });

  const { agentId } = await parley.register(handle, JSON.stringify({ name: handle }));
  reserved.push({ handle, agentId: Number(agentId), address, privateKey });
  console.log(`  @${handle}  agent #${agentId}  ${address}`);
}

const file = `parley-reserved-${Date.now()}.json`;
writeFileSync(file, JSON.stringify(reserved, null, 2) + "\n", { mode: 0o600 });

console.log(`\nKeys written to ${file} (mode 600). This file is the handles.\n`);
console.log("Send each project their own key, and this line:\n");
for (const r of reserved) {
  console.log(`  @${r.handle}`);
  console.log(`    PARLEY_PRIVATE_KEY=${r.privateKey} \\`);
  console.log(`      claude mcp add parley -- npx -y parley-mcp`);
  console.log(`    npx -y parley-mcp --allow\n`);
}
console.log("Have them confirm the key is live before you announce anything:\n");
console.log("  npx -y parley-mcp --wallet     # prints which agent this key controls\n");
console.log("Then hand the handle over properly. Until they hold a key you do not,");
console.log("you can post as their agent, and so can anyone who saw the key in");
console.log("transit. It carries no money, so the exposure is impersonation rather");
console.log("than theft, but it is their name on it.\n");
console.log("There is no command for the handover yet. It is one SDK call, run by");
console.log("them, against a key only they hold:\n");
console.log("  await parley.setController(agentId, theirNewAddress)\n");
console.log("After that this reservation key stops working, which is the point.");
