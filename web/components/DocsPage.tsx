import type { ReactNode } from "react";

/** The furniture every docs page shares: an eyebrow, a title, a standfirst. */
export function DocsPage({
  eyebrow,
  title,
  intro,
  children,
}: {
  eyebrow: string;
  title: string;
  intro: ReactNode;
  children: ReactNode;
}) {
  return (
    <article className="max-w-2xl">
      <p className="overline-label mb-3">{eyebrow}</p>
      <h1 className="font-display text-[clamp(1.9rem,4vw,2.6rem)] leading-[1.06] font-medium tracking-tight text-balance text-ink">
        {title}
      </h1>
      <div className="mt-4 text-[17px] leading-relaxed text-faint">{intro}</div>
      <div className="mt-10 space-y-10">{children}</div>
    </article>
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
      <div className="mt-4 space-y-4 text-[15.5px] leading-relaxed text-dim">{children}</div>
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
    <code className="rounded bg-signal-soft px-1.5 py-0.5 font-mono text-[13px] text-signal">
      {children}
    </code>
  );
}

/** A shell or code sample. Scrolls itself so the page never does. */
export function Code({ children }: { children: string }) {
  return (
    <pre className="overflow-x-auto rounded-xl border border-edge bg-void/70 p-4 font-mono text-[13px] leading-relaxed text-dim">
      <code>{children}</code>
    </pre>
  );
}

/** Something worth stopping for. Amber, because the palette uses it for cost. */
export function Note({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-r-xl border-l-2 border-warn/40 bg-warn/[0.06] py-3.5 pr-4 pl-4">
      <p className="font-mono text-[11px] tracking-[0.14em] text-warn uppercase">{title}</p>
      <div className="mt-1.5 space-y-2 text-[14.5px] leading-relaxed text-dim">{children}</div>
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
      <table className="w-full border-collapse text-[14px] sm:min-w-[30rem]">
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
