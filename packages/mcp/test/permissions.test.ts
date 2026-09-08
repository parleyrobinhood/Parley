import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { grant, parseAllow, report, rulesFor, settingsPath, TOOLS } from "../dist/permissions.js";

let pass = 0, fail = 0;
const check = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(52)} ${ok ? "" : `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

const box = () => {
  const dir = mkdtempSync(join(tmpdir(), "parley-allow-"));
  return { dir, path: join(dir, ".claude", "settings.json") };
};
const read = (p: string) => JSON.parse(readFileSync(p, "utf8")) as Record<string, any>;

/* -------- the list must match what the server actually registers ---------- */
{
  // A tool added without a rule is a tool that silently prompts, which is the
  // exact failure this flag exists to remove. So the list is checked against
  // the source rather than trusted.
  const source = readFileSync(
    fileURLToPath(new URL("../src/index.ts", import.meta.url)),
    "utf8",
  );
  const registered = [...source.matchAll(/registerTool\(\s*"([a-z_]+)"/g)].map((m) => m[1]).sort();
  check("every registered tool has a rule", registered, [...TOOLS].sort());
  check("and the server registers some", registered.length > 0, true);
}

/* ----------------------------- a fresh machine ---------------------------- */
{
  const { path } = box();
  const result = grant(path, "parley");
  check("creates the file", existsSync(path), true);
  check("writes every rule", result.added.length, TOOLS.length);
  check("nothing was already present", result.present, []);
  check("the rules land under permissions.allow", read(path).permissions.allow, rulesFor("parley"));
  check("and the file ends in a newline", readFileSync(path, "utf8").endsWith("\n"), true);
}

/* ------------------------------- run it twice ----------------------------- */
{
  const { path } = box();
  grant(path, "parley");
  const before = readFileSync(path, "utf8");
  const second = grant(path, "parley");
  check("a second run adds nothing", second.added, []);
  check("and reports them present", second.present.length, TOOLS.length);
  check("the file is byte-identical", readFileSync(path, "utf8"), before);
}

/* --------------------- somebody else's settings survive ------------------- */
{
  const { dir, path } = box();
  mkdirSync(join(dir, ".claude"), { recursive: true });
  writeFileSync(path, JSON.stringify({
    model: "opus",
    hooks: { Stop: [{ hooks: [{ type: "command", command: "echo done" }] }] },
    permissions: { allow: ["Bash(git *)"], deny: ["Bash(rm -rf *)"] },
  }, null, 2));

  grant(path, "parley");
  const after = read(path);
  check("an unrelated key survives", after.model, "opus");
  check("hooks survive", after.hooks.Stop[0].hooks[0].command, "echo done");
  check("deny survives", after.permissions.deny, ["Bash(rm -rf *)"]);
  check("an existing allow rule survives, and stays first", after.permissions.allow[0], "Bash(git *)");
  check("alongside all of ours", after.permissions.allow.length, TOOLS.length + 1);
}

/* ------------------- a broken file is never overwritten ------------------- */
{
  const { dir, path } = box();
  mkdirSync(join(dir, ".claude"), { recursive: true });
  const broken = '{ "permissions": { "allow": ["Bash(git *)"], } }';
  writeFileSync(path, broken);

  let message = "";
  try { grant(path, "parley"); } catch (cause) { message = (cause as Error).message; }
  check("malformed JSON throws", message.includes("not valid JSON"), true);
  // The important half: Claude Code silently ignores every setting in a file it
  // cannot parse, so replacing one to fix a prompt would cost the whole config.
  check("and the file is untouched", readFileSync(path, "utf8"), broken);

  writeFileSync(path, JSON.stringify({ permissions: { allow: "everything" } }));
  message = "";
  try { grant(path, "parley"); } catch (cause) { message = (cause as Error).message; }
  check("an allow that is not a list throws", message.includes("not a list"), true);
}

/* ---------------------- the server name is not assumed -------------------- */
{
  // The package README shows parley-analyst and parley-scout side by side.
  // Rules written for "parley" do nothing for those, and the symptom is the
  // same silent prompt this flag exists to remove.
  const { path } = box();
  grant(path, "parley-analyst");
  check("rules carry the registered name", read(path).permissions.allow[0], "mcp__parley-analyst__parley_whoami");
}

/* --------------------------------- parsing -------------------------------- */
{
  check("no --allow is not this command", parseAllow(["--user"]), null);
  check("bare --allow is project scope", parseAllow(["--allow"]), { server: "parley", scope: "project" });
  check("--user switches scope", parseAllow(["--allow", "--user"])?.scope, "user");
  check("--server names it", parseAllow(["--allow", "--server", "scout"])?.server, "scout");

  let message = "";
  try { parseAllow(["--allow", "--server"]); } catch (cause) { message = (cause as Error).message; }
  check("--server with no name is refused", message.includes("needs a name"), true);
  message = "";
  try { parseAllow(["--allow", "--server", "--user"]); } catch (cause) { message = (cause as Error).message; }
  check("and does not swallow the next flag", message.includes("needs a name"), true);

  check("user scope is the home directory", settingsPath("user").includes(".claude"), true);
  check("project scope is relative to cwd", settingsPath("project", "/tmp/x"), "/tmp/x/.claude/settings.json");
}

/* --------------------------------- output --------------------------------- */
{
  const { path } = box();
  const first = report(grant(path, "parley"), "parley");
  check("the report names the file", first.includes(path), true);
  check("and says how to narrow it", first.includes("without speech"), true);
  const second = report(grant(path, "parley"), "parley");
  check("a second run says so", second.includes("already allowed"), true);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
