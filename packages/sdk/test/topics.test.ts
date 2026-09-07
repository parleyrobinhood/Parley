import { normaliseTopic, TOPIC_PATTERN } from "../dist/topics.js";

let pass = 0, fail = 0;
const check = (name: string, got: unknown, want: unknown) => {
  const ok = got === want;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(46)} ${ok ? "" : `got=${got} want=${want}`}`);
  ok ? pass++ : fail++;
};

// already canonical
check("a plain topic is left alone", normaliseTopic("rwa"), "rwa");
check("digits and underscore survive", normaliseTopic("gpt_5"), "gpt_5");
check("31 characters is the ceiling", normaliseTopic("a".repeat(31)), "a".repeat(31));
check("32 is one too many", normaliseTopic("a".repeat(32)), null);

// the case that reached production
check("a leading hash is folded", normaliseTopic("#research"), "research");
check("several hashes too", normaliseTopic("###research"), "research");
check("hash and space together", normaliseTopic(" # research "), "research");

// what encodeTopic used to do before the chain was dropped
check("case is folded", normaliseTopic("RWA"), "rwa");
check("mixed case is folded", normaliseTopic("SixthDecimal"), "sixthdecimal");
check("surrounding space is trimmed", normaliseTopic("  markets  "), "markets");

// smuggling a second encoding of one topic
check("zero-width is stripped", normaliseTopic("rw​a"), "rwa");
check("a fullwidth lookalike folds", normaliseTopic("ＲＷＡ"), "rwa");

// not guessed at
check("an inner space is refused", normaliseTopic("ai safety"), null);
check("a hyphen is refused", normaliseTopic("ai-safety"), null);
check("punctuation is refused", normaliseTopic("rwa!"), null);
check("an inner hash is refused", normaliseTopic("rw#a"), null);
check("nothing at all is refused", normaliseTopic(""), null);
check("only a hash is refused", normaliseTopic("#"), null);
check("only space is refused", normaliseTopic("   "), null);

// idempotence: the store and the route both fold, and folding twice must not drift
for (const raw of ["#Research", "rwa", "  #NEWS ", "ai-safety"]) {
  const once = normaliseTopic(raw);
  const twice = once === null ? null : normaliseTopic(once);
  check(`folding "${raw}" twice changes nothing`, twice, once);
}

// the pattern is the shared rule, not a second copy of it
check("the pattern accepts a folded topic", TOPIC_PATTERN.test(normaliseTopic("#RWA")!), true);
check("the pattern rejects an unfolded one", TOPIC_PATTERN.test("#rwa"), false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
