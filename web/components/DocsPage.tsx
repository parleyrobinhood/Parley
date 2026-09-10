import Link from "next/link";
import type { ReactNode } from "react";
import { docsEntry, docsNeighbours } from "@/lib/docs-map";

/**
 * The furniture every documentation page shares.
 *
 * The summary under the title comes from the docs map rather than the page, so
 * the one line describing a page is the same line the index and the sidebar
 * would show. A page cannot describe itself one way here and another way where
 * it is linked from.
 */
export function DocsPage({
  href,
  eyebrow,
  title,
  intro,
  children,
}: {
  /** This page's own path, used for the summary and the next link. */
  href: string;
  eyebrow: string;
  title: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  const summary = docsEntry(href)?.summary;
  const { next } = docsNeighbours(href);

  return (
    // Wider than the text wants to be, because the panel's padding comes out of
    // it. At `max-w-2xl` the frame was taking 4.5rem off the measure and the
    // page read as though the type had shrunk.
    <div className="max-w-3xl">
      {/*
        The reading column is a panel rather than bare page.
        Two reasons beyond taste: the ambient field drifts behind everything on
        this site, and a slightly opaque ground under long-form text stops it
        competing with the words. It also gives the documentation an edge, so a
        reference table reads as being inside something rather than floating.
      */}
      <article className="card-line rounded-2xl bg-surface/50 px-5 py-7 sm:px-10 sm:py-11">
        <p className="overline-label mb-3">{eyebrow}</p>
        <h1 className="font-display text-[clamp(1.9rem,4vw,2.6rem)] leading-[1.06] font-medium tracking-tight text-balance text-ink">
          {title}
        </h1>
        {summary && <p className="mt-3 text-[17px] leading-relaxed text-faint">{summary}</p>}

        {intro && (
          <div className="mt-6 border-t border-edge pt-6 text-[16.5px] leading-relaxed text-dim">
            {intro}
          </div>
        )}

        <div className="mt-10 space-y-10">{children}</div>
      </article>

      {/* Outside the panel: this is a way out of the page, not part of it. */}
      {next && (
        <Link
          href={next.href}
          className="group mt-4 flex items-center justify-between gap-4 rounded-xl border border-edge bg-surface/50 px-5 py-4 no-underline transition-colors hover:border-edge-strong hover:bg-surface"
        >
          <span className="min-w-0">
            <span className="overline-label block">Next</span>
            <span className="mt-1 block font-display text-[1.05rem] font-medium text-ink">
              {next.label}
            </span>
            <span className="mt-0.5 block text-[13.5px] text-faint">{next.summary}</span>
          </span>
          <span
            aria-hidden="true"
            className="shrink-0 font-mono text-signal transition-transform group-hover:translate-x-0.5"
          >
            →
          </span>
        </Link>
      )}
    </div>
  );
}

/** A titled block. Anchored so a link can point straight at it. */
export function Block({
  id,
  title,
  children,
}: {
  id?: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-20 border-t border-edge pt-8 first:border-t-0 first:pt-0">
      <h2 className="font-display text-[1.35rem] leading-tight font-medium tracking-tight text-balance text-ink">
        {title}
      </h2>
      <div className="mt-4 space-y-4 text-[16.5px] leading-relaxed text-dim">{children}</div>
    </section>
  );
}

/** A claim in bold, then why it is true. */
export function Point({ term, children }: { term: string; children: ReactNode }) {
  return (
    <p>
      <strong className="font-medium text-ink">{term}</strong> {children}
    </p>
  );
}

/** Inline code, at a size that sits on the line rather than above it. */
export function C({ children }: { children: ReactNode }) {
  return (
    // `anywhere` rather than `break-word`: an identifier like
    // `x-parley-address` has nowhere to break, and inside a narrow table cell
    // it was running under the panel's padding and being clipped mid-token.
    <code className="rounded bg-signal-soft px-1.5 py-0.5 font-mono text-[13.5px] text-signal [overflow-wrap:anywhere]">
      {children}
    </code>
  );
}

/** A shell or code sample. Scrolls itself so the page never does. */
export function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-xl border border-edge bg-void/70 p-4 font-mono text-[13.5px] leading-relaxed text-dim">
      <code>{children}</code>
    </pre>
  );
}

/** Something worth stopping for. Amber, because the palette uses it for cost. */
export function Note({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-r-xl border-l-2 border-warn/40 bg-warn/[0.06] py-3.5 pr-4 pl-4">
      <p className="font-mono text-[11px] tracking-[0.14em] text-warn uppercase">{title}</p>
      <div className="mt-1.5 space-y-2 text-[15.5px] leading-relaxed text-dim">{children}</div>
    </div>
  );
}

/** A reference table that scrolls rather than pushing the page sideways. */
export function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto">
      {/* The floor applies from `sm` up, where a two-column table needs the
          room. Below it, letting the cells wrap reads better than a table that
          scrolls sideways under the reader's thumb. */}
      <table className="w-full border-collapse text-[15px] sm:min-w-[30rem]">
        <thead>
          <tr>
            {head.map((cell) => (
              <th
                key={cell}
                className="border-b border-edge py-2 pr-4 text-left font-mono text-[11px] font-medium tracking-[0.12em] text-faint uppercase"
              >
                {cell}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            // eslint-disable-next-line react/no-array-index-key -- rows are positional
            <tr key={i}>
              {row.map((cell, j) => (
                // eslint-disable-next-line react/no-array-index-key -- cells are positional
                <td key={j} className="border-b border-edge py-2.5 pr-4 align-top text-dim">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
