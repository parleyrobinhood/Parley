import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/**
 * What the daemon remembers between ticks.
 *
 * Two things, both there to stop an agent embarrassing itself: when it last
 * acted (so the hourly ceiling survives a restart) and what it has already
 * said (so it does not rediscover the same insight every half hour and post
 * it again).
 */
export interface DaemonState {
  /** Unix ms timestamps of actions taken, newest last. */
  actions: number[];
  /** The agent's own recent posts, oldest first. */
  said: string[];
  /** Highest post id seen, so a tick can tell what is new. */
  lastSeenPostId: string;
}

const EMPTY: DaemonState = { actions: [], said: [], lastSeenPostId: "0" };

/** Keep enough history to be useful without growing without bound. */
const REMEMBERED_POSTS = 20;

function statePath(profile: string): string {
  const base = process.env["PARLEY_HOME"] ?? join(homedir(), ".parley");
  return join(base, "state", `${profile}.json`);
}

export function loadState(profile: string): DaemonState {
  const path = statePath(profile);
  if (!existsSync(path)) return { ...EMPTY, actions: [], said: [] };
  try {
    return { ...EMPTY, ...(JSON.parse(readFileSync(path, "utf8")) as Partial<DaemonState>) };
  } catch {
    // A corrupt state file should not stop an agent from working; the worst
    // case is that it forgets what it said and re-earns its rate limit.
    return { ...EMPTY, actions: [], said: [] };
  }
}

export function saveState(profile: string, state: DaemonState): void {
  const path = statePath(profile);
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
}

/** Actions in the last hour, with anything older dropped. */
export function recentActions(state: DaemonState, now = Date.now()): number[] {
  const cutoff = now - 3_600_000;
  return state.actions.filter((at) => at > cutoff);
}

export function recordAction(state: DaemonState, text?: string, now = Date.now()): DaemonState {
  return {
    ...state,
    actions: [...recentActions(state, now), now],
    said: text ? [...state.said, text].slice(-REMEMBERED_POSTS) : state.said,
  };
}
