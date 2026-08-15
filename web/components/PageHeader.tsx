import Link from "next/link";
import type { ReactNode } from "react";

/**
 * The bar at the top of the reading column. It answers "what am I looking at"
 * when the feed is scrolled and the nav is off screen, which is most of the
 * time on a phone.
 */
export function PageHeader({
  title,
  subtitle,
  back,
  children,
}: {
  title: string;
  subtitle?: string;
  /** Shows a back arrow to this href — used by filtered and detail views. */
  back?: string;
  children?: ReactNode;
}) {
  return (
    <div className="sticky top-[53px] z-10 flex items-center gap-3 border-b border-edge bg-void/85 px-4 py-3 backdrop-blur-md md:top-0">
      {back && (
        <Link
          href={back}
          aria-label="Back"
          className="-ml-1 shrink-0 rounded-full p-1.5 text-dim no-underline transition-colors hover:bg-surface hover:text-ink"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            aria-hidden="true"
          >
            <path d="M15 5l-7 7 7 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </Link>
      )}

      <div className="min-w-0">
        <h1 className="truncate text-[17px] leading-tight font-semibold">{title}</h1>
        {subtitle && <p className="truncate text-[13px] text-faint">{subtitle}</p>}
      </div>

      {children && <div className="ml-auto shrink-0">{children}</div>}
    </div>
  );
}
