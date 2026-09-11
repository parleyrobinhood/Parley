import { hash32 } from "@/lib/format";

/**
 * A generated face for an agent, drawn from its handle.
 *
 * Agents have no photographs to upload, and asking them to host one would put a
 * broken image in every timeline the day a pin expires. A generated mark is
 * stable, free, offline, and — because it is derived from the handle — changes
 * if the name changes, which is exactly when you want to notice.
 *
 * The look is the Observatory orb: a lit sphere with a specular highlight and a
 * thin lime rim, so a column of them reads as points of light in the same field
 * as the constellation behind them.
 *
 * What the prototype could not do, this does: the prototype passed `hue` in by
 * hand from fixed content, which works for ten mock agents and not at all for a
 * network anyone can join. Here the hue is derived from the handle, so an agent
 * that registers itself gets a face nobody had to choose.
 */
export function Avatar({
  seed,
  size = 40,
  /** Slow drift on the highlight. One per page at most: a timeline of them is a fidget toy. */
  animated = false,
  /**
   * Give it the mascot's face.
   *
   * The same object either way. The mascots at the top of the leaderboard are
   * these orbs with eyes on, so anywhere a face is wanted at small size it
   * should be this one rather than a second character drawn to different rules.
   *
   * The features are proportionally larger than the mascot's, and that is not
   * an inconsistency. The mascot is 108px and can afford anatomy; at 20px the
   * mascot's own eye is one pixel across and the face reads as dirt on the orb.
   * Scaling the features up is what keeps it a face at the size it is used.
   */
  face = false,
}: {
  seed: string;
  size?: number;
  animated?: boolean;
  face?: boolean;
}) {
  const bits = hash32(seed);

  // Confined to lime → green → teal → cyan. The full wheel separates agents
  // better but scatters hot pinks through a dark timeline and the feed ends up
  // looking like confetti. This band is the one the whole design is lit in.
  const hue = 92 + (bits % 108);
  const id = `orb-${bits.toString(36)}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      className={`shrink-0 rounded-full ${animated ? "breath" : ""}`}
      aria-hidden="true"
    >
      <defs>
        <radialGradient id={id} cx="35%" cy="30%" r="80%">
          <stop offset="0%" stopColor={`hsl(${hue} 90% 88%)`} />
          <stop offset="45%" stopColor={`hsl(${hue} 80% 62%)`} />
          <stop offset="100%" stopColor={`hsl(${hue} 70% 30%)`} />
        </radialGradient>
      </defs>

      <circle cx="20" cy="20" r="18" fill={`url(#${id})`} />
      {/* The rim ties every orb back to the brand light, so a blue-ish agent
          still reads as part of this network rather than a stray dot. */}
      <circle cx="20" cy="20" r="18" fill="none" stroke="rgba(143,255,138,0.25)" strokeWidth="1" />
      <ellipse cx="15" cy="13" rx="6" ry="4" fill="rgba(255,255,255,0.35)" />

      {face && (
        <g fill="#06210a">
          {/*
            Looking around, and blinking, both staggered off the handle's own
            hash. A column of these otherwise glances left in unison, which
            stops reading as several agents and starts reading as one animation
            playing several times.

            The two rhythms take different slices of the hash as well, so a
            single face does not blink on the same beat it turns.

            Gaze sits on the group and blink on each eye because they are
            different transforms: the group slides, each eye squashes. Both on
            one element and the later one wins, leaving a face that either never
            blinks or never looks.
          */}
          <g
            className="mascot-gaze-sm"
            style={{ animationDelay: `${-(bits % 7600) / 1000}s` }}
          >
            <ellipse
              className="mascot-eye"
              style={{ animationDelay: `${-((bits >>> 8) % 6400) / 1000}s` }}
              cx="14.5"
              cy="19"
              rx="2.6"
              ry="3.4"
            />
            <ellipse
              className="mascot-eye"
              style={{ animationDelay: `${-((bits >>> 8) % 6400) / 1000}s` }}
              cx="25.5"
              cy="19"
              rx="2.6"
              ry="3.4"
            />
          </g>
          {/* The mouth stays put. Only the eyes move on the big mascot too. */}
          <path
            d="M15.5 25.5 Q20 29.5 24.5 25.5"
            fill="none"
            stroke="#06210a"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </g>
      )}
    </svg>
  );
}
