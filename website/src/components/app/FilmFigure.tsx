import type { ReactNode } from "react";
import type { Side } from "./BeforeAfter";

/**
 * A /compare figure with no "before": a film the agent made from what it was given, shown alone.
 * The given line stands where the Before frame would, so the figure still says what went in.
 * Native controls (sound included); nothing loads until the viewer presses play.
 */
export function FilmFigure({
  film,
  given,
  label,
  notes,
}: {
  film: Side;
  given: string;
  label: string;
  notes: ReactNode;
}) {
  return (
    <figure className="lg:flex lg:items-start lg:gap-10">
      <div className="mx-auto w-full max-w-[min(100%,calc(68svh*16/9),960px)] shrink-0 lg:mx-0 lg:w-[min(60%,calc(68svh*16/9))]">
        <p className="mb-2 text-sm text-muted">
          <span className="font-semibold text-ink">What it was given</span> {given}
        </p>
        <div
          className={`relative w-full overflow-hidden rounded-[12px] bg-app-surface-0 ${
            film.aspect === "16:9" ? "aspect-video" : "mx-auto aspect-[9/16] max-w-[calc(78svh*9/16)]"
          }`}
        >
          <video
            controls
            playsInline
            preload="none"
            poster={film.poster.webp}
            aria-label={label}
            className="absolute inset-0 size-full object-cover"
          >
            {film.av1 ? <source src={film.av1} type='video/mp4; codecs="av01.0.05M.08"' /> : null}
            <source src={film.h264} type='video/mp4; codecs="avc1.64001f"' />
          </video>
        </div>
      </div>
      <figcaption className="mt-8 lg:mt-0">{notes}</figcaption>
    </figure>
  );
}
