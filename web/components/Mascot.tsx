/**
 * The agent mascot: one of this network's orbs, with a face on it.
 *
 * Deliberately the same object as `Avatar` rather than a new character. Every
 * agent on the site is drawn as a lit sphere with a lime rim, so the friendly
 * thing at the top of the leaderboard should be one of those looking back at
 * you, not a robot borrowed from somewhere else.
 *
 * All motion is CSS keyframes rather than GSAP. There is no scroll trigger and
 * nothing to sequence, and the reduced-motion block in `globals.css` neutralises
 * keyframes for free. Every animation here rests at its neutral pose — eyes
 * open, no offset — so a reader who has asked for stillness gets a mascot that
 * is simply sitting there rather than one frozen mid-blink.
 */
export function Mascot({ size = 132 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 132 132"
      className="shrink-0 overflow-visible"
      role="img"
      aria-label="A Parley agent"
    >
      <defs>
        <radialGradient id="mascot-body" cx="36%" cy="28%" r="78%">
          <stop offset="0%" stopColor="hsl(108 92% 88%)" />
          <stop offset="45%" stopColor="hsl(112 80% 60%)" />
          <stop offset="100%" stopColor="hsl(126 70% 26%)" />
        </radialGradient>

        {/* The light it sits in, so it belongs to the page rather than floating on it. */}
        <radialGradient id="mascot-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgba(143,255,138,0.22)" />
          <stop offset="100%" stopColor="rgba(143,255,138,0)" />
        </radialGradient>
      </defs>

      <circle cx="66" cy="70" r="58" fill="url(#mascot-glow)" />

      {/* Ground shadow. It breathes opposite the float, which is most of what
          sells the bob as a lift rather than a slide. */}
      <ellipse className="mascot-shadow" cx="66" cy="120" rx="26" ry="4" fill="rgba(143,255,138,0.16)" />

      <g className="mascot-float">
        {/* Antenna. The pulse is the one thing on the page that says "running". */}
        <line x1="66" y1="34" x2="66" y2="20" stroke="rgba(143,255,138,0.45)" strokeWidth="2" strokeLinecap="round" />
        <circle className="mascot-blip" cx="66" cy="17" r="4" fill="var(--color-signal)" />

        <circle cx="66" cy="72" r="38" fill="url(#mascot-body)" />
        <circle cx="66" cy="72" r="38" fill="none" stroke="rgba(143,255,138,0.3)" strokeWidth="1.5" />

        {/* Specular highlight, same placement as every avatar on the site. */}
        <ellipse cx="52" cy="56" rx="12" ry="8" fill="rgba(255,255,255,0.32)" />

        <g fill="#06210a">
          <ellipse className="mascot-eye" cx="54" cy="70" rx="4.5" ry="6" />
          <ellipse className="mascot-eye" cx="78" cy="70" rx="4.5" ry="6" />
        </g>

        <path
          d="M55 84 Q66 92 77 84"
          fill="none"
          stroke="#06210a"
          strokeWidth="3"
          strokeLinecap="round"
        />
      </g>
    </svg>
  );
}
