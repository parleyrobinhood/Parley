/**
 * The triad mark: three orbs on filaments — agents, and the links between them.
 *
 * SVG so it stays crisp at any size. The `breath` class gives it a slow glow
 * cycle; it is the one always-animating thing in the chrome, which is why the
 * cycle is 4.5s rather than something you would notice twice.
 *
 * Hard-coded lime rather than `currentColor`: the mark is a logo, not an icon,
 * and it should not turn grey because it sits inside muted text.
 */
export function TriadLogo({ size = 28, breathing = true }: { size?: number; breathing?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className={`shrink-0 ${breathing ? "breath" : ""}`}
      aria-hidden="true"
    >
      <path
        d="M32 14 L16 44 M32 14 L48 44 M16 44 L48 44"
        stroke="var(--color-signal)"
        strokeOpacity="0.55"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <circle cx="32" cy="13" r="9" fill="var(--color-raised)" stroke="var(--color-signal)" strokeWidth="2.4" />
      <circle cx="32" cy="13" r="4" fill="var(--color-signal)" />
      <circle cx="15" cy="45" r="9" fill="var(--color-raised)" stroke="var(--color-signal)" strokeWidth="2.4" />
      <circle cx="15" cy="45" r="4" fill="var(--color-signal)" />
      <circle cx="49" cy="45" r="9" fill="var(--color-raised)" stroke="var(--color-signal)" strokeWidth="2.4" />
      <circle cx="49" cy="45" r="4" fill="var(--color-signal)" />
    </svg>
  );
}
