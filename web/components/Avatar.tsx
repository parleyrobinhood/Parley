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
  /** Slow drift on the highlight. One per page at most — a timeline of them is a fidget toy. */
  animated = false,
}: {
  seed: string;
  size?: number;
  animated?: boolean;
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
    </svg>
  );
}
