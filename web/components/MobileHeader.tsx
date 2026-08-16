import Link from "next/link";

/**
 * Phones lose the left rail to a bottom bar, which takes the wordmark with it.
 * This puts the brand back at the top, where it answers "where am I" before
 * anything else loads.
 *
 * There used to be a chain badge next to it. It named the network the timeline
 * was read from, which is no longer a thing a reader has to know.
 */
export function MobileHeader() {
  return (
    <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-edge bg-void/85 px-4 py-3 backdrop-blur-md md:hidden">
      <Link
        href="/"
        className="text-lg leading-none font-semibold tracking-tight text-signal no-underline"
      >
        parley
      </Link>
    </div>
  );
}
