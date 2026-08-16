import { signRequest, verifyRequest, canonicalMessage, HEADERS, MAX_SKEW_MS } from "../dist/auth.js";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const KEY = generatePrivateKey();
const ME = privateKeyToAccount(KEY).address;
const OTHER = generatePrivateKey();

const fresh = () => { const seen = new Set<string>(); return (n: string, a: string) => { const k = a+":"+n; if (seen.has(k)) return true; seen.add(k); return false; }; };
const req = { method: "POST", path: "/api/posts", body: JSON.stringify({ text: "hello" }) };
let pass = 0, fail = 0;
const check = (name: string, got: unknown, want: unknown) => {
  const ok = got === want;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(46)} ${ok ? "" : `got=${got} want=${want}`}`);
  ok ? pass++ : fail++;
};

// happy path
let h = await signRequest(KEY, req);
let r = await verifyRequest(h, req, fresh());
check("valid request verifies", r.ok, true);
if (r.ok) check("  recovers the signer's address", r.address.toLowerCase(), ME.toLowerCase());

// replay
const seen = fresh();
h = await signRequest(KEY, req);
await verifyRequest(h, req, seen);
r = await verifyRequest(h, req, seen);
check("same nonce twice is rejected", r.ok ? "ok" : r.reason, "replayed");

// tampering
h = await signRequest(KEY, req);
r = await verifyRequest(h, { ...req, body: JSON.stringify({ text: "goodbye" }) }, fresh());
check("body swap breaks it", r.ok ? "ok" : r.reason, "address-mismatch");
r = await verifyRequest(h, { ...req, path: "/api/agents/retire" }, fresh());
check("path swap breaks it", r.ok ? "ok" : r.reason, "address-mismatch");
r = await verifyRequest(h, { ...req, method: "DELETE" }, fresh());
check("method swap breaks it", r.ok ? "ok" : r.reason, "address-mismatch");

// impersonation
h = await signRequest(OTHER, req);
r = await verifyRequest({ ...h, [HEADERS.address]: ME }, req, fresh());
check("claiming another address is rejected", r.ok ? "ok" : r.reason, "address-mismatch");

// clock
h = await signRequest(KEY, req, Date.now() - MAX_SKEW_MS - 1000);
r = await verifyRequest(h, req, fresh());
check("stale signature expires", r.ok ? "ok" : r.reason, "expired");
h = await signRequest(KEY, req, Date.now() + MAX_SKEW_MS + 1000);
r = await verifyRequest(h, req, fresh());
check("future-dated signature rejected", r.ok ? "ok" : r.reason, "expired");
h = await signRequest(KEY, req, Date.now() - MAX_SKEW_MS + 5000);
r = await verifyRequest(h, req, fresh());
check("just inside the window still works", r.ok, true);

// malformed
r = await verifyRequest({}, req, fresh());
check("no headers", r.ok ? "ok" : r.reason, "missing-headers");
h = await signRequest(KEY, req);
r = await verifyRequest({ ...h, [HEADERS.timestamp]: "not-a-number" }, req, fresh());
check("non-numeric timestamp", r.ok ? "ok" : r.reason, "bad-timestamp");
r = await verifyRequest({ ...h, [HEADERS.signature]: "0xdeadbeef" }, req, fresh());
check("garbage signature", r.ok ? "ok" : r.reason, "bad-signature");
r = await verifyRequest({ ...h, [HEADERS.signature]: "" }, req, fresh());
check("empty signature", r.ok ? "ok" : r.reason, "missing-headers");

// nonce store is only consulted for otherwise-valid requests
let asked = 0;
await verifyRequest({ ...h, [HEADERS.signature]: "0xdeadbeef" }, req, () => { asked++; return false; });
check("invalid sig never touches nonce store", asked, 0);

// canonical message determinism
const a = canonicalMessage({ method: "post", path: "/x", timestamp: 1, nonce: "n", body: "b" });
const b = canonicalMessage({ method: "POST", path: "/x", timestamp: 1, nonce: "n", body: "b" });
check("method case is normalised", a, b);
check("message is version-prefixed", a.startsWith("parley-auth-v1\n"), true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
