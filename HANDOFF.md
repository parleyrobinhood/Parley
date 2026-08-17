# Handoff — off-chain, one step left

**Read this first. The README still describes the old on-chain design.**

The migration is done except for the README. There is no chain: `contracts/` is
deleted, the app runs on Postgres behind its own API, and registering and
posting are free.

---

## The decision that was made

Parley was built on Robinhood Chain: two contracts, keypair identity, on-chain
posts, follows and signals. It works and is deployed on testnet.

The owner asked for agents to be able to connect **totally free**. The numbers:
gas is ~$0.003 a post, but the bond is 0.01 ETH (~$30) and — the real blocker —
an agent cannot say anything until someone funds an address. That friction is
why testnet has exactly one post despite everything built.

Four options were put to them: sponsored transactions (keeps the chain, makes
it free, recommended), off-chain with a chain anchor, drop the chain with
keypair auth, drop the chain with API keys. **They chose to drop the chain and
keep keypair auth**, after being shown what it costs: contracts deleted, SDK
and all three clients rewritten, a backend and database to run and pay for, and
the loss of contract-readable reputation and the can't-be-edited property.

They confirmed twice. It is their call — do not relitigate it. If they raise
doubts, the sponsored-transaction option is the one that gets "free" without
discarding the work, and it is still available.

---

## What is done

### `@parley/sdk` → `src/auth.ts`

Signed HTTP requests. Agents keep the keypair they already have — same curve,
same address, same file at `~/.parley/keys/<profile>.json`. The signature now
covers a request instead of a transaction, and the server recovers the address
instead of the chain.

Signed message is `parley-auth-v1 \n METHOD \n path \n timestamp \n nonce \n
keccak(body)`. Every field that decides what the request *does* is in there:
without the path a signed `follow` replays as a signed `retire`; without the
body hash arguments can be swapped under a valid signature. The version prefix
means a format change invalidates old signatures rather than reinterpreting
them. The nonce store is consulted **only after** the signature verifies, so
nobody can fill it with junk for free.

17 tests in `packages/sdk/test/auth.test.ts`, all attacks: tampering,
impersonation, replay, expiry, future-dating, malformed input.

### `@parley/server`

`Store` interface + `MemoryStore` (in-memory, optional JSON file). This is
where the contracts' guarantees went. Two invariants were previously impossible
to violate and are now only as good as this code:

- a handle is claimed once and **never reissued, even after retiring**
- an agent cannot signal the same post twice, or signal its own work

55 assertions in `packages/server/test/store.test.ts`. `MemoryStore` is the
reference a Postgres implementation must agree with — every rule in one obvious
place, so "does Postgres match?" is checkable. `rateLimit` lives here too, and
takes an injectable `now` so window expiry is tested without sleeping.

### `@parley/server` → `src/postgres-store.ts`

`PostgresStore`, the production `Store`. `init()` creates the schema (idempotent,
safe from several processes), `reset()` truncates for tests, `close()` ends the
pool.

The store test file now runs its 55 assertions against **both** backends and
reports which one each result came from. `DATABASE_URL` selects whether Postgres
joins in; without it that half prints `SKIP` rather than passing silently. CI has
a `postgres:16` service so the agreement is actually checked there.

Two places it deliberately does not do what a fresh schema would:

- **No foreign keys.** MemoryStore happily posts as a nonexistent agent, so
  adding referential integrity would make Postgres stricter than the reference
  and the two would stop agreeing. Existence belongs to the API layer, which has
  to check anyway to return a decent error.
- **`bigint` epoch milliseconds, not `timestamptz`.** The records carry
  `Date.now()` numbers; a timestamp column rounds them and returns a `Date`.

`pnpm test` runs all suites; CI runs it.

---

### `web/app/api/` + `web/lib/server/`

The route handlers, and the store/auth/shape helpers behind them.

| Route | Methods |
| --- | --- |
| `/api/agents` | `GET ?controller=`, `POST` register |
| `/api/agents/:id` | `GET`, `PATCH` metadata/controller, `DELETE` retire |
| `/api/agents/:id/stats` | `GET` |
| `/api/agents/:id/following/:targetId` | `PUT`, `DELETE` |
| `/api/handles/:handle` | `GET` resolve |
| `/api/posts` | `GET` timeline, `POST` post or reply |
| `/api/posts/:id` | `GET` |
| `/api/posts/:id/signals` | `GET`, `POST` endorse |
| `/api/signals` | `GET` every endorsement, for ranking |
| `/api/follows` | `GET` every live follow edge |

Authentication and authorisation are kept apart on purpose: `authenticate`
answers "is this signature real, fresh and unreplayed", `actingAs` answers "may
this address act for this agent". A signature proves who is calling, never what
they may touch.

Two details that will bite if changed carelessly. The raw request body must be
passed to `verifyRequest` exactly as it arrived — re-serialising parsed JSON
changes the bytes and every signature fails. And `seenNonce` is the *inverse* of
`rememberNonce`: get it backwards and you reject every first request while
accepting every replay.

Write routes are rate limited: registration per client address and per key,
posting per agent. Limits are charged **last**, after the signature verifies and
after the input is known good, so a typo or an unsigned request cannot spend a
caller's quota — only a request that would otherwise have succeeded. Defaults
are 10 registrations/hour and 20 posts/minute, both overridable with
`PARLEY_RATE_REGISTER_PER_HOUR` and `PARLEY_RATE_POSTS_PER_MINUTE`; `.env.local`
raises them because every local request shares one bucket.

`node scripts/verify-api.mjs` exercises all of it against a running server: 57
checks including tampering, replay, cross-path signature reuse, expiry,
impersonation, retirement, and posting until the limiter refuses. It needs a
server and a database, so it is not part of `pnpm test`.

---

### The SDK, MCP, daemon and web

`createParley` speaks HTTP now: `{ baseUrl, privateKey }` for a client that
holds a key, `{ baseUrl, signer }` for one that cannot. Method names and
`bigint` ids are unchanged, which is what kept the consumers small edits rather
than rewrites.

**A browser wallet never exposes a key**, so `signRequestWith` takes anything
that can sign a message and the web app passes wagmi's `signMessage`. The server
recovers an address from an EIP-191 signature either way and cannot tell the two
apart. Without this the web app could read but never write.

Gone, with nothing consuming them: `registrationBond` (no bond exists),
`repost` (the store has no concept of it — see open decisions), `agentCount`,
and the tx `hash` every write used to return. `Post` lost `blockNumber`,
`transactionHash` and `logIndex` and gained `createdAt`, which deleted the
block-timestamp round trip the web app needed to render "4m".

`node scripts/verify-sdk.mjs` runs 39 checks against a live server, including
polling `watch` and the read-only client's refusal to write.

---

### The chain is gone

Deleted: `contracts/` (Solidity, Foundry, deployments, the forge-std submodule),
`abi.ts`, `chains.ts`, `deployments.ts`, `scripts/sync-abi.mjs`,
`NotConfigured.tsx`, the `contracts` and `abi-in-sync` CI jobs, and the
`contracts:*` scripts. All recoverable from git at `872c79e`.

**wagmi stays in web, as a signer and nothing else.** It was kept deliberately:
the browser needs *something* to sign requests, and a wallet holds the key more
safely than localStorage would. `createConfig` still demands a chain, so mainnet
is named to satisfy it and nothing is ever sent there. No request this app makes
touches a chain.

Copy that asserted a bond, a network or a transaction is corrected throughout —
including the MCP tool descriptions and the daemon's system prompt, which were
telling agents their posts were stored on-chain. `explain()` in the MCP server
now maps the API's error codes instead of Solidity custom errors that can no
longer be thrown.

---

## What is left

1. **Rewrite the README.** Its "Why bother putting this on-chain" section, the
   deployed-contracts table and several design-decision paragraphs are now
   false. `CONTRIBUTING.md` still tells contributors to install Foundry and run
   `forge test`. The GitHub repo description says "on Robinhood Blockchain" too,
   and that is changed in the repo settings, not in a file.

---

## Open decisions — needs the owner

- **Production database.** Local Postgres now covers dev and tests, but
  production still needs a hosted connection string as `DATABASE_URL` in Vercel;
  Neon and Vercel Postgres both have free tiers. Cannot be provisioned without
  their account. `PostgresStore.init()` builds the schema on first run, so there
  is no migration step to hand over.
- **`@love_ai` did not migrate.** Its handle, registration and one post exist
  only on the testnet contracts, which are no longer read. It has to re-register
  against the API. Trivial at this size, but nothing does it automatically, and
  the on-chain bond stays locked until someone retires that agent on-chain.
- **Sybil resistance is still unsolved, and rate limiting does not solve it.**
  `Store.rateLimit` now backs limits on registration and posting (see
  `web/lib/server/ratelimit.ts`), which stops runaway loops and casual bulk
  squatting. It is not sybil resistance: a keypair is free, so a per-key limit
  is trivially sidestepped by bringing another key, and the client address doing
  the real work is cheap in a datacentre and shared behind NAT. Anything
  stronger has to come from outside an HTTP request — an invite, a proof of
  work, a cost. That decision is still open.
- **`repost` was dropped.** It was a contract event with no storage and no
  consumer. Off-chain it needs a decision: a real column, a convention on top of
  replies, or left out.
- **The 512-byte post cap** is inherited from the contract's `MAX_URI_LENGTH`
  and the routes still enforce it. Off the chain it is pure convention, and it
  is a real constraint on what agents can say: a normal paragraph does not fit.
  Worth deciding deliberately rather than keeping by inertia.
- **Who can delete things.** Running the database makes them able to edit or
  remove any post. Worth an explicit position in the README.

---

## Environment notes that cost time this session

- **`gh` flips accounts.** Two are logged in; the active one reverts to
  `Gentle2003`, which has no write access. GitHub returns **404, not 403**, for
  unauthorised writes, so a confusing "Not Found" means the wrong account. Fix:
  `gh auth switch --user parleyrobinhood`. Check before every push.
- **Vercel is a different account** (`parleyrobinhood` team, project
  `parley-web-frsj`) from the one owning the other projects. `vercel` CLI must
  be logged in as `parleyrobinhood` to see it. Root Directory is `web`, with
  "include files outside root" enabled, and there is **no root `vercel.json`** —
  an early one seeded a sticky `outputDirectory` override that survived
  deleting both the file and the project.
- **Cold builds.** Packages resolve each other through gitignored `dist/`.
  Anything that only passes with a warm `dist/` fails on a fresh clone — this
  broke a Vercel deploy and a CI run. CI now deletes every `dist/` before each
  step; keep it that way.
- **Do not run a production build while the dev server is running.** It writes
  into the same `.next` and corrupts it; the symptom is 500s and
  "Cannot find module './vendor-chunks/…'".
- **`git add -A` sweeps `.mcp.json`.** Now gitignored, but watch for it.
- **`web/.env.local` points `DATABASE_URL` at `parley_web`**, deliberately a
  different database from the `parley_dev` the store suite truncates.
- **Local Postgres** is installed via Homebrew (`postgresql@16`, running as a
  `brew services` login item) with a `parley_dev` database. It is keg-only, so
  `psql` and friends need `/opt/homebrew/opt/postgresql@16/bin` on PATH. Run the
  store suite against it with
  `DATABASE_URL=postgres://localhost/parley_dev pnpm test`.
- **No longer running:** the anvil node on `:8545` and the dev server on `:3100`
  from the previous session are both dead; restart them if you need them.
  `web/.env.local` currently points at **testnet**
  (46630). Anvil's deployment is registry
  `0x5FbDB2315678afecb367f032d93F642f64180aa3`, feed
  `0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512`, `deployedAtBlock` 0, with 4
  agents, 7 posts, follows and signals.

## Conventions to keep

- Commits are authored as **Parley Labs** (set repo-locally). No AI attribution
  anywhere in the repo, ever.
- Verify against a running system before claiming something works, and say
  plainly what was not verified.
- The daemon's Claude call has **never run** — there is no `ANTHROPIC_API_KEY`
  on this machine. Everything up to it is verified; the decision step is not.
