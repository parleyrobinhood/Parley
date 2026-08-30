"use client";

import { useEffect, useRef, useState } from "react";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import gsap from "gsap";

gsap.registerPlugin(ScrollTrigger);

/**
 * A terminal-styled code card with a copy button, optionally typing itself in
 * when scrolled to.
 *
 * Shared by the landing page's Connect section and the /connect page, which
 * show the same three steps. Two copies of a typewriter that has to agree on
 * what "the SDK looks like this" means is two places to forget to update.
 */
export function TerminalCard({
  step,
  title,
  code,
  typed = false,
}: {
  step: string;
  title: string;
  code: string;
  typed?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [shown, setShown] = useState(typed ? "" : code);
  const [done, setDone] = useState(!typed);
  const codeRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    if (!typed) return;

    // Reduced motion gets the whole snippet immediately — the content is the
    // point, and withholding it to preserve an effect nobody asked for would
    // be the wrong trade.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(code);
      setDone(true);
      return;
    }

    let interval: number | undefined;
    const trigger = ScrollTrigger.create({
      trigger: codeRef.current,
      start: "top 78%",
      once: true,
      onEnter: () => {
        let i = 0;
        interval = window.setInterval(() => {
          // Three characters a tick: one is unbearably slow for 500 characters,
          // and the eye cannot tell the difference at this speed anyway.
          i += 3;
          setShown(code.slice(0, i));
          if (i >= code.length) {
            window.clearInterval(interval);
            setDone(true);
          }
        }, 14);
      },
    });

    return () => {
      trigger.kill();
      if (interval) window.clearInterval(interval);
    };
  }, [typed, code]);

  const copy = async () => {
    try {
      // Always copies the full snippet, never the half that has been typed so
      // far — a copy button that yields a truncated file is a trap.
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked; the code is selectable either way */
    }
  };

  return (
    <div data-step className="card-line flex flex-col overflow-hidden rounded-xl bg-[#0A0F0A]">
      <div className="flex items-center justify-between border-b border-[rgba(143,255,138,0.08)] px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="font-mono text-[11px] text-signal/70">{step}</span>
          <span className="font-mono text-[13px] text-ink">{title}</span>
        </div>
        <button
          type="button"
          onClick={copy}
          className="flex items-center gap-1.5 font-mono text-[11px] text-faint transition-colors hover:text-signal active:scale-95"
        >
          <span aria-hidden="true" className={copied ? "text-signal" : ""}>
            {copied ? "✓" : "⧉"}
          </span>
          {copied ? "copied" : "copy"}
          <span className="sr-only">{copied ? "Copied" : "Copy code"}</span>
        </button>
      </div>

      <pre
        ref={codeRef}
        className={`flex-1 overflow-x-auto p-4 font-mono text-[12.5px] leading-relaxed whitespace-pre text-[#B9CCB9] ${
          typed && !done ? "caret" : ""
        }`}
      >
        {shown}
      </pre>
    </div>
  );
}
