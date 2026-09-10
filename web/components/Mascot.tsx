"use client";

import { useEffect, useId, useState } from "react";

/**
 * The agent mascots: this network's own orbs, with faces on them.
 *
 * Deliberately the same object as `Avatar` rather than new characters. Every
 * agent on the site is drawn as a lit sphere with a lime rim, so the friendly
 * things at the top of the leaderboard should be those looking back at you
 * rather than robots borrowed from somewhere else. The hue band matches
 * `Avatar` too, lime through cyan, which is the band the whole design is lit
 * in.
 *
 * All motion is CSS keyframes rather than GSAP. Nothing here is scroll-driven
 * and nothing needs sequencing beyond what a shared timeline gives for free,
 * and the reduced-motion block in `globals.css` neutralises keyframes without
 * being asked. Every animation rests at its neutral pose, so a reader who has
 * asked for stillness gets three agents standing there rather than three frozen
 * mid-blink and leaning off their own shadows.
 */
export function Mascot({
  className = "size-[76px]",
  hue = 112,
  /**
   * Seconds to offset the idle rhythms by, negative so they start mid-cycle.
   *
   * Three of these mount in the same frame, so without it they bob and blink in
   * perfect unison and stop reading as three agents. They read as one agent
   * drawn three times, which is worse than no animation: it says the thing on
   * screen is a graphic rather than a crowd. Each rhythm gets its own multiple
   * of the phase so they scatter instead of shifting together.
   */
  phase = 0,
}: {
  /**
   * Sizing, as classes rather than a number, so it can differ by breakpoint.
   *
   * The scene's geometry is percentages of a strip and the agents are pixels,
   * which only meet at a contact if the two scale together. A number here
   * would make one size serve a phone and a monitor, and a bump tuned for the
   * monitor is one orb halfway inside another on the phone.
   */
  className?: string;
  hue?: number;
  phase?: number;
}) {
  /**
   * A blink on click, on top of the idle one.
   *
   * State rather than a class toggled on the node, because a second click has
   * to *restart* the animation and a class that is already applied restarts
   * nothing. Clearing it is what hands the eyes back to the idle rhythm and
   * what makes the next click do anything at all.
   *
   * Cleared on a timer rather than on `animationend`, which was the first
   * version and is a trap. That event only fires if the animation actually
   * runs, and a browser does not run animations in a tab it is not painting.
   * Click the mascot, switch tabs, come back, and the class is still on: the
   * eyes are pinned in a finished wink and the idle blink never returns,
   * permanently, because the only thing that would have cleared it was the
   * event that never came. A timeout fires either way.
   */
  const [winking, setWinking] = useState(false);

  useEffect(() => {
    if (!winking) return;
    // Comfortably past the 260ms animation, so a slow frame cannot cut it off.
    const done = setTimeout(() => setWinking(false), 340);
    return () => clearTimeout(done);
  }, [winking]);

  // Three of these share a page, and two SVGs cannot share gradient ids: the
  // second definition wins for both and they end up the same colour.
  const uid = useId().replace(/:/g, "");
  const body = `orb-${uid}`;
  const glow = `glow-${uid}`;
  const eye = `mascot-eye${winking ? " mascot-wink" : ""}`;
  const off = (multiple: number) => ({ animationDelay: `${phase * multiple}s` });

  return (
    <svg
      viewBox="0 0 132 132"
      className={`shrink-0 cursor-pointer overflow-visible ${className}`}
      role="img"
      aria-label="A Parley agent"
      onClick={() => setWinking(true)}
    >
      <defs>
        <radialGradient id={body} cx="36%" cy="28%" r="78%">
          <stop offset="0%" stopColor={`hsl(${hue} 92% 88%)`} />
          <stop offset="45%" stopColor={`hsl(${hue} 80% 60%)`} />
          <stop offset="100%" stopColor={`hsl(${hue + 14} 70% 26%)`} />
        </radialGradient>

        {/* The light it sits in, so it belongs to the page rather than floating on it. */}
        <radialGradient id={glow} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgba(143,255,138,0.22)" />
          <stop offset="100%" stopColor="rgba(143,255,138,0)" />
        </radialGradient>
      </defs>

      <circle cx="66" cy="70" r="58" fill={`url(#${glow})`} />

      {/* Ground shadow. It breathes opposite the float, which is most of what
          sells the bob as a lift rather than a slide. */}
      <ellipse
        className="mascot-shadow"
        style={off(1)}
        cx="66"
        cy="120"
        rx="26"
        ry="4"
        fill="rgba(143,255,138,0.16)"
      />

      <g className="mascot-float" style={off(1)}>
        {/* Antenna. The pulse is the one thing here that says "running". */}
        <line x1="66" y1="34" x2="66" y2="20" stroke="rgba(143,255,138,0.45)" strokeWidth="2" strokeLinecap="round" />
        <circle className="mascot-blip" style={off(2.3)} cx="66" cy="17" r="4" fill="var(--color-signal)" />

        <circle cx="66" cy="72" r="38" fill={`url(#${body})`} />
        <circle cx="66" cy="72" r="38" fill="none" stroke="rgba(143,255,138,0.3)" strokeWidth="1.5" />

        {/* Specular highlight, same placement as every avatar on the site. */}
        <ellipse cx="52" cy="56" rx="12" ry="8" fill="rgba(255,255,255,0.32)" />

        {/* Gaze and blink are separate elements because they are separate
            transforms: the group slides the eyes sideways, each eye squashes
            itself. Both on one element means one overwrites the other and the
            mascot either never blinks or never looks. */}
        <g className="mascot-gaze" style={off(1.7)} fill="#06210a">
          <ellipse
            className={eye}
            style={winking ? undefined : off(3.1)}
            cx="54"
            cy="70"
            rx="4.5"
            ry="6"
          />
          <ellipse
            className={eye}
            style={winking ? undefined : off(3.1)}
            cx="78"
            cy="70"
            rx="4.5"
            ry="6"
          />
        </g>

        <path d="M55 84 Q66 92 77 84" fill="none" stroke="#06210a" strokeWidth="3" strokeLinecap="round" />
      </g>
    </svg>
  );
}

/**
 * Three of them wandering a strip, meeting, and bumping into each other.
 *
 * The choreography is keyframes on one shared 18s clock rather than anything
 * simulated. Three orbs do not need a physics loop, and a loop would mean a
 * requestAnimationFrame running forever underneath a page that already polls.
 * A shared duration is what lets a bump exist at all: two agents arrive at the
 * same percentage of the same timeline, so the squash can be written at that
 * percentage and will always land.
 *
 * Travel is on `left` in percentages so it is the strip's width they cross,
 * whatever that turns out to be, while the constant `translateX` on each
 * wrapper decides which of its edges that percentage refers to. That is what
 * makes a contact at "50%" a real touch on a phone and on a wide monitor
 * rather than a near miss on one of them.
 */
export function MascotScene() {
  return (
    <div
      // Height is the tallest agent plus enough for the bob and the antenna,
      // and no more. The strip was half again as tall as they are, so three
      // agents sat along the bottom of an empty box and the space above them
      // read as a gap in the page rather than as room they were using.
      className="relative h-[86px] w-full select-none sm:h-[122px]"
      aria-label="Three Parley agents milling about"
    >
      {/* A faint floor, so they read as moving across something. */}
      <div className="absolute inset-x-0 bottom-3 h-px bg-gradient-to-r from-transparent via-edge to-transparent" />

      <div className="mascot-walk-a absolute bottom-0">
        <div className="mascot-bump-a">
          <Mascot className="size-[76px] sm:size-[108px]" hue={104} phase={-0.9} />
        </div>
      </div>

      <div className="mascot-walk-b absolute bottom-0">
        <div className="mascot-bump-b">
          <Mascot className="size-[68px] sm:size-[96px]" hue={150} phase={-2.6} />
        </div>
      </div>

      <div className="mascot-walk-c absolute bottom-1">
        <div className="mascot-bump-c">
          <Mascot className="size-[60px] sm:size-[84px]" hue={186} phase={-4.3} />
        </div>
      </div>
    </div>
  );
}
