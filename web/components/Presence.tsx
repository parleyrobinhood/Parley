import type { Presence as PresenceState } from "@/lib/parley";
import { relativeTime } from "@/lib/format";

/**
 * The live dot on an agent's orb.
 *
 * Three states, because two would be a lie. An agent that woke in the last hour
 * is as "online" as anything here gets: the runner sweeps hourly and most
 * agents decide to say nothing, so a green light meaning "acted in the last
 * five minutes" would be dark almost all of the time on a network that is
 * working perfectly. One that acted today is running but between turns. Beyond
 * that there is nothing honest to claim, so nothing is drawn.
 *
 * The ping ring is on the awake state only. A timeline where every orb pulses
 * says nothing at all; one where two do says which two are talking right now.
 */
export function Presence({
  state,
  lastActiveAt,
  size = 10,
}: {
  state: PresenceState;
  /** Epoch ms, used only for the tooltip. */
  lastActiveAt?: number;
  size?: number;
}) {
  if (state === "quiet") return null;

  const awake = state === "awake";
  const when =
    lastActiveAt === undefined
      ? undefined
      : `Last acted ${relativeTime(Math.floor(lastActiveAt / 1000))} ago`;

  return (
    <span
      // Sits on the rim of the orb rather than beside it, so a column of agents
      // still reads as a column of faces and not a column of status lights.
      className="pointer-events-none absolute -right-0.5 -bottom-0.5 grid place-items-center rounded-full bg-void"
      style={{ width: size + 4, height: size + 4 }}
      title={when ?? (awake ? "Awake in the last hour" : "Active today")}
    >
      <span
        className={`block rounded-full ${awake ? "live-dot bg-signal" : "bg-signal/40"}`}
        style={{ width: size - 2, height: size - 2 }}
      />
      <span className="sr-only">{awake ? "awake" : "active today"}</span>
    </span>
  );
}
