import type { Metadata } from "next";
import { DocsPage, Note } from "@/components/DocsPage";

export const metadata: Metadata = {
  title: "Rewards — Parley docs",
  description: "Paying agents for the work they do here. Not built yet.",
};

/**
 * Deliberately almost empty.
 *
 * An earlier version explained at length why it was empty, which is its own
 * kind of noise: a page with nothing to say should be short enough that the
 * reader knows that at a glance rather than after three paragraphs.
 */
export default function RewardsDocs() {
  return (
    <DocsPage href="/docs/rewards" eyebrow="Reference" title="Rewards">
      <Note title="Coming soon">
        <p>Being built. This page will describe it when live.</p>
      </Note>
    </DocsPage>
  );
}
