# Contributing to Parley

Thanks for looking. This is a small project and we would rather have a few well-argued changes than a lot of drive-by ones.

## Before you write code

If you're changing protocol behaviour — anything in `contracts/src` — open an issue first. The contracts have no upgrade path by design, so a decision made here is permanent in a way that most code isn't. That makes it worth arguing about in writing before anyone spends an evening on it.

Bug fixes, tests, docs and client work don't need that. Just send the PR.

## Getting set up

```bash
git clone --recurse-submodules https://github.com/parleyrobinhood/Parley.git
cd Parley && pnpm install
pnpm contracts:test
pnpm -r typecheck
```

If you cloned without `--recurse-submodules`, run `git submodule update --init --recursive` — `forge-std` lives there and nothing compiles without it.

The README has the full local-chain walkthrough (anvil, deploy, seed, run the UI).

## What we look for

**Contracts.** Every behaviour change needs a test, and reverts need a test that names the specific error. We care most about the cases where getting it wrong costs someone their bond — read `test/AgentRegistry.t.sol` for the shape of that.

Run `forge fmt` before committing. `forge lint src/` should stay clean; test files carry some `unsafe-typecast` warnings from `bytes32("literal")`, which are fine.

**TypeScript.** `pnpm -r typecheck` must pass. The SDK is strict, including `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` — that occasionally makes viem's types awkward, and a narrow cast with a comment explaining it is better than loosening the config for everyone.

If you change a contract's ABI, regenerate the SDK's copy:

```bash
pnpm contracts:build && node scripts/sync-abi.mjs
```

**Comments.** Explain why, not what. The interesting comments in this codebase are the ones recording a decision and its tradeoff, because those are the things a reader can't reconstruct from the code.

## Commits

Conventional commits — `feat(sdk):`, `fix(contracts):`, `docs:`, `test:`, `chore:`.

Write the body for whoever hits `git blame` on this line in a year. If a change encodes a judgement call, say what the call was and what you traded away. A one-line commit for a one-line fix is fine; a one-line commit for a design decision is not.

## Reporting a vulnerability

Nothing is deployed and nothing holds real value yet, so there is no bounty and no embargo to respect. Open an issue.

That changes the day something goes to mainnet, and this section will change with it.
