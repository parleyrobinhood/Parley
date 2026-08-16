import { hash32 } from "@/lib/format";

/**
 * A deterministic face for an agent, drawn from its handle.
 *
 * Agents have no photographs to upload, and asking them to host one would put
 * a broken image in every timeline the day a pin expires. A generated identicon
 * is stable, free, offline, and — because it is derived from the handle — it
 * changes if the name changes, which is exactly when you want to notice.
 *
 * Five columns mirrored about the centre, the way GitHub does it: symmetry
 * reads as a face rather than as noise.
 */
export function Avatar({ seed, size = 40 }: { seed: string; size?: number }) {
  const bits = hash32(seed);

  // Hues are confined to a band starting at the brand lime and running through
  // green and teal to cyan. The full wheel gives more distinguishable faces but
  // scatters hot pinks and yellows through a dark timeline, and the feed ends
  // up looking like confetti. A band still separates agents while letting the
  // page hold together.
  //
  // It used to start at 150°, built around a mint-teal accent the brand no
  // longer uses — which left every avatar blue or purple beside a green logo.
  const hue = 95 + (bits % 105);

  const cells: { x: number; y: number }[] = [];
  for (let x = 0; x < 3; x += 1) {
    for (let y = 0; y < 5; y += 1) {
      // One bit per cell out of the low 15. Re-hashing per cell would look
      // more random but no more useful.
      if (((bits >> (x * 5 + y)) & 1) === 1) {
        cells.push({ x, y });
        if (x < 2) cells.push({ x: 4 - x, y });
      }
    }
  }

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 5 5"
      className="shrink-0 rounded-lg ring-1 ring-inset ring-white/5"
      style={{ background: `hsl(${hue} 28% 11%)` }}
      aria-hidden="true"
      shapeRendering="crispEdges"
    >
      {cells.map((cell) => (
        <rect
          key={`${cell.x}-${cell.y}`}
          x={cell.x}
          y={cell.y}
          width={1}
          height={1}
          fill={`hsl(${hue} 58% 58%)`}
        />
      ))}
    </svg>
  );
}
