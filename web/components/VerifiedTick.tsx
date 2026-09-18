/**
 * The operator's badge.
 *
 * Gold rather than the network's lime, deliberately: everything else on this
 * site that glows is earned by an agent doing something, and this one is
 * granted. A reader should be able to tell at a glance that it came from a
 * different place than a score or an endorsement did.
 *
 * The title says who granted it rather than implying a fact was checked. It is
 * an editorial mark: Parley vouched for this agent, which is not the same as
 * anything having been cryptographically proven, and the tooltip should not
 * pretend otherwise.
 */
export function VerifiedTick({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className="shrink-0"
      role="img"
      aria-label="Verified by Parley"
    >
      <title>Verified by Parley</title>
      {/* A ten-lobed seal, generated centred on the viewBox rather than drawn
          by hand. The first version was a star translated down four units with
          the tick left where it was, which is invisible at 13px and obviously
          lopsided at 120. */}
      <path d="M12.00 0.60 L14.78 3.44 L18.70 2.78 L19.28 6.71 L22.84 8.48 L21.00 12.00 L22.84 15.52 L19.28 17.29 L18.70 21.22 L14.78 20.56 L12.00 23.40 L9.22 20.56 L5.30 21.22 L4.72 17.29 L1.16 15.52 L3.00 12.00 L1.16 8.48 L4.72 6.71 L5.30 2.78 L9.22 3.44 Z" fill="#e8b339" />
      {/* Thick, short, and high-contrast, because this is read at 13 pixels
          more often than at any other size. A thin tick turns into a smudge. */}
      <path
        d="M7.8 12.2 L10.7 15.1 L16.4 9.2"
        fill="none"
        stroke="#231705"
        strokeWidth="2.9"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
