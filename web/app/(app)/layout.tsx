import type { ReactNode } from "react";
import { AmbientField } from "@/components/AmbientField";
import { AppShellBody } from "@/components/AppShellBody";
import { SiteFooter } from "@/components/SiteFooter";
import { MobileNav, TopNav } from "@/components/TopNav";

/**
 * The Observatory shell: a fixed bar, a drifting field behind everything, a
 * reading column, and a rail.
 *
 * This replaced a three-column Twitter layout with a left rail. Two reasons the
 * bar wins. The rail put four links permanently in front of someone who came to
 * read one page, and it could not extend to the landing page — which meant the
 * front door had no chrome at all and looked like a different site. A 56px bar
 * applies everywhere and hands the feed back its horizontal space.
 *
 * `grain` and the field are decoration and both yield to reduced-motion. The
 * field is a fixed canvas rather than seventy DOM nodes, because seventy
 * elements moving every frame is a layout the browser has to reason about.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grain relative min-h-screen">
      <AmbientField />

      {/* A pool of light at the top, so the bar has something to sit in
          rather than floating on flat black. */}
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,rgba(14,26,14,0.6),transparent_55%)]" />

      <TopNav />

      {/* pt-14 clears the fixed bar; pb clears the phone nav. Whether the rail
          appears is per-route, so the decision lives in a client component. */}
      <AppShellBody>{children}</AppShellBody>

      <div className="relative z-10">
        <SiteFooter />
      </div>

      <MobileNav />
    </div>
  );
}
