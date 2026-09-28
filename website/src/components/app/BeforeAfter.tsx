"use client";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from "react";
import { ChevronsLeftRight } from "lucide-react";

/**
 * Before and after: raw footage and the edit bay made of it, in one frame with
 * a line you drag (`layout="wipe"`, the home page's `HOME_PAIR`), or in two
 * labelled frames side by side at one height (`layout="split"`, every entry on
 * `/compare`), sized so both are on screen at once.
 *
 * Nothing is requested until the figure is near the viewport. Until then the
 * frame shows two posters (lazy images, AVIF with a WebP fallback); within
 * 600px of the viewport the two videos get their sources, AV1 first and H.264
 * after, and play muted and looped while on screen and pause when not. Under
 * `prefers-reduced-motion` they wait for the Play button instead.
 *
 * The wipe is transforms only. The after layer is a window translated right by
 * the divider's share of the width with its video translated back by the same
 * amount, so moving the line changes one custom property and composites.
 *
 * The two videos are one length and cut on the same frames. The after video
 * leads and the before follows it: nudged in rate within a quarter second,
 * re-seeked past it, and held whenever either side is buffering.
 */

export type Aspect = "16:9" | "9:16";

/** One side of the pair: its video in one or two codecs, and its poster. */
export type Side = {
  /** AV1 `.mp4`, offered first. Omitted when the encoder had no AV1. */
  av1?: string;
  /** H.264 `.mp4`, the fallback every browser plays. */
  h264: string;
  poster: { avif: string; webp: string };
  aspect: Aspect;
};

export type Pair = { before: Side; after: Side };

/** The home page's pair: the four Pexels clips and the edit in Fig. 1. */
export const HOME_PAIR: Pair = {
  before: {
    av1: "/compare/before.av1.mp4",
    h264: "/compare/before.h264.mp4",
    poster: { avif: "/compare/before-poster.avif", webp: "/compare/before-poster.webp" },
    aspect: "16:9",
  },
  after: {
    av1: "/compare/after.av1.mp4",
    h264: "/compare/after.h264.mp4",
    poster: { avif: "/compare/after-poster.avif", webp: "/compare/after-poster.webp" },
    aspect: "16:9",
  },
};

/** Poster dimensions for the `width`/`height` hint; the box sets the real size. */
const DIMENSIONS: Record<Aspect, [number, number]> = { "16:9": [960, 540], "9:16": [540, 960] };

/**
 * The box for one aspect. A vertical frame is capped by the window's height,
 * so its bottom is never below the fold when its top is at the top.
 */
const FRAME: Record<Aspect, string> = {
  "16:9": "aspect-video w-full",
  "9:16": "mx-auto aspect-[9/16] w-full max-w-[calc(78svh*9/16)]",
};

const ratio = (a: Aspect) => (a === "16:9" ? 16 / 9 : 9 / 16);

const LINK_BUTTON =
  "font-medium text-accent-ink underline decoration-accent-ink/40 underline-offset-4 transition-colors hover:text-ink disabled:text-muted disabled:no-underline";

function Poster({ side }: { side: Side }) {
  const [w, h] = DIMENSIONS[side.aspect];
  return (
    <picture>
      <source srcSet={side.poster.avif} type="image/avif" />
      <img
        src={side.poster.webp}
        alt=""
        loading="lazy"
        decoding="async"
        width={w}
        height={h}
        className="absolute inset-0 size-full object-cover"
      />
    </picture>
  );
}

export function BeforeAfter({
  pair,
  caption,
  notes,
  layout = "wipe",
  sound = true,
  sides = { before: "the footage as given", after: "the exported edit" },
  seam = false,
  label = "Before and after",
}: {
  pair: Pair;
  /** The line beside Play: which side is which. A split's labels say it already. */
  caption?: ReactNode;
  /**
   * Anything more the figure carries, inside the figcaption. In a split it sits
   * beside two vertical frames on a wide screen, and otherwise behind "How it
   * was made", so the pair itself always fits one screen.
   */
  notes?: ReactNode;
  /** One frame with a line, or two frames side by side at one height. */
  layout?: "wipe" | "split";
  /** A split's quiet clause after each side's label. */
  sides?: { before: ReactNode; after: ReactNode };
  /** Whether the after video has sound worth offering ("Hear the edit"). */
  sound?: boolean;
  /** The home page only: paper begins halfway down the frame. See globals.css. */
  seam?: boolean;
  /** Names the range input for a screen reader. */
  label?: string;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const before = useRef<HTMLVideoElement>(null);
  const after = useRef<HTMLVideoElement>(null);
  const [near, setNear] = useState(false);
  const [still, setStill] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [soundOn, setSoundOn] = useState(false);
  const [position, setPosition] = useState(50);
  const [shown, setShown] = useState<"before" | "after">("after");
  const [open, setOpen] = useState(false);
  const dragging = useRef(false);

  // Sources only once the figure is close; playback only while it is visible.
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    setStill(reduce.matches);
    const approach = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          approach.disconnect();
        }
      },
      { rootMargin: "600px 0px" },
    );
    approach.observe(el);
    return () => approach.disconnect();
  }, []);

  useEffect(() => {
    const el = stage.current;
    if (!near || !el) return;
    const both = () => [before.current, after.current].filter((v): v is HTMLVideoElement => Boolean(v));
    const visible = new IntersectionObserver(
      (entries) => {
        const on = entries.some((e) => e.isIntersecting);
        if (on && !still) {
          for (const v of both()) void v.play().catch(() => {});
        } else if (!on) {
          for (const v of both()) v.pause();
        }
      },
      { threshold: 0.25 },
    );
    visible.observe(el);
    return () => visible.disconnect();
  }, [near, still]);

  // Keep the before video on the after video's clock. Every animation frame
  // while playing, the before's offset from the after (taken across the loop
  // point, so a wrap is not a jump) is corrected: past a quarter second by a
  // seek, past half a frame by running the before up to 10% fast or slow, which
  // closes the gap without the stall a seek costs. A seek or pause of either
  // is copied to the other at once. And when either runs out of data
  // (`waiting`), the other is paused until it can play again, so a buffering
  // side is never left behind.
  useEffect(() => {
    const lead = after.current;
    const follow = before.current;
    if (!near || !lead || !follow) return;
    const FRAME = 1 / 30;
    const stalled = new Set<HTMLVideoElement>();
    let holding = false;
    let raf = 0;
    const offset = () => {
      let d = follow.currentTime - lead.currentTime;
      const len = lead.duration;
      if (Number.isFinite(len) && len > 0) {
        if (d > len / 2) d -= len;
        if (d < -len / 2) d += len;
      }
      return d;
    };
    const align = () => {
      const d = offset();
      if (Math.abs(d) > 0.25 || lead.paused) {
        if (Math.abs(d) > FRAME / 2) follow.currentTime = lead.currentTime;
        follow.playbackRate = 1;
      } else if (Math.abs(d) > FRAME / 2) {
        follow.playbackRate = Math.min(1.1, Math.max(0.9, 1 - d * 2));
      } else {
        follow.playbackRate = 1;
      }
    };
    const tick = () => {
      align();
      raf = requestAnimationFrame(tick);
    };
    const run = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(tick);
    };
    const stop = () => cancelAnimationFrame(raf);
    const onPlay = () => {
      if (holding) return;
      setPlaying(true);
      void follow.play().catch(() => {});
      run();
    };
    const onPause = () => {
      if (holding) return;
      setPlaying(false);
      stop();
      follow.pause();
      align();
    };
    const onSeeked = () => {
      if (Math.abs(offset()) > FRAME / 2) follow.currentTime = lead.currentTime;
    };
    // Either side out of data: hold both until it recovers.
    const onWaiting = (e: Event) => {
      stalled.add(e.currentTarget as HTMLVideoElement);
      if (lead.paused && !holding) return;
      holding = true;
      stop();
      for (const v of [lead, follow]) if (!stalled.has(v)) v.pause();
    };
    const onReady = (e: Event) => {
      stalled.delete(e.currentTarget as HTMLVideoElement);
      if (!holding || stalled.size) return;
      holding = false;
      if (Math.abs(offset()) > FRAME / 2) follow.currentTime = lead.currentTime;
      for (const v of [lead, follow]) void v.play().catch(() => {});
      run();
    };
    lead.addEventListener("play", onPlay);
    lead.addEventListener("pause", onPause);
    lead.addEventListener("seeked", onSeeked);
    for (const v of [lead, follow]) {
      v.addEventListener("waiting", onWaiting);
      v.addEventListener("canplay", onReady);
      v.addEventListener("playing", onReady);
    }
    if (!lead.paused) run();
    return () => {
      stop();
      lead.removeEventListener("play", onPlay);
      lead.removeEventListener("pause", onPause);
      lead.removeEventListener("seeked", onSeeked);
      for (const v of [lead, follow]) {
        v.removeEventListener("waiting", onWaiting);
        v.removeEventListener("canplay", onReady);
        v.removeEventListener("playing", onReady);
      }
    };
  }, [near]);

  const fromPointer = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    setPosition(Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)));
  };

  const togglePlay = () => {
    const lead = after.current;
    if (!lead) return;
    if (lead.paused) {
      for (const v of [before.current, after.current]) void v?.play().catch(() => {});
    } else {
      for (const v of [before.current, after.current]) v?.pause();
    }
  };

  const toggleSound = () => {
    const lead = after.current;
    if (!lead) return;
    lead.muted = soundOn;
    setSoundOn(!soundOn);
    if (!soundOn && lead.paused) togglePlay();
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Home") setPosition(0);
    if (e.key === "End") setPosition(100);
  };

  const video = (side: Side, ref: typeof before) => (
    <video
      ref={ref}
      muted
      loop
      playsInline
      preload="none"
      aria-hidden
      onLoadedData={(e) => e.currentTarget.setAttribute("data-ready", "")}
      className="absolute inset-0 size-full object-cover opacity-0 transition-opacity duration-500 data-[ready]:opacity-100"
    >
      {near ? (
        <>
          {side.av1 ? <source src={side.av1} type='video/mp4; codecs="av01.0.05M.08"' /> : null}
          <source src={side.h264} type='video/mp4; codecs="avc1.64001f"' />
        </>
      ) : null}
    </video>
  );

  const figcaption = (
    <figcaption className="relative mt-3 text-sm leading-relaxed text-muted sm:mt-4">
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
        <span>{caption}</span>
        <span className="ml-auto flex items-center gap-4">
          <button type="button" onClick={togglePlay} disabled={!near} className={LINK_BUTTON}>
            {playing ? "Pause" : "Play"}
          </button>
          {sound ? (
            <button
              type="button"
              onClick={toggleSound}
              disabled={!near}
              aria-pressed={soundOn}
              className={LINK_BUTTON}
            >
              {soundOn ? "Mute" : "Hear the edit"}
            </button>
          ) : null}
        </span>
      </div>
      {notes}
    </figcaption>
  );

  if (layout === "split") {
    // Both frames at one height: each column's share of the row is its
    // aspect's width, so equal heights fall out of the grid. The height is
    // capped by the window, so the whole pair is on screen at once from a
    // 700px-tall window up, and the row is never wider than that height
    // allows. On a phone two 16:9 frames stack and still fit; when either is
    // vertical they share one cell instead and a toggle picks which is shown,
    // both playing on the same clock.
    const rb = ratio(pair.before.aspect);
    const ra = ratio(pair.after.aspect);
    // Two vertical frames leave the column's right side free on a wide screen.
    const beside = rb + ra < 1.5;
    const toggled = Math.min(rb, ra) < 1;
    const h = "min(68svh, 560px)";
    const vars = {
      "--cols": `${rb}fr ${ra}fr`,
      "--w-one": `min(100%, calc(${h} * ${Math.max(rb, ra)}))`,
      "--w-two": `min(100%, calc(${h} * ${rb + ra} + 1rem))`,
    } as CSSProperties;
    const notesId = `${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-notes`;
    const frame = (which: "before" | "after", side: Side, ref: typeof before) => (
      <div
        className={`min-w-0 ${
          toggled
            ? `col-start-1 row-start-1 sm:col-start-auto sm:row-start-auto ${
                shown === which ? "" : "max-sm:pointer-events-none max-sm:opacity-0"
              }`
            : ""
        }`}
      >
        <p className={`mb-2 items-baseline gap-2 text-sm ${toggled ? "hidden sm:flex" : "flex"}`}>
          <span className="font-semibold text-ink">{which === "before" ? "Before" : "After"}</span>
          <span className="truncate text-muted">{sides[which]}</span>
        </p>
        <div
          className={`relative w-full overflow-hidden rounded-[12px] bg-app-surface-0 ${
            side.aspect === "16:9" ? "aspect-video" : "aspect-[9/16]"
          }`}
        >
          <Poster side={side} />
          {video(side, ref)}
        </div>
      </div>
    );
    const choose = (which: "before" | "after") => (
      <button
        type="button"
        onClick={() => setShown(which)}
        aria-pressed={shown === which}
        className="rounded-full px-4 py-1.5 font-medium text-ink-soft transition-colors aria-pressed:bg-ink aria-pressed:text-paper"
      >
        {which === "before" ? "Before" : "After"}
      </button>
    );
    return (
      <figure className={beside ? "lg:flex lg:items-start lg:gap-10" : undefined}>
        <div className={`mx-auto w-(--w-one) shrink-0 sm:w-(--w-two) ${beside ? "lg:mx-0" : ""}`} style={vars}>
          {toggled ? (
            <div role="group" aria-label={`${label}: show`} className="mb-3 flex items-center gap-3 text-sm sm:hidden">
              <span className="inline-flex shrink-0 rounded-full border border-line p-0.5">
                {choose("before")}
                {choose("after")}
              </span>
              <span className="truncate text-muted">{sides[shown]}</span>
            </div>
          ) : null}
          <div ref={stage} className="grid grid-cols-1 items-end gap-4 sm:grid-cols-(--cols)">
            {frame("before", pair.before, before)}
            {frame("after", pair.after, after)}
          </div>
          <div className="mt-3 flex flex-wrap items-baseline gap-x-5 gap-y-2 text-sm text-muted">
            {caption ? <span>{caption}</span> : null}
            <button type="button" onClick={togglePlay} disabled={!near} className={LINK_BUTTON}>
              {playing ? "Pause" : "Play"}
            </button>
            {sound ? (
              <button
                type="button"
                onClick={toggleSound}
                disabled={!near}
                aria-pressed={soundOn}
                className={LINK_BUTTON}
              >
                {soundOn ? "Mute" : "Hear the edit"}
              </button>
            ) : null}
            {notes ? (
              <button
                type="button"
                onClick={() => setOpen(!open)}
                aria-expanded={open}
                aria-controls={notesId}
                className={`${LINK_BUTTON} ml-auto ${beside ? "lg:hidden" : ""}`}
              >
                {open ? "Hide how it was made" : "How it was made"}
              </button>
            ) : null}
          </div>
        </div>
        {notes ? (
          <figcaption
            id={notesId}
            className={`mt-8 min-w-0 text-sm leading-relaxed text-muted ${open ? "" : "hidden"} ${
              beside ? "lg:mt-0 lg:block lg:flex-1" : ""
            }`}
          >
            {notes}
          </figcaption>
        ) : null}
      </figure>
    );
  }

  return (
    <figure>
      {/* The seam: paper begins halfway down this frame. See globals.css. */}
      <div className={seam ? "seam" : undefined}>
        <div
          ref={stage}
          onPointerDown={(e) => {
            dragging.current = true;
            e.currentTarget.setPointerCapture(e.pointerId);
            fromPointer(e);
          }}
          onPointerMove={(e) => {
            if (dragging.current) fromPointer(e);
          }}
          onPointerUp={() => {
            dragging.current = false;
          }}
          onPointerCancel={() => {
            dragging.current = false;
          }}
          className={`relative ${FRAME[pair.after.aspect]} cursor-ew-resize touch-pan-y overflow-hidden rounded-[12px] bg-app-surface-0 select-none`}
          // The divider is one custom property: every layer reads it through a transform.
          style={{ ["--p" as string]: position }}
        >
          {/* Before: the whole frame. */}
          <div className="absolute inset-0">
            <Poster side={pair.before} />
            {video(pair.before, before)}
          </div>

          {/* After: a window onto the right of the line, its picture held still against it. */}
          <div
            className="absolute inset-0 overflow-hidden will-change-transform"
            style={{ transform: "translateX(calc(var(--p) * 1%))" }}
          >
            <div className="absolute inset-0" style={{ transform: "translateX(calc(var(--p) * -1%))" }}>
              <Poster side={pair.after} />
              {video(pair.after, after)}
            </div>
          </div>

          {/* The same control for a keyboard or a screen reader. It takes no
              pointer events: the frame itself tracks the pointer. */}
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={Math.round(position)}
            onChange={(e) => setPosition(Number(e.target.value))}
            onKeyDown={onKey}
            aria-label={`${label}: move the line to compare`}
            aria-valuetext={`${Math.round(position)}% before`}
            className="peer pointer-events-none absolute inset-0 size-full opacity-0"
          />

          {/* The line, and the handle on it. */}
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 will-change-transform"
            style={{ transform: "translateX(calc(var(--p) * 1%))" }}
          >
            <span className="absolute inset-y-0 left-0 w-px -translate-x-1/2 bg-on-night/85" />
            <span className="absolute top-1/2 left-0 grid size-10 -translate-1/2 place-items-center rounded-full border border-on-night/70 bg-night text-on-night">
              <ChevronsLeftRight className="size-4" strokeWidth={1.5} />
            </span>
          </div>
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-[12px] opacity-0 outline-2 -outline-offset-4 outline-accent outline-solid peer-focus-visible:opacity-100"
          />
        </div>
      </div>

      {figcaption}
    </figure>
  );
}
