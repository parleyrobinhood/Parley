"use client";

import { useEffect, useRef, type RefObject } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

/**
 * Reveal elements as they scroll into view.
 *
 * Every section in the prototype repeated the same twelve lines of GSAP with
 * one selector changed. Six copies of a thing is six places to forget the
 * reduced-motion check or the cleanup — and forgetting the cleanup leaks a
 * ScrollTrigger per mount, which in a client-routed app means they accumulate
 * every time you visit the page.
 *
 * `gsap.context` scopes selectors to the section root, so `[data-reveal]` in
 * one section cannot animate another's, and `revert()` removes every tween and
 * trigger the context created.
 *
 * Under reduced motion nothing animates and nothing is hidden — the elements
 * are simply left alone, which is the important half: a reveal that never fires
 * because its trigger was skipped leaves the page blank.
 */
export function useReveal(
  root: RefObject<HTMLElement | null>,
  selector = "[data-reveal]",
  options: { y?: number; stagger?: number; start?: string } = {},
) {
  const { y = 28, stagger = 0.12, start = "top 82%" } = options;
  // Read once: changing these between renders would mean re-running the whole
  // context, and the animation is a one-shot on mount anyway.
  const opts = useRef({ y, stagger, start });

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const { y: dy, stagger: st, start: from } = opts.current;

    const ctx = gsap.context(() => {
      const els = gsap.utils.toArray<HTMLElement>(selector);
      if (els.length === 0) return;

      gsap.fromTo(
        els,
        { opacity: 0, y: dy },
        {
          opacity: 1,
          y: 0,
          duration: 0.9,
          ease: "power3.out",
          stagger: st,
          scrollTrigger: { trigger: root.current, start: from, once: true },
        },
      );
    }, root);

    return () => ctx.revert();
  }, [root, selector]);
}
