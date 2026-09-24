"use client";

import { useEffect } from "react";

/**
 * Depth, for browsers without scroll-driven animations.
 *
 * The real implementation is CSS (`[data-depth]` in globals.css): the browser
 * runs it on the compositor with no script at all. This component does nothing
 * where that works. Elsewhere it reproduces the same three curves with one
 * passive scroll listener, throttled to an animation frame, that reads every
 * rectangle first and then writes every `translate`, so a frame never
 * interleaves a read with a write and forces layout twice.
 *
 * Under `prefers-reduced-motion` it does nothing, as the CSS does nothing.
 */
export function DepthFallback() {
  useEffect(() => {
    if (typeof CSS !== "undefined" && CSS.supports("animation-timeline: view()")) {
      return;
    }
    const still = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (still.matches) return;

    type Param = {
      el: HTMLElement;
      kind: string | undefined;
      depth: number;
      fade: number;
      root: HTMLElement | null;
    };
    const num = (el: HTMLElement, name: string, fallback: number) => {
      const v = parseFloat(getComputedStyle(el).getPropertyValue(name));
      return Number.isFinite(v) ? v : fallback;
    };
    // Each element's parameters are read once. The set of elements is queried
    // per frame, because the scroll sequence swaps its markup after mount.
    const cache = new WeakMap<HTMLElement, Param>();
    const touched = new Set<HTMLElement>();
    const paramsNow = () =>
      Array.from(document.querySelectorAll<HTMLElement>("[data-depth]"), (el) => {
        let p = cache.get(el);
        if (!p) {
          p = {
            el,
            kind: el.dataset.depth,
            depth: num(el, "--depth", 0),
            fade: num(el, "--fade", 1),
            root: el.closest<HTMLElement>("[data-depth-root]") ?? el.parentElement,
          };
          cache.set(el, p);
          touched.add(el);
        }
        return p;
      });

    const clamp = (x: number) => Math.min(1, Math.max(0, x));
    let frame = 0;

    const apply = () => {
      frame = 0;
      const vh = window.innerHeight;
      const y = window.scrollY;
      const params = paramsNow();
      // Reads first.
      const rects = params.map((p) =>
        p.kind === "peel" || p.kind === "lift" || !p.root ? null : p.root.getBoundingClientRect(),
      );
      // Then writes.
      params.forEach((p, i) => {
        const r = rects[i];
        if (p.kind === "peel") {
          const t = clamp(y / vh);
          p.el.style.translate = `0 ${(-p.depth * vh * t).toFixed(2)}px`;
          p.el.style.opacity = String(1 + (p.fade - 1) * t);
        } else if (p.kind === "enter" && r) {
          // Matches `entry 0%` to `entry 100%` on the root's view timeline,
          // and --enter (6vh) in globals.css. Keep the two in step.
          const span = r.height >= vh ? vh : r.height;
          const t = clamp((vh - r.top) / span);
          p.el.style.translate = `0 ${(0.06 * vh * (1 - t)).toFixed(2)}px`;
        } else if (p.kind === "lift") {
          // Matches `0` to `70vh` on the root scroll timeline, and --lift
          // (0.92) in globals.css. Keep the two in step.
          const t = clamp(y / (0.7 * vh));
          p.el.style.scale = String(0.92 + 0.08 * t);
        }
      });
    };

    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(apply);
    };

    apply();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      for (const el of touched) {
        el.style.translate = "";
        el.style.opacity = "";
        el.style.scale = "";
      }
    };
  }, []);

  return null;
}
