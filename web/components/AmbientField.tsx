"use client";

import { useEffect, useRef } from "react";

/**
 * The drifting constellation behind every app page.
 *
 * Canvas rather than DOM nodes: seventy elements each moving every frame is a
 * layout-and-paint the browser has to reason about, where a canvas is one.
 *
 * It is decoration, so it yields on every axis that matters. `prefers-reduced-
 * motion` stops the loop after a single frame — the field is still drawn, so
 * the page keeps its texture, it simply stops moving. DPR is capped at 2
 * because a 3x retina canvas costs four times the fill for no visible gain.
 */
export function AmbientField({ points = 70 }: { points?: number }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    let w = 0;
    let h = 0;

    const resize = () => {
      w = window.innerWidth;
      h = window.innerHeight;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    // Positions are stored 0..1 and scaled at draw time, so a resize never
    // strands a point off-screen or bunches the field to one side.
    const pts = Array.from({ length: points }, () => ({
      x: Math.random(),
      y: Math.random(),
      vx: (Math.random() - 0.5) * 0.00025,
      vy: (Math.random() - 0.5) * 0.00025,
      r: 0.8 + Math.random() * 1.3,
    }));

    let raf = 0;
    const draw = () => {
      ctx.clearRect(0, 0, w, h);

      for (const p of pts) {
        // Wrap rather than bounce: a bounce makes the edges visible as walls.
        p.x = (p.x + p.vx + 1) % 1;
        p.y = (p.y + p.vy + 1) % 1;
        ctx.beginPath();
        ctx.arc(p.x * w, p.y * h, p.r, 0, Math.PI * 2);
        ctx.fillStyle = "rgba(143,255,138,0.28)";
        ctx.fill();
      }

      // Filaments between near neighbours. Squared distance, so the inner loop
      // avoids a square root it does not need to compare against a constant.
      ctx.strokeStyle = "rgba(143,255,138,0.035)";
      for (let i = 0; i < pts.length; i += 1) {
        for (let j = i + 1; j < pts.length; j += 1) {
          const a = pts[i];
          const b = pts[j];
          if (!a || !b) continue;
          const dx = (a.x - b.x) * w;
          const dy = (a.y - b.y) * h;
          if (dx * dx + dy * dy < 120 * 120) {
            ctx.beginPath();
            ctx.moveTo(a.x * w, a.y * h);
            ctx.lineTo(b.x * w, b.y * h);
            ctx.stroke();
          }
        }
      }

      if (!reduced) raf = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [points]);

  return (
    <canvas
      ref={ref}
      className="pointer-events-none fixed inset-0 h-full w-full opacity-60"
      aria-hidden="true"
    />
  );
}
