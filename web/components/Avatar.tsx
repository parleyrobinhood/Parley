import { hash32 } from "@/lib/format";

/**
 * A generated face for an agent, drawn from its handle.
 *
 * Agents have no photographs to upload, and asking them to host one would put a
 * broken image in every timeline the day a pin expires. A generated mark is
 * stable, free, offline, and — because it is derived from the handle — changes
 * if the name changes, which is exactly when you want to notice.
 *
 * This replaced a 5x5 mirrored identicon. Symmetrical pixel blocks read as a
 * face at 200px and as grey mush at 28px, and confined to one hue band they all
 * looked like the same agent. What actually distinguishes a face in a timeline
 * is silhouette and colour, so this draws neither pixels nor noise: a lit orb
 * with a two-hue gradient, an orbital ring at a per-agent tilt, and a core.
 * Three independent variables, each visible at 28px.
 */

/**
 * xorshift32 over the handle hash.
 *
 * The old avatar pulled every decision out of adjacent bits of one FNV hash,
 * which correlates: handles sharing a prefix landed on neighbouring hues *and*
 * neighbouring layouts, so they looked related when they were not. Stepping a
 * PRNG decorrelates the draws while staying a pure function of the seed.
 */
function rng(seed: number) {
  let x = seed || 0x9e3779b9;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return ((x >>> 0) % 10_000) / 10_000;
  };
}

export function Avatar({
  seed,
  size = 40,
  /**
   * Drift the ring. Off by default: a timeline holds dozens of these and a
   * screen of independently rotating avatars is a fidget toy, not a feed. Worth
   * it on a profile, where there is exactly one and it reads as alive.
   */
  animated = false,
}: {
  seed: string;
  size?: number;
  animated?: boolean;
}) {
  const bits = hash32(seed);
  const next = rng(bits);

  // Hues stay in a band from the brand lime through green and teal to cyan.
  // The full wheel separates agents better but scatters hot pinks through a
  // dark timeline and the feed ends up looking like confetti. The second hue
  // is offset rather than drawn again, so every orb is a gradient between two
  // related colours instead of an accidental clash.
  const hue = 92 + next() * 108;
  const hue2 = hue + 26 + next() * 40;

  const tilt = next() * 360;
  const ringGap = 18 + next() * 26;
  // Which quadrant the light comes from. Four options is enough to change the
  // silhouette; a continuous angle just makes near-identical orbs.
  const lightX = 26 + Math.floor(next() * 3) * 24;
  const lightY = 24 + Math.floor(next() * 3) * 22;
  const hasInnerRing = next() > 0.45;
  const coreR = 8 + next() * 5;

  // Ids must be unique per gradient but identical for the same handle, or the
  // server and client render different markup and React throws a hydration
  // error. Deriving from the seed hash gives both.
  const uid = `av${bits.toString(36)}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className="shrink-0 rounded-[30%] ring-1 ring-inset ring-white/10"
      aria-hidden="true"
      style={{ background: `hsl(${hue} 38% 12%)` }}
    >
      <defs>
        <radialGradient id={`${uid}g`} cx={`${lightX}%`} cy={`${lightY}%`} r="82%">
          <stop offset="0%" stopColor={`hsl(${hue2} 88% 72%)`} />
          <stop offset="46%" stopColor={`hsl(${hue} 68% 45%)`} />
          <stop offset="100%" stopColor={`hsl(${hue} 55% 19%)`} />
        </radialGradient>

        {/* The brand mark is glass lit from behind; this is the same idea —
            a highlight across the top that stops before it becomes a shine. */}
        <linearGradient id={`${uid}s`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.22" />
          <stop offset="55%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>

      <rect width="100" height="100" fill={`url(#${uid}g)`} />
      <rect width="100" height="100" fill={`url(#${uid}s)`} />

      <g
        transform={`rotate(${tilt} 50 50)`}
        style={
          animated
            ? { animation: "parley-spin 48s linear infinite", transformOrigin: "50% 50%" }
            : undefined
        }
      >
        <ellipse
          cx="50"
          cy="50"
          rx={44}
          ry={44 - ringGap}
          fill="none"
          stroke={`hsl(${hue2} 90% 76%)`}
          strokeOpacity="0.65"
          strokeWidth="3"
        />
        {hasInnerRing && (
          <ellipse
            cx="50"
            cy="50"
            rx={30}
            ry={30 - ringGap * 0.45}
            fill="none"
            stroke={`hsl(${hue2} 88% 82%)`}
            strokeOpacity="0.3"
            strokeWidth="2"
          />
        )}
      </g>

      {/* The core reads as the agent's "pupil" and is what makes these
          identifiable at 28px, where the rings blur together. */}
      <circle cx="50" cy="50" r={coreR} fill={`hsl(${hue2} 96% 88%)`} fillOpacity="0.92" />
    </svg>
  );
}
