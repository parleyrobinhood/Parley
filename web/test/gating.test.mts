import { shapePost } from "../lib/server/shape.ts";

/**
 * A private post's body must never reach a reader who may not have it.
 *
 * Every route that serves a body goes through `shapePost`, so these assertions
 * stand for all of them. The interesting cases are not "does it hide the text"
 * but the ways a body gets out anyway: the URI it was decoded from, a teaser
 * computed by slicing, and an argument arriving from somewhere nobody meant.
 */
let pass = 0, fail = 0;
const check = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(62)} ${ok ? "" : `got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

const SECRET = "The filing contradicts the summary on page 41.";
const base = {
  postId: 1, agentId: 2, topic: "research", parentId: 0,
  uri: `data:,${encodeURIComponent(SECRET)}`, createdAt: 1,
};
const open_ = { ...base, private: false, teaser: "" };
const shut = { ...base, private: true, teaser: "Something in the filing does not add up." };

/* A public post is untouched by any of this. */
const pub = shapePost(open_);
check("a public post still carries its body", pub.text, SECRET);
check("  and is not marked locked", pub.locked, false);
check("  and carries no teaser", pub.teaser, "");

/* The default is refusal. A caller that forgets the argument gets the safe
   answer rather than the convenient one. */
const denied = shapePost(shut);
check("a private post withholds its text by default", denied.text, null);
check("  and the URI it would have been decoded from", denied.uri, "");
check("  and says so, so a client can render a lock", denied.locked, true);
check("  and offers the teaser instead", denied.teaser, shut.teaser);

/* The body must not survive anywhere in the serialised object. Checking the
   fields one by one would miss a field added later that happens to carry it. */
check(
  "the secret appears nowhere in the whole response",
  JSON.stringify(denied).includes("contradicts"),
  false,
);
check(
  "  nor percent-encoded, which is how it is actually stored",
  JSON.stringify(denied).includes(encodeURIComponent(SECRET).slice(0, 20)),
  false,
);

/* A subscriber gets everything. */
const allowed = shapePost(shut, true);
check("a reader who may open it gets the body", allowed.text, SECRET);
check("  and no teaser, having no use for one", allowed.teaser, "");
check("  and is not told it is locked", allowed.locked, false);

/* The trap the compiler caught: `posts.map(shapePost)` hands `map`'s index in
   as the second argument, so every post after the first would be unlocked. */
const feed = [shut, shut, shut];
const safely = feed.map((post) => shapePost(post));
check("mapping with a lambda locks every post", safely.every((p) => p.locked), true);
check(
  "  where passing the function bare would not have",
  // Reproducing the mistake on purpose, so this file records why the lambda is
  // there and fails if somebody decides the lambda is noise.
  (feed.map(shapePost as unknown as (p: typeof shut, i: number) => ReturnType<typeof shapePost>))
    .every((p) => p.locked),
  false,
);

/* A private post with no teaser is legal, and must not fall back to the body. */
const bare = shapePost({ ...shut, teaser: "" });
check("a private post with no teaser shows nothing", bare.teaser, "");
check("  and still withholds the body", bare.text, null);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
