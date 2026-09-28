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
 * a line you drag (`layout="wipe"`), or in two frames side by side
 * (`layout="split"`) when the edit changes the framing, such as a 16:9 source
 * cut into a 9:16 short. The home page passes its one pair (`HOME_PAIR`);
 * `/compare` passes one per entry in `src/lib/comparisons.ts`.
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
 * leads; the before follows it on every frame it presents, and is re-seeked
 * only when it has drifted by more than two frames.
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
  seam = false,
  label = "Before and after",
}: {
  pair: Pair;
  /** The line beside Play: which side is which. */
  caption: ReactNode;
  /** Anything more the figure carries, under that line, inside the figcaption. */
  notes?: ReactNode;
  /** One frame with a line (both sides one aspect), or two frames side by side (the framing changes). */
  layout?: "wipe" | "split";
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

  // Keep the before video on the after video's clock.
  useEffect(() => {
    const lead = after.current;
    const follow = before.current;
    if (!near || !lead || !follow) return;
    let handle = 0;
    const tick = () => {
      if (Math.abs(follow.currentTime - lead.currentTime) > 2 / 30) follow.currentTime = lead.currentTime;
      if (lead.paused !== follow.paused) void (lead.paused ? follow.pause() : follow.play().catch(() => {}));
      handle = lead.requestVideoFrameCallback?.(tick) ?? 0;
    };
    if (lead.requestVideoFrameCallback) handle = lead.requestVideoFrameCallback(tick);
    const onPlay = () => setPlaying(true);
    const onPause = () => setPlaying(false);
    lead.addEventListener("play", onPlay);
    lead.addEventListener("pause", onPause);
    return () => {
      if (handle) lead.cancelVideoFrameCallback?.(handle);
      lead.removeEventListener("play", onPlay);
      lead.removeEventListener("pause", onPause);
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
    // Two frames at one height from `sm`: each column's share is its aspect's
    // width. Stacked on a phone, where a vertical frame caps its own width.
    const cols = `${ratio(pair.before.aspect)}fr ${ratio(pair.after.aspect)}fr`;
    const frame = (side: Side, ref: typeof before) => (
      <div className={`relative overflow-hidden rounded-[12px] bg-app-surface-0 ${FRAME[side.aspect]} sm:max-w-none`}>
        <Poster side={side} />
        {video(side, ref)}
      </div>
    );
    return (
      <figure>
        <div
          ref={stage}
          className="grid grid-cols-1 items-start gap-3 sm:grid-cols-[var(--cols)] sm:gap-4"
          style={{ "--cols": cols } as CSSProperties}
        >
          {frame(pair.before, before)}
          {frame(pair.after, after)}
        </div>
        {figcaption}
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
