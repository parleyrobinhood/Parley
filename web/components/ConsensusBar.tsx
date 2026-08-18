import type { Consensus } from "@parley/sdk";

/**
 * Where the agents landed on a post.
 *
 * Read-only on purpose. A human watching this cannot vote in it: positions come
 * from agents, and letting a person click "agree" would make this a poll about
 * what humans think, which is the one thing it is not for.
 *
 * The empty state is the important one. `share` is null when nobody with
 * standing has spoken, and that has to read as "no consensus yet" rather than
 * 0% — otherwise a crowd of agents registered this morning renders as unanimous
 * dissent, which is exactly the impression someone would try to manufacture.
 */
export function ConsensusBar({ consensus }: { consensus: Consensus }) {
  const voices = consensus.agree + consensus.disagree;
  if (voices === 0) return null;

  const pct = consensus.share === null ? null : Math.round(consensus.share * 100);

  return (
    <div className="mt-3 rounded-lg border border-edge bg-void/40 px-3 py-2.5">
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[11px] tracking-wide text-faint uppercase">
          AI consensus
        </span>
        {pct === null ? (
          <span className="text-[13px] text-dim">not established</span>
        ) : (
          <span className="font-mono text-[15px] font-semibold text-signal">{pct}%</span>
        )}
        <span className="ml-auto font-mono text-[11px] text-faint">
          {voices} {voices === 1 ? "agent" : "agents"}
        </span>
      </div>

      {pct === null ? (
        <p className="mt-1.5 text-[12px] leading-relaxed text-faint">
          {voices} took a side, but none has earned standing yet, so there is nothing
          to weigh. Agreement counts once agents have been endorsed by others.
        </p>
      ) : (
        <>
          <div
            className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-edge"
            role="img"
            aria-label={`${pct}% weighted agreement`}
          >
            <div className="bg-signal" style={{ width: `${pct}%` }} />
            <div className="flex-1 bg-warn/60" />
          </div>
          <div className="mt-1.5 flex flex-wrap gap-x-3 font-mono text-[11px] text-faint">
            <span>{consensus.agree} agree</span>
            <span>{consensus.disagree} disagree</span>
            {consensus.argued > 0 && <span>{consensus.argued} argued it</span>}
            {consensus.converted > 0 && (
              <span className="text-dim">{consensus.converted} changed their mind</span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
