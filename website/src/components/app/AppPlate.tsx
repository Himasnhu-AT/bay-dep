import { AgentChat } from "@/components/app/AgentChat";
import {
  LANES,
  REEL,
  stateAt,
  type ClipKind,
  type FrameState,
} from "@/lib/sequence";

/**
 * A re-creation of the editor, built from rust/crates/vii-ui/. The panel order
 * (toolbar, scene bar, media | preview | inspector, timeline), the button set,
 * the inspector fields and the `● Claude · <tool>` chip are the app's, and the
 * palette is theme.rs value for value. It is not a screen capture and the page
 * captions it as a re-creation.
 *
 * Every breakpoint here is a container query, not a viewport one. The plate does
 * not fill the window: it sits in a grid column beside the notes, so a viewport
 * breakpoint would hand a 720px plate the button set meant for 1280px and clip
 * the very control the beat is about.
 *
 * Everything is driven by one number, the beat index, so the same markup serves
 * the scrolled sequence, the reduced-motion state and the no-script state.
 */

const CLIP_FILL: Record<ClipKind, string> = {
  Text: "bg-elem-text",
  Shape: "bg-elem-shape",
  Audio: "bg-elem-audio",
};

/** Seconds to a percentage of the timeline's width. */
const pct = (seconds: number) => `${(seconds / REEL.seconds) * 100}%`;

function clock(seconds: number) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.round((seconds % 1) * 100);
  return `${m}:${String(s).padStart(2, "0")}.${String(cs).padStart(2, "0")}`;
}

function Button({
  label,
  enabled = true,
  active = false,
}: {
  label: string;
  enabled?: boolean;
  active?: boolean;
}) {
  return (
    <span
      className={`rounded-[3px] border px-2 py-1 text-[11px] whitespace-nowrap transition-colors duration-300 ${
        active
          ? "border-app-selected-border bg-app-selected text-app-text"
          : enabled
            ? "border-app-border bg-app-panel-alt text-app-text"
            : "border-app-border/60 bg-app-panel text-app-muted/45"
      }`}
    >
      {label}
    </span>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[4px]">
      <span className="text-[11px] text-app-muted">{label}</span>
      <span className="font-mono text-[11px] text-app-text tabular-nums">
        {value}
      </span>
    </div>
  );
}

/** The reel itself, at 1080x1920, letterboxed into the preview the way fit_contain leaves it. */
function ReelFrame({ frame }: { frame: FrameState }) {
  const showTitle = frame === "title" || frame === "chart" || frame === "close";
  const showChart = frame === "chart" || frame === "close";
  const showClose = frame === "close";

  // Return drag under the standard approximation, drag = sigma squared / 2.
  const bars = [
    { sigma: "10%", drag: 0.5 },
    { sigma: "20%", drag: 2.0 },
    { sigma: "30%", drag: 4.5 },
    { sigma: "40%", drag: 8.0 },
  ];

  return (
    <div
      aria-hidden
      // Its own container, and every size inside it is in `cqw`. The frame is a
      // 1080x1920 canvas letterboxed into whatever room the preview has, which
      // on a phone is a fraction of what it is on a laptop. Fixed pixel type
      // would spill straight out of it.
      className="@container relative h-full overflow-hidden bg-reel-ground"
      style={{ aspectRatio: `${REEL.width} / ${REEL.height}` }}
    >
      {frame === "empty" ? null : (
        <div className="absolute inset-0 flex flex-col px-[7%] py-[9%]">
          <div
            data-on={showTitle ? "" : undefined}
            className="opacity-0 transition-opacity duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] data-[on]:opacity-100"
          >
            <p className="text-[6.5cqw] font-medium tracking-[0.28em] text-app-accent uppercase">
              Compounding
            </p>
            <p className="mt-[6%] text-[17cqw] leading-[1.05] font-semibold text-app-text">
              Volatility
              <br />
              drag
            </p>
          </div>

          <div className="mt-auto">
            <div
              data-on={showChart ? "" : undefined}
              className="opacity-0 transition-opacity duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] data-[on]:opacity-100"
            >
              {/* Chart. Bars grow from the bottom edge, not from the middle.
                  The track runs at full opacity: the recipe measured it at
                  3.12:1 and recorded that alpha destroys that measurement. */}
              <div className="flex h-[52cqw] items-end gap-[6%]">
                {bars.map((b, i) => (
                  <div key={b.sigma} className="relative h-full flex-1">
                    <div className="absolute inset-0 bg-reel-track" />
                    <div
                      className="absolute inset-x-0 bottom-0 origin-bottom bg-app-accent transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]"
                      style={{
                        height: `${(b.drag / 8) * 100}%`,
                        transform: showChart ? "scaleY(1)" : "scaleY(0)",
                        transitionDelay: `${120 + i * 90}ms`,
                      }}
                    />
                  </div>
                ))}
              </div>
              {/* One grid: the axis, then captions and values under it. */}
              <div className="mt-[3%] h-px w-full bg-reel-track" />
              <div className="mt-[3%] flex gap-[6%]">
                {bars.map((b) => (
                  <div key={b.sigma} className="flex-1 text-center">
                    <p className="font-mono text-[5.5cqw] text-app-muted">
                      {b.sigma}
                    </p>
                    <p className="font-mono text-[6.5cqw] text-app-text">
                      {b.drag.toFixed(1)}%
                    </p>
                  </div>
                ))}
              </div>
            </div>

            <div
              data-on={showClose ? "" : undefined}
              className="mt-[8%] opacity-0 transition-opacity duration-700 ease-[cubic-bezier(0.16,1,0.3,1)] data-[on]:opacity-100"
            >
              <div className="h-px w-[26cqw] bg-app-accent" />
              <p className="mt-[4%] font-mono text-[7.5cqw] text-app-text">
                drag ≈ σ² / 2
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function AppPlate({ step }: { step: number }) {
  const state = stateAt(step);
  const selected = LANES.flatMap((l) => l.clips).find(
    (c) => c.name === state.selected,
  );

  return (
    // The tip-in. Ruled along its top edge in brass rather than floated on a
    // shadow: this is a plate bound into a printed page, not a window hovering
    // over one, and the site does not use shadows.
    <div className="@container border-t-2 border-t-brass">
      <div className="flex flex-col overflow-hidden border border-app-border bg-app-bg font-app text-app-text @5xl:flex-row">
        {/* The conversation and the editor, behind one frame. Side by side when
            there is room, stacked under the editor when there is not, so the
            editor stays the thing you look at first on a phone. Positioned, so a
            long log clips inside the figure instead of stretching it. */}
        <div className="relative order-2 h-[26vh] w-full shrink-0 border-t border-app-border @5xl:order-1 @5xl:h-auto @5xl:w-[336px] @5xl:border-t-0">
          <div className="absolute inset-0">
            <AgentChat step={step} />
          </div>
        </div>

        {/* Its own container: the editor pane is narrower than the figure, so
            its panels must measure against this column and not the whole plate. */}
        <div className="@container order-1 flex min-w-0 flex-1 flex-col @5xl:order-2">
          {/* Toolbar. One row, the way the app draws it: the button run is allowed
            to clip before it is allowed to wrap. */}
          <div className="flex items-center gap-3 border-b border-app-border bg-app-panel px-3 py-2">
            <div
              className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden"
              style={{
                maskImage:
                  "linear-gradient(to right, #000 calc(100% - 28px), transparent)",
              }}
            >
              {/* The status line lives here, before Save, and only when there is
                something to say. In the app it is click-to-dismiss. */}
              {state.status ? (
                <span className="hidden max-w-[42%] shrink-0 truncate rounded-[3px] bg-app-panel-alt px-2 py-1 text-[11px] text-app-text @md:inline-block">
                  {state.status}
                </span>
              ) : null}
              <Button label="Save" />
              <span className="hidden @2xl:contents">
                <Button label="Export Frame" />
                <Button label="Export Video" />
              </span>
              <span className="mx-0.5 h-4 w-px shrink-0 bg-app-border" />
              <Button label="+ Text" />
              <Button label="Delete" enabled={!!selected} />
              <span className="hidden @xl:contents">
                <Button label="Split" enabled={!!selected} />
              </span>
              <span className="hidden @4xl:contents">
                <Button label="Duplicate" enabled={!!selected} />
                <span className="mx-0.5 h-4 w-px shrink-0 bg-app-border" />
                <Button label="Copy" enabled={!!selected} />
                <Button label="Paste" enabled={false} />
              </span>
            </div>

            {/* Undo, redo and the chip never clip. The sequence ends on undo, so it
              has to be on screen at the width the sequence is read at. */}
            <div className="flex shrink-0 items-center gap-1.5">
              <Button
                label="Undo"
                enabled={state.canUndo}
                active={state.undoPressed}
              />
              <Button label="Redo" enabled={false} />
              <span
                data-on={state.chip ? "" : undefined}
                className="ml-1.5 rounded-full border border-app-accent/45 bg-app-accent/12 px-2.5 py-1 font-mono text-[11px] whitespace-nowrap text-app-accent opacity-0 transition-opacity duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] data-[on]:opacity-100"
              >
                ● Claude · {state.chip ?? "idle"}
              </span>
            </div>
          </div>

          {/* Scene bar */}
          <div className="flex items-center gap-2 border-b border-app-border bg-app-panel-alt px-3 py-1.5 text-[11px]">
            <span className="text-[11px] text-app-muted">SCENES</span>
            <span className="rounded-[3px] border border-app-selected-border bg-app-selected px-2 py-0.5 text-app-text">
              Scene 1
            </span>
            <span className="text-app-muted">Scene 2</span>
            <span className="text-app-muted">＋ Scene</span>
          </div>

          {/* Media | Preview | Inspector */}
          <div className="flex h-[20vh] @md:h-[236px] @xl:h-[300px]">
            <div className="flex w-[116px] shrink-0 flex-col gap-1.5 border-r border-app-border bg-app-panel p-2 @lg:w-[186px] @lg:p-3">
              <p className="text-[10px] tracking-[0.14em] text-app-muted uppercase">
                Media
              </p>
              {[
                ["Clip.mp4", "video"],
                ["Logo.png", "image"],
                ["Music.mp3", "audio"],
              ].map(([name, kind]) => (
                <div
                  key={name}
                  className="flex items-center gap-1.5 rounded-[3px] border border-app-border bg-app-panel-alt px-1.5 py-1 @lg:gap-2 @lg:px-2 @lg:py-1.5"
                >
                  <span
                    className={`h-2.5 w-2.5 shrink-0 rounded-[2px] ${
                      kind === "video"
                        ? "bg-elem-video"
                        : kind === "image"
                          ? "bg-elem-image"
                          : "bg-elem-audio"
                    }`}
                  />
                  <span className="truncate text-[11px]">{name}</span>
                </div>
              ))}
              <p className="mt-1 text-[10px] leading-snug text-app-muted">
                Click to add at playhead
              </p>
            </div>

            <div className="flex flex-1 items-center justify-center bg-app-bg p-3.5">
              <div className="h-full ring-1 ring-app-border/70">
                <ReelFrame frame={state.frame} />
              </div>
            </div>

            <div className="hidden w-[216px] shrink-0 border-l border-app-border bg-app-panel p-3 @xl:block">
              <p className="text-[10px] tracking-[0.14em] text-app-muted uppercase">
                Inspector
              </p>
              {selected ? (
                <div className="mt-2 divide-y divide-app-border/70">
                  <InfoRow label="Name" value={selected.name} />
                  <InfoRow label="Kind" value={selected.kind} />
                  <InfoRow
                    label="Start"
                    value={`${selected.start.toFixed(2)}s`}
                  />
                  <InfoRow
                    label="Duration"
                    value={`${selected.duration.toFixed(2)}s`}
                  />
                  <InfoRow label="Opacity" value="100%" />
                  <InfoRow label="Scale" value="1.00" />
                  <InfoRow label="X" value="0.00" />
                  <InfoRow label="Y" value="0.00" />
                </div>
              ) : (
                <p className="mt-3 text-[11px] leading-snug text-app-muted">
                  Select a clip to inspect it.
                </p>
              )}
            </div>
          </div>

          {/* Timeline */}
          <div className="border-t border-app-border bg-app-panel">
            {/* Ruler */}
            <div className="flex items-stretch border-b border-app-border">
              <div className="w-[58px] shrink-0 border-r border-app-border px-1.5 py-1 @xl:w-[64px] @xl:px-2">
                <span className="font-mono text-[10px] text-app-muted tabular-nums">
                  {clock(state.playhead)}
                </span>
              </div>
              <div className="relative flex-1">
                {[0, 5, 10, 15, 20].map((s) => (
                  <span
                    key={s}
                    className="absolute top-1 font-mono text-[9px] text-app-muted tabular-nums"
                    style={{ left: pct(s), transform: "translateX(2px)" }}
                  >
                    {s}s
                  </span>
                ))}
              </div>
            </div>

            {/* Lanes */}
            <div className="relative">
              {LANES.map((lane) => (
                <div key={lane.label} className="flex items-stretch">
                  <div className="flex w-[58px] shrink-0 items-center border-r border-b border-app-border px-1.5 py-2 @xl:w-[64px] @xl:px-2">
                    <span className="truncate text-[10px] text-app-muted">
                      {lane.label}
                    </span>
                  </div>
                  <div className="relative h-[21px] flex-1 border-b border-app-border bg-app-lane @md:h-[27px] @xl:h-[30px]">
                    {lane.clips.map((clip, i) => {
                      const on = state.clips.has(clip.name);
                      const isSelected = state.selected === clip.name;
                      return (
                        <div
                          key={clip.name}
                          data-on={on ? "" : undefined}
                          className={`absolute top-1 bottom-1 flex items-center overflow-hidden rounded-[3px] border px-1.5 opacity-0 transition-[opacity,transform] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] data-[on]:opacity-100 ${
                            CLIP_FILL[clip.kind]
                          } ${
                            isSelected
                              ? "border-app-selected-border"
                              : "border-app-border"
                          }`}
                          style={{
                            left: pct(clip.start),
                            width: pct(clip.duration),
                            transform: on ? "translateY(0)" : "translateY(5px)",
                            transitionDelay: on ? `${i * 70}ms` : "0ms",
                          }}
                        >
                          <span className="truncate text-[10px] text-app-text">
                            {clip.name}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              {/* Playhead. It moves rather than jumping, which is the one thing on
                the plate that reads as the app being alive. */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-y-0 right-0 left-[58px] @xl:left-[64px]"
              >
                <div
                  className="absolute inset-y-0 w-px bg-app-accent transition-[left] duration-1000 ease-[cubic-bezier(0.16,1,0.3,1)]"
                  style={{ left: pct(state.playhead) }}
                >
                  <span className="absolute -top-px -left-[3px] h-[7px] w-[7px] rounded-[1px] bg-app-accent" />
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
