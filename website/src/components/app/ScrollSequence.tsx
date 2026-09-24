"use client";

import { useEffect, useRef, useState } from "react";
import { AppPlate } from "@/components/app/AppPlate";
import { cn } from "@/lib/cn";
import { product } from "@/lib/product";
import {
  CHAPTERS,
  REEL,
  STEPS,
  VIEW_FRAMES,
  playheadAt,
  playheadKeyframes,
  stateAt,
} from "@/lib/sequence";

/** Computed once, at build time: the playhead's path through the sequence as CSS. */
const PLAYHEAD_KEYFRAMES = playheadKeyframes();

/**
 * The figure, held while the build plays out in it.
 *
 * It runs wider than the 1080px column every other section obeys. That is
 * deliberate and it is the only place on the site it happens: the figure has to
 * carry a conversation and an editor at once, and squeezed into the text column
 * neither is readable.
 *
 * Two modes, and the static one is the default. `static` gives every beat its
 * own figure, stacked, and is what renders with no script, on a narrow viewport,
 * and under `prefers-reduced-motion`. It is the whole story rather than a
 * summary of it. `pinned` is switched on after mount, on a wide viewport, with
 * motion allowed, and then one figure is held while scroll advances it.
 *
 * Scroll position drives one integer. Everything else is a CSS transition off
 * it, so scrolling does not re-render the figure on every frame.
 */

const FIGURE = "mx-auto w-full max-w-[1560px] px-5 sm:px-8";

function Caption() {
  const status = (
    <a
      href="/status"
      className="text-accent underline decoration-accent/40 underline-offset-2 transition-colors hover:text-on-night"
    >
      What actually runs today
    </a>
  );

  // The same claims in fewer words where there is less room. A phone still gets
  // the two that matter: the window is drawn, and the edit is real.
  return (
    <p className="mt-2.5 max-w-[84ch] text-xs leading-relaxed text-on-night-muted sm:mt-4">
      <span className="font-medium text-on-night-soft">Fig. 1</span>{" "}
      <span className="sm:hidden">
        The window is drawn; the edit, its frames and its tool calls are real.{" "}
        {status}.
      </span>
      <span className="hidden sm:inline">
        The window is a re-creation of {product.name}, drawn from its own theme
        and layout source. What happens in it is a real edit made in the current
        app: the pictures in the preview are frames it rendered at each step, and
        the tool calls are the ones it ran, in order, with paths shortened and 36
        export polls shown as two. The agent&rsquo;s sentences were written for
        the session. The result: {REEL.title}, {REEL.width}×{REEL.height} at{" "}
        {REEL.fps}fps, {REEL.seconds}s. Footage from Pexels; see the{" "}
        <a
          href="#credits"
          className="underline underline-offset-2 transition-colors hover:text-on-night"
        >
          credits
        </a>
        . {status}.
      </span>
    </p>
  );
}

function Note({ chapter }: { chapter: (typeof CHAPTERS)[number] }) {
  return (
    <>
      <h3 className="text-lead font-semibold text-on-night sm:text-section">
        {chapter.title}
      </h3>
      <p className="mt-2 max-w-[74ch] text-base text-on-night-soft">
        <span className="sm:hidden">{chapter.short}</span>
        <span className="hidden sm:inline">{chapter.body}</span>
      </p>
    </>
  );
}

export function ScrollSequence() {
  const section = useRef<HTMLElement>(null);
  const [pinned, setPinned] = useState(false);
  const [step, setStep] = useState(STEPS.length - 1);

  useEffect(() => {
    const still = window.matchMedia("(prefers-reduced-motion: reduce)");

    // Width is not the question. A phone reads this sequence as well as a
    // laptop, with the conversation stacked under the editor. Height is the
    // question: pinning a figure taller than the window would cut its bottom
    // off, so a short window gets the stacked fallback instead.
    const decide = () => {
      const pin = !still.matches && window.innerHeight >= 640;
      setPinned(pin);
      if (!pin) setStep(STEPS.length - 1);
    };

    decide();
    still.addEventListener("change", decide);
    window.addEventListener("resize", decide);
    return () => {
      still.removeEventListener("change", decide);
      window.removeEventListener("resize", decide);
    };
  }, []);

  useEffect(() => {
    if (!pinned) return;
    let frame = 0;
    const scrollTimelines = CSS.supports("animation-timeline: view()");

    const measure = () => {
      frame = 0;
      const el = section.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const travel = rect.height - window.innerHeight;
      if (travel <= 0) return;
      const p = Math.min(1, Math.max(0, -rect.top / travel));
      // Where the browser cannot run the playhead off a scroll timeline, it is
      // moved here, from the same curve the CSS keyframes are written from.
      if (!scrollTimelines) {
        const head = el.querySelector<HTMLElement>("[data-plate-playhead]");
        if (head) head.style.translate = `${((playheadAt(p) / VIEW_FRAMES) * 100).toFixed(3)}% 0`;
      }
      // Floor over equal bands, so every step holds for the same stretch of
      // scroll. Rounding would give the first and last steps half a band each,
      // and the last band is the one the sequence is built toward.
      setStep(Math.min(STEPS.length - 1, Math.floor(p * STEPS.length)));
    };

    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };

    measure();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [pinned]);

  // Static: one figure per beat, so nothing about the sequence depends on a
  // scroll ever happening.
  if (!pinned) {
    return (
      <section aria-label={`${product.name} editing four clips, step by step`}>
        <ol className="grid gap-16">
          {CHAPTERS.map((c, i) => {
            // Each chapter is shown at its last step, which is the state it
            // leaves the editor in.
            const last = STEPS.reduce(
              (found, s, n) => (s.chapter === i ? n : found),
              0,
            );
            return (
              <li key={c.eyebrow} data-depth-root>
                <div className={FIGURE}>
                  <div className="max-w-[74ch]">
                    <Note chapter={c} />
                  </div>
                  <div data-depth="enter" className="mt-6 min-w-0">
                    <AppPlate step={last} />
                    {i === 0 ? <Caption /> : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ol>
      </section>
    );
  }

  const chapter = stateAt(step).chapter;

  return (
    <section
      ref={section}
      aria-label={`${product.name} editing four clips, step by step`}
      className="relative"
      // A fifth of a screen of scroll per step, plus a screen to settle on
      // the last: long enough to read a line, short enough that a 58-step edit
      // does not take a hundred scroll gestures to watch.
      style={{ height: `${Math.round(STEPS.length * 22 + 100)}vh` }}
      data-depth-root
      data-plate
    >
      <style>{PLAYHEAD_KEYFRAMES}</style>
      <div className="sticky top-0 flex min-h-screen flex-col justify-center py-2 sm:py-4">
        <div className={FIGURE}>
          {/* The note holds a fixed height so the figure underneath never moves
              as the beats change. A figure that jogged on every beat would read
              as a bug. */}
          <div className="relative mb-3 min-h-[104px] sm:mb-4 sm:min-h-[112px]">
            {CHAPTERS.map((c, i) => (
              <div
                key={c.eyebrow}
                aria-current={i === chapter ? "step" : undefined}
                className={cn(
                  "absolute inset-x-0 top-0 transition-[opacity,transform] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]",
                  i === chapter
                    ? "translate-y-0 opacity-100"
                    : "pointer-events-none translate-y-2 opacity-0",
                )}
              >
                <Note chapter={c} />
              </div>
            ))}
          </div>

          {/* Depth: the plate arrives a little behind the page and settles as
              it pins, so it reads as a leaf set beneath the paper. The note
              above it moves with the page. See DESIGN.md, "Depth". */}
          <div data-depth="enter">
            <AppPlate step={step} live />
            <Caption />

            {/* A rule that keeps drawing as the sequence advances. The site draws
                rules; this is the same gesture, held open across six beats. It
                is a transform, not a width, so advancing it lays nothing out. */}
            <div aria-hidden className="mt-2.5 h-px w-full bg-night-line sm:mt-6">
              <div
                className="h-px w-full origin-left bg-accent transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
                style={{ transform: `scaleX(${(step + 1) / STEPS.length})` }}
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
