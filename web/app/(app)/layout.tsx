import type { ReactNode } from "react";
import { MobileHeader } from "@/components/MobileHeader";
import { RightRail } from "@/components/RightRail";
import { SiteFooter } from "@/components/SiteFooter";
import { MobileNav, SidebarRail } from "@/components/Sidebar";

/**
 * The reading shell: rails, nav, and a column to read in.
 *
 * It lives in a route group so the landing page at `/` can sit outside it. A
 * front door with a sidebar and a trending panel is not a front door, and
 * conditionally hiding the chrome from inside the root layout would mean the
 * layout knowing which route it is rendering.
 */
export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <>
      {/*
        Full width, rails on the screen edges.

        This used to be `mx-auto max-w-6xl`, which parked the whole application
        in a 1152px column and left a few hundred pixels of dead black down each
        side of any real monitor — it read as a window sitting on a desktop
        rather than as a site. The cap is gone: the rails now anchor to the
        viewport edges and `main` takes everything between them.

        The reading column keeps its measure regardless, because the cap moved
        inward — `main` fills the row, and the text inside it is centred at a
        readable width. Wide screens get more chrome and more breathing room,
        not longer lines. That distinction is the whole point; stretching the
        posts themselves to 1600px would make the site worse, not fuller.

        Below lg the right rail drops and its content lives on /explore; below
        md the left rail becomes a bottom bar, and the padding clears it.
      */}
      <div className="flex w-full justify-center">
        {/*
          The rails take the slack and pin themselves to the outer edges, while
          `main` stays exactly one reading column wide. Giving `main` the slack
          instead left a wide bordered box with a narrow column floating inside
          it, which looked like a mistake rather than a measure.
        */}
        <div className="hidden md:flex md:flex-1 md:justify-start md:pl-2 xl:pl-6">
          <div className="w-[84px] xl:w-[248px]">
            <SidebarRail />
          </div>
        </div>

        <main className="w-full min-w-0 border-edge/70 pb-20 md:w-[688px] md:shrink-0 md:border-x md:pb-10">
          <MobileHeader />
          {children}
        </main>

        <div className="hidden lg:flex lg:flex-1 lg:justify-end lg:pr-2 xl:pr-6">
          <div className="w-[320px] xl:w-[368px]">
            <RightRail />
          </div>
        </div>
      </div>

      {/* Full width, below the rails rather than inside the reading column:
          it is site chrome, not the end of the timeline. */}
      <SiteFooter />

      <MobileNav />
    </>
  );
}
