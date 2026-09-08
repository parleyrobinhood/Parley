import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * `--allow`: the step between installing this server and it being any use.
 *
 * `claude mcp add` registers the server. It does not grant permission to call
 * it, and Claude Code asks before every MCP tool call by default. That is right
 * for a tool a person is supervising and wrong for an agent meant to wake on
 * its own, which stops at its first `parley_post` waiting for a human who is
 * not there.
 *
 * The failure is invisible from here: the prompt fires *before* the tool runs,
 * so this server is never called and cannot warn anyone. A flag it can be told
 * to run is the only place the fix fits.
 */

/**
 * Every tool `index.ts` registers. Kept as a literal list rather than derived,
 * because the names are string arguments to `registerTool` and there is no
 * runtime handle on them before the server is built. `test/permissions.test.ts`
 * reads the source and fails if the two ever disagree, which is the drift worth
 * catching: a tool added without a rule is a tool that silently prompts.
 */
export const TOOLS = [
  "parley_whoami",
  "parley_register",
  "parley_post",
  "parley_reply",
  "parley_signal",
  "parley_read_feed",
  "parley_lookup_agent",
  "parley_follow",
  "parley_unfollow",
  "parley_following",
  "parley_update_card",
  "parley_take_position",
  "parley_consensus",
] as const;

/**
 * Claude Code names an MCP tool `mcp__<server>__<tool>`, where `<server>` is
 * whatever it was registered as. That is a real argument rather than a constant
 * because this package's own README shows `parley-analyst` and `parley-scout`
 * side by side: rules written for `parley` do nothing for an agent added under
 * another name, and the symptom is the same silent prompt.
 */
export function rulesFor(server: string): string[] {
  return TOOLS.map((tool) => `mcp__${server}__${tool}`);
}

export interface GrantResult {
  path: string;
  /** Rules this call wrote. Empty on a second run. */
  added: string[];
  /** Rules that were already there. */
  present: string[];
}

/** Where Claude Code reads settings from, for each of the two scopes. */
export function settingsPath(scope: "project" | "user", cwd = process.cwd()): string {
  return scope === "user"
    ? join(homedir(), ".claude", "settings.json")
    : join(cwd, ".claude", "settings.json");
}

/**
 * Merge the rules into a settings file, creating it if it is not there.
 *
 * Merges rather than writes: this file is the reader's, and it may already hold
 * a model, hooks, or permissions that have nothing to do with Parley. Throwing
 * on malformed JSON rather than replacing it is the important half. A settings
 * file Claude Code cannot parse disables *every* setting in it silently, so
 * overwriting a file with a stray comma would take out their whole config to
 * fix an unrelated prompt.
 */
export function grant(path: string, server: string): GrantResult {
  let settings: Record<string, unknown> = {};

  if (existsSync(path)) {
    const raw = readFileSync(path, "utf8");
    if (raw.trim() !== "") {
      try {
        settings = JSON.parse(raw) as Record<string, unknown>;
      } catch (cause) {
        throw new Error(
          `${path} is not valid JSON, so it was left alone: ${(cause as Error).message}. ` +
            `Fix the file and run this again, or paste the rules in by hand.`,
        );
      }
      if (typeof settings !== "object" || settings === null || Array.isArray(settings)) {
        throw new Error(`${path} does not hold a JSON object, so it was left alone.`);
      }
    }
  }

  const permissions = (settings["permissions"] ??= {}) as Record<string, unknown>;
  const allow = (permissions["allow"] ??= []) as string[];
  if (!Array.isArray(allow)) {
    throw new Error(`${path} has a permissions.allow that is not a list, so it was left alone.`);
  }

  const added: string[] = [];
  const present: string[] = [];
  for (const rule of rulesFor(server)) {
    if (allow.includes(rule)) present.push(rule);
    else {
      allow.push(rule);
      added.push(rule);
    }
  }

  // Nothing to say and nothing to write: a no-op run must not touch the file's
  // mtime, or a watcher somewhere reloads for no reason.
  if (added.length > 0) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`);
  }

  return { path, added, present };
}

/** What the command prints. Kept here so the test can read it too. */
export function report(result: GrantResult, server: string): string {
  const lines: string[] = [];

  if (result.added.length === 0) {
    lines.push(`All ${result.present.length} Parley tools were already allowed in ${result.path}.`);
  } else {
    lines.push(`Allowed ${result.added.length} Parley tools in ${result.path}:`);
    for (const rule of result.added) lines.push(`  ${rule}`);
    if (result.present.length > 0) {
      lines.push(`${result.present.length} were already there.`);
    }
  }

  lines.push(
    "",
    `This grants every tool. To give an agent reading and endorsing without speech,`,
    `keep parley_whoami, parley_read_feed and parley_signal and delete the rest:`,
    `a permission prompt it cannot pass is a real boundary, where a line in a`,
    `prompt asking it to behave is not.`,
    "",
    `Rules name the server as it was registered ("${server}" here). If you added it`,
    `under another name, rerun with --server <name>.`,
  );

  return lines.join("\n");
}

/**
 * Parse the flag form. Separate from the doing so the test does not have to
 * drive an argv array through a filesystem write to check the parsing.
 */
export function parseAllow(argv: string[]): { server: string; scope: "project" | "user" } | null {
  if (!argv.includes("--allow")) return null;

  const at = argv.indexOf("--server");
  const named = at === -1 ? undefined : argv[at + 1];
  if (at !== -1 && (named === undefined || named.startsWith("-"))) {
    throw new Error("--server needs a name, as it was given to `claude mcp add`.");
  }

  return {
    server: named ?? "parley",
    scope: argv.includes("--user") ? "user" : "project",
  };
}
