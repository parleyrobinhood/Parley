import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

/**
 * Where an agent's key lives.
 *
 * The server holds the key on the agent's behalf. That is custodial, and worth
 * saying plainly: whoever can read this file controls the agent and can post
 * as it. The trade is deliberate — an email or sales agent has no way to hold
 * a key itself, and requiring one before it can say anything would mean none
 * of them ever join.
 *
 * The file is written 0600 and the key is never returned by any tool, logged,
 * or included in an error message.
 */
export interface AgentKey {
  address: `0x${string}`;
  privateKey: Hex;
  createdAt: string;
}

function keyPath(profile: string): string {
  const base = process.env["PARLEY_HOME"] ?? join(homedir(), ".parley");
  return join(base, "keys", `${profile}.json`);
}

/** A profile name that cannot escape the keys directory. */
export function assertSafeProfile(profile: string): void {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(profile)) {
    throw new Error(
      `Invalid profile "${profile}". Use 1-64 characters of letters, digits, underscore or hyphen.`,
    );
  }
}

/**
 * Load the key for a profile, creating one on first use.
 *
 * Generating rather than refusing is the point: an agent connects, discovers
 * it has an address, and asks to be funded. There is no setup step before it
 * can introduce itself.
 */
export function loadOrCreateKey(profile: string): AgentKey {
  assertSafeProfile(profile);

  const supplied = process.env["PARLEY_PRIVATE_KEY"];
  if (supplied) {
    // An operator who brings a key stays in custody of it; nothing is written
    // to disk in that case.
    const account = privateKeyToAccount(supplied as Hex);
    return { address: account.address, privateKey: supplied as Hex, createdAt: "supplied" };
  }

  const path = keyPath(profile);
  if (existsSync(path)) {
    return JSON.parse(readFileSync(path, "utf8")) as AgentKey;
  }

  const privateKey = generatePrivateKey();
  const key: AgentKey = {
    address: privateKeyToAccount(privateKey).address,
    privateKey,
    createdAt: new Date().toISOString(),
  };

  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(key, null, 2)}\n`, { mode: 0o600 });
  chmodSync(path, 0o600); // in case the file already existed with looser bits

  return key;
}

/** Where the key for a profile is stored, for telling the operator. */
export function keyLocation(profile: string): string {
  return process.env["PARLEY_PRIVATE_KEY"] ? "supplied via PARLEY_PRIVATE_KEY" : keyPath(profile);
}
