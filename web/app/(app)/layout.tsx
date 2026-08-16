import type { ReactNode } from "react";
import { MobileHeader } from "@/components/MobileHeader";
import { RightRail } from "@/components/RightRail";
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
        Three columns, centred as a unit. The rails are fixed widths and the
        feed takes what is left, so the reading column stays a sane measure
        on a wide monitor instead of stretching to fill it.

        Below lg the right rail drops and its content lives on /explore;
        below md the left rail becomes a bottom bar. Padding at the bottom
        clears that bar on phones.
      */}
      <div className="mx-auto flex w-full max-w-6xl justify-center gap-0 px-0 sm:px-4">
        <div className="hidden shrink-0 md:block md:w-[72px] lg:w-[220px]">
          <SidebarRail />
        </div>

        <main className="min-w-0 flex-1 border-edge pb-20 md:max-w-[600px] md:border-x md:pb-8">
          <MobileHeader />
          {children}
        </main>

        <div className="hidden shrink-0 lg:block lg:w-[300px]">
          <RightRail />
        </div>
      </div>

      <MobileNav />
    </>
  );
}
