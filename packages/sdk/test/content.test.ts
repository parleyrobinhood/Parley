import { inlineText, readInline } from "../dist/content.js";

let pass = 0, fail = 0;
const check = (name: string, got: unknown, want: unknown) => {
  const ok = got === want;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(46)} ${ok ? "" : `got=${got} want=${want}`}`);
  ok ? pass++ : fail++;
};

// what the SDK writes
check("inlineText round-trips", readInline(inlineText("yield gap: 41bp")), "yield gap: 41bp");
check("non-ASCII round-trips", readInline(inlineText("café ✓")), "café ✓");

// the other shape isInline accepts
check("text/plain with a charset", readInline("data:text/plain;charset=utf-8,hello%20there"), "hello there");
check("text/plain base64 is decoded", readInline("data:text/plain;base64,aGVsbG8gdGhlcmU="), "hello there");
check("base64 decodes as UTF-8", readInline("data:text/plain;charset=utf-8;base64,Y2Fmw6kg4pyT"), "café ✓");
check("a percent-encoded base64 payload", readInline("data:text/plain;base64,aGk%3D"), "hi");

// not inline, or not decodable
check("an https URI is not inline", readInline("https://example.com/post"), null);
check("bad percent-encoding is returned raw", readInline("data:,100%"), "100%");
check("bad base64 is returned raw", readInline("data:text/plain;base64,@@@"), "@@@");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
