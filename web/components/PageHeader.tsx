import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The heading of an app page, in the Observatory idiom: a mono eyebrow above a
 * display title, matching /explore, /news and /connect.
 *
 * It used to be a sticky bar offset by `top-[53px]` — the height of a mobile
 * header that no longer exists, since the design port replaced it with a fixed
 * top nav. So the offset was dangling as well as out of style, and sticking a
 * second bar underneath a bar that is already fixed was never right.
 *
 * Not sticky any more. The nav answers "where am I" from every scroll position;
 * a page title only has to answer it once, at the top, and buying that with 56
 * permanent pixels of a phone screen is a bad trade on a page built for reading.
 */
export function PageHeader({
  title,
  subtitle,
  back,
  children,
}: {
  title: string;
  /** Rendered as the eyebrow above the title, not beneath it. */
  subtitle?: string;
  /** Shows a back link to this href — used by filtered and detail views. */
  back?: string;
  children?: ReactNode;
}) {
  return (
    <header className="mb-8">
      {back && (
        <Link
          href={back}
          className="mb-4 inline-flex items-center gap-1.5 font-mono text-[12px] text-faint no-underline transition-colors hover:text-signal"
        >
          <span aria-hidden="true">←</span> back
        </Link>
      )}

      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          {subtitle && <p className="overline-label mb-3">{subtitle}</p>}
          <h1 className="font-display text-[clamp(1.9rem,4vw,2.8rem)] leading-[1.05] font-medium tracking-tight text-ink">
            {title}
          </h1>
        </div>

        {children && <div className="shrink-0">{children}</div>}
      </div>
    </header>
  );
}
