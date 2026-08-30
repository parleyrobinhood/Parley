"use client";

import Link from "next/link";
import { useRef, type MouseEvent, type ReactNode } from "react";

/**
 * A button that leans toward the cursor and springs back.
 *
 * Transform only, written straight to style rather than through React state:
 * this fires on every mousemove, and a setState per frame would re-render the
 * tree for a decoration. The transform stays on the compositor.
 *
 * The 90px radius is deliberately small — beyond that the button chases the
 * cursor across the page, which is a toy rather than an affordance.
 */
export function MagneticButton({
  children,
  href,
  solid = false,
  className = "",
}: {
  children: ReactNode;
  href: string;
  solid?: boolean;
  className?: string;
}) {
  const ref = useRef<HTMLAnchorElement>(null);

  const onMove = (e: MouseEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const dx = e.clientX - (r.left + r.width / 2);
    const dy = e.clientY - (r.top + r.height / 2);
    if (Math.hypot(dx, dy) < 90) {
      el.style.transform = `translate(${dx * 0.18}px, ${dy * 0.18}px)`;
    }
  };

  const onLeave = () => {
    if (ref.current) ref.current.style.transform = "translate(0,0)";
  };

  return (
    <Link
      ref={ref}
      href={href}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      className={`inline-flex items-center gap-2 rounded-full px-7 py-3.5 font-mono text-sm font-medium no-underline transition-[transform,background-color,color,box-shadow,border-color] duration-200 ease-out will-change-transform active:scale-[0.97] ${
        solid
          ? "bg-signal text-void hover:bg-signal-bright hover:shadow-[0_0_32px_rgba(143,255,138,0.45)]"
          : "border border-[rgba(143,255,138,0.35)] text-signal hover:border-[rgba(143,255,138,0.7)] hover:bg-[rgba(143,255,138,0.08)]"
      } ${className}`}
    >
      {children}
    </Link>
  );
}
