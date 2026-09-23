"use client";

import { useEffect, useRef, useState } from "react";
import { AppPlate } from "@/components/app/AppPlate";
import { cn } from "@/lib/cn";
import { product } from "@/lib/product";
import { CHAPTERS, REEL, STEPS, stateAt } from "@/lib/sequence";

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

const FIGURE = "mx-auto w-full max-w-[1560px] px-4 sm:px-8";

function Caption() {
  const status = (
    <a
      href="/status"
      className="text-brass-deep underline underline-offset-2 transition-colors hover:text-ink"
    >
      What actually runs today
    </a>
  );

  // The same claims in fewer words where there is less room. A phone still gets
  // the two that matter: this is a re-creation, and the build is real.
  return (
    <p className="mt-2.5 max-w-[78ch] text-xs leading-relaxed text-muted sm:mt-4">
      <span className="text-brass-deep">Fig. 1</span> &middot;{" "}
      <span className="sm:hidden">
        A re-creation, not a capture. {status}.
      </span>
      <span className="hidden sm:inline">
        The editor is a re-creation of {product.name}, drawn from its own theme
        and layout source rather than captured from a screen. The build is real:{" "}
        {REEL.title}, {REEL.width}×{REEL.height} at {REEL.fps}fps,{" "}
        {REEL.seconds}s, {REEL.codec}. Every tool name in the log is one the
        engine has. {status}.
      </span>
    </p>
  );
}

function Note({ chapter }: { chapter: (typeof CHAPTERS)[number] }) {
  return (
    <>
      <p className="text-eyebrow font-medium text-brass-deep uppercase">
        {chapter.eyebrow}
      </p>
      <h3 className="mt-2.5 font-serif text-lead font-normal text-ink sm:text-section">
        {chapter.title}
      </h3>
      <p className="mt-3 max-w-[74ch] text-base text-ink-soft">
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

    const measure = () => {
      frame = 0;
      const el = section.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const travel = rect.height - window.innerHeight;
      if (travel <= 0) return;
      const p = Math.min(1, Math.max(0, -rect.top / travel));
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
      <section aria-label={`${product.name} building a reel, step by step`}>
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
      aria-label={`${product.name} building a reel, step by step`}
      className="relative h-[1000vh]"
      data-depth-root
    >
      <div className="sticky top-0 flex min-h-screen flex-col justify-center py-2 sm:py-8">
        <div className={FIGURE}>
          {/* The note holds a fixed height so the figure underneath never moves
              as the beats change. A figure that jogged on every beat would read
              as a bug. */}
          <div className="relative mb-3 min-h-[132px] sm:mb-5 sm:min-h-[150px]">
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
            <AppPlate step={step} />
            <Caption />

            {/* A rule that keeps drawing as the sequence advances. The site draws
                rules; this is the same gesture, held open across six beats. It
                is a transform, not a width, so advancing it lays nothing out. */}
            <div aria-hidden className="mt-2.5 h-px w-full bg-line sm:mt-6">
              <div
                className="h-px w-full origin-left bg-brass transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)]"
                style={{ transform: `scaleX(${(step + 1) / STEPS.length})` }}
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
