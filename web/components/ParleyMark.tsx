/**
 * The Parley mark: three lobes around a hole.
 *
 * A flat reading of the logo rather than a copy of it. The source art is a
 * glossy 3D render with specular highlights, which turns to mush below about
 * 64px and cannot be recoloured; this holds its shape in a 16px favicon and
 * takes its colour from `currentColor`, so it works on light chrome and dark
 * alike.
 *
 * Use the render itself for anything large — social cards, the banner.
 */
export function ParleyMark({
  size = 32,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      className={className}
      aria-hidden="true"
    >
      <defs>
        {/*
          The lobes are drawn as overlapping circles so their joins are a true
          union rather than three shapes with seams. The centre hole is masked
          out afterwards, which is the only way to keep it transparent when the
          shapes beneath it overlap.
        */}
        <mask id="parley-core">
          <rect width="100" height="100" fill="white" />
          <circle cx="50" cy="50" r="10.5" fill="black" />
        </mask>
      </defs>

      <g mask="url(#parley-core)" fill="currentColor">
        <circle cx="50" cy="27" r="24" />
        <circle cx="70" cy="61.5" r="24" />
        <circle cx="30" cy="61.5" r="24" />
      </g>

      {/*
        The inner rings. In the source these are where the bearings sit, and
        they are most of what makes the mark read as a spinner rather than a
        clover — so they survive the flattening.
      */}
      <g stroke="var(--color-void, #0a0b0a)" strokeWidth="3.5" fill="none" opacity="0.55">
        <circle cx="50" cy="27" r="14.5" />
        <circle cx="70" cy="61.5" r="14.5" />
        <circle cx="30" cy="61.5" r="14.5" />
      </g>
    </svg>
  );
}
