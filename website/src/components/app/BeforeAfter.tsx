"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { ChevronsLeftRight } from "lucide-react";

/**
 * Before and after: the four clips as they came from Pexels, cut to the same
 * frames, and the edit bay made of them, in one frame with a line you drag.
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

const SOURCES = {
  before: ["/compare/before.av1.mp4", "/compare/before.h264.mp4"],
  after: ["/compare/after.av1.mp4", "/compare/after.h264.mp4"],
};

function Poster({ name }: { name: "before" | "after" }) {
  return (
    <picture>
      <source srcSet={`/compare/${name}-poster.avif`} type="image/avif" />
      <img
        src={`/compare/${name}-poster.webp`}
        alt=""
        loading="lazy"
        decoding="async"
        width={960}
        height={540}
        className="absolute inset-0 size-full object-cover"
      />
    </picture>
  );
}

export function BeforeAfter() {
  const stage = useRef<HTMLDivElement>(null);
  const before = useRef<HTMLVideoElement>(null);
  const after = useRef<HTMLVideoElement>(null);
  const [near, setNear] = useState(false);
  const [still, setStill] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [sound, setSound] = useState(false);
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
    lead.muted = sound;
    setSound(!sound);
    if (!sound && lead.paused) togglePlay();
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Home") setPosition(0);
    if (e.key === "End") setPosition(100);
  };

  const video = (which: "before" | "after", ref: typeof before) => (
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
      {near
        ? SOURCES[which].map((src) => (
            <source
              key={src}
              src={src}
              type={src.includes("av1") ? 'video/mp4; codecs="av01.0.05M.08"' : 'video/mp4; codecs="avc1.64001f"'}
            />
          ))
        : null}
    </video>
  );

  return (
    <figure>
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
        className="relative aspect-video cursor-ew-resize touch-pan-y overflow-hidden border-t-2 border-t-brass bg-app-surface-0 select-none"
        // The divider is one custom property: every layer reads it through a transform.
        style={{ ["--p" as string]: position }}
      >
        {/* Before: the whole frame. */}
        <div className="absolute inset-0">
          <Poster name="before" />
          {video("before", before)}
        </div>

        {/* After: a window onto the right of the line, its picture held still against it. */}
        <div
          className="absolute inset-0 overflow-hidden will-change-transform"
          style={{ transform: "translateX(calc(var(--p) * 1%))" }}
        >
          <div className="absolute inset-0" style={{ transform: "translateX(calc(var(--p) * -1%))" }}>
            <Poster name="after" />
            {video("after", after)}
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
          aria-label="Before and after: move the line to compare"
          aria-valuetext={`${Math.round(position)}% before`}
          className="peer pointer-events-none absolute inset-0 size-full opacity-0"
        />

        {/* The line, and the handle on it. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 will-change-transform"
          style={{ transform: "translateX(calc(var(--p) * 1%))" }}
        >
          <span className="absolute inset-y-0 left-0 w-px -translate-x-1/2 bg-paper/85" />
          <span className="absolute top-1/2 left-0 grid size-9 -translate-1/2 place-items-center rounded-full border border-paper/70 bg-ink text-paper">
            <ChevronsLeftRight className="size-4" strokeWidth={1.5} />
          </span>
        </div>
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-0 outline outline-1 -outline-offset-4 outline-brass peer-focus-visible:opacity-100"
        />
      </div>

      <figcaption className="mt-2.5 flex flex-wrap items-baseline gap-x-6 gap-y-1 text-xs leading-relaxed text-muted sm:mt-4">
        <span>
          <span className="text-brass-deep">Fig. 2</span> &middot; Left of the line, the four clips as they
          came from Pexels, cut to the same frames. Right of it, the edit in Fig. 1.
        </span>
        <span className="ml-auto flex items-center gap-4">
          <button
            type="button"
            onClick={togglePlay}
            disabled={!near}
            className="text-brass-deep underline underline-offset-2 transition-colors hover:text-ink disabled:text-muted disabled:no-underline"
          >
            {playing ? "Pause" : "Play"}
          </button>
          <button
            type="button"
            onClick={toggleSound}
            disabled={!near}
            aria-pressed={sound}
            className="text-brass-deep underline underline-offset-2 transition-colors hover:text-ink disabled:text-muted disabled:no-underline"
          >
            {sound ? "Mute" : "Hear the edit"}
          </button>
        </span>
      </figcaption>
    </figure>
  );
}
