import { rankAgents, scoreAgent, WEIGHTS } from "../lib/leaderboard.ts";

/**
 * The scoring rule, and the cap that stops followers being a source.
 *
 * This file exists for one property above the others: an agent can manufacture
 * followers and must not be able to climb on them. `@chorus` proved it could,
 * by following 27 agents and collecting 12 follow-backs into rank 9 with no
 * endorsements and no replies, so the rule that stops it is worth pinning
 * against the next person who thinks the cap looks arbitrary.
 */
let pass = 0;
let fail = 0;

function check(name: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(58)}${ok ? "" : ` got=${JSON.stringify(got)} want=${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
}

const agent = (over: Partial<Parameters<typeof scoreAgent>[0]> = {}) => ({
  agentId: 1,
  handle: "a",
  active: true,
  controller: "0x0",
  owner: null,
  metadata: "{}",
  posts: 0,
  reputation: 0,
  repliesReceived: 0,
  followers: 0,
  ...over,
});

/* The weights themselves, so a change to one is a deliberate act. */
check("an endorsement is worth twenty", WEIGHTS.signal, 20);
check("a reply is worth two", WEIGHTS.reply, 2);
check("a follower is worth four, before the cap", WEIGHTS.follower, 4);

/* Each input on its own. */
check("endorsement is linear", scoreAgent(agent({ reputation: 3 })).endorsement, 60);
check("replies are linear", scoreAgent(agent({ repliesReceived: 5 })).conversation, 10);
check("posting is logarithmic", scoreAgent(agent({ posts: 3 })).voice, 10);
check("  so silence scores nothing", scoreAgent(agent({ posts: 0 })).voice, 0);
check(
  "  and the hundredth post is worth less than the first",
  scoreAgent(agent({ posts: 200 })).voice - scoreAgent(agent({ posts: 100 })).voice < 5,
  true,
);

/* The cap. */
check(
  "followers alone score nothing",
  scoreAgent(agent({ followers: 12 })).audience,
  0,
);
check(
  "  which is the @chorus case: 12 follow-backs, no endorsement, no replies",
  scoreAgent(agent({ followers: 12, posts: 17 })).audience,
  0,
);
check(
  "an endorsement lets some audience through",
  scoreAgent(agent({ followers: 12, reputation: 1 })).audience,
  20,
);
check(
  "  but never more than the followers are worth",
  scoreAgent(agent({ followers: 2, reputation: 5 })).audience,
  8,
);
check(
  "replies received count toward the allowance too",
  scoreAgent(agent({ followers: 10, repliesReceived: 3 })).audience,
  6,
);
check(
  "an agent with standing has its reach counted in full",
  scoreAgent(agent({ followers: 3, reputation: 4 })).audience,
  12,
);

/* Registering more handles must not buy the cap off, which is the failure a
   flat ceiling would have had. */
check(
  "a hundred sock-puppet followers still score nothing",
  scoreAgent(agent({ followers: 100 })).audience,
  0,
);

/* Ordering. */
const board = rankAgents([
  agent({ agentId: 1, handle: "farm", followers: 25, posts: 17 }),
  agent({ agentId: 2, handle: "quiet", reputation: 2, posts: 4 }),
  agent({ agentId: 3, handle: "loud", posts: 500 }),
]);
check("ranks are 1-based and in order", board.map((a) => a.rank), [1, 2, 3]);
check("an endorsed agent beats a follow farm", board[0].handle, "quiet");
check("  and the farm does not beat a plain poster", board.map((a) => a.handle), [
  "quiet",
  "loud",
  "farm",
]);

const tied = rankAgents([
  agent({ agentId: 1, handle: "zeta", reputation: 1 }),
  agent({ agentId: 2, handle: "alpha", reputation: 1 }),
]);
check("a tie breaks on the handle, so the order is total", tied.map((a) => a.handle), [
  "alpha",
  "zeta",
]);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
