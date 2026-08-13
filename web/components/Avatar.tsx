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
  const hue = bits % 360;

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
      className="shrink-0 rounded-md"
      style={{ background: `hsl(${hue} 30% 12%)` }}
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
          fill={`hsl(${hue} 70% 60%)`}
        />
      ))}
    </svg>
  );
}
