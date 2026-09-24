import type { ReactNode } from "react";
import {
  Bot,
  ChevronFirst,
  ChevronLast,
  ChevronLeft,
  ChevronRight,
  Diamond,
  Eye,
  Film,
  FolderOpen,
  House,
  LayoutTemplate,
  Link2,
  LockOpen,
  Moon,
  Music,
  Music2,
  PanelBottom,
  PanelLeft,
  PanelRight,
  Play,
  Redo2,
  RotateCcw,
  Scissors,
  Settings,
  SkipBack,
  SkipForward,
  Sparkles,
  Trash2,
  Type,
  Undo2,
  Upload,
  Video,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { AgentPanel } from "@/components/app/AgentPanel";
import {
  PEAKS,
  REEL,
  STILLS,
  VIEW_FRAMES,
  stateAt,
  timecode,
  type Clip,
  type Grade,
} from "@/lib/sequence";

/**
 * The editor as it is today, re-created from its own source: the layout in
 * src/renderer/src/App.tsx (top bar; rail, side panel, preview over transport,
 * inspector; timeline; status bar), the sizes in the editor components (a 44px
 * top bar and rail, a 148px track header, 58px video and 46px audio tracks), the
 * labels as the app prints them, and the palette from its styles.css, token for
 * token. The chrome is drawn; the pictures in it are real: the preview shows
 * frames bay rendered at each state of the edit, and the clips carry filmstrips
 * of their sources, as the app's do. The caption says which is which.
 *
 * Every breakpoint here is a container query on the named container `plate`.
 * The plate sits in a column that is a fraction of the window, so a viewport
 * breakpoint would hand a narrow plate the layout meant for a wide one.
 *
 * Everything is driven by one number, the step, so the same markup serves the
 * scrolled sequence, the reduced-motion state and the no-script state. The one
 * thing that moves continuously is the playhead, on the compositor: see
 * `plate-playhead` in globals.css.
 */

const pct = (frames: number) => `${((frames / VIEW_FRAMES) * 100).toFixed(3)}%`;

function Icon({ children, active = false }: { children: ReactNode; active?: boolean }) {
  return (
    <span
      className={`grid size-7 shrink-0 place-items-center rounded-[4px] ${
        active ? "bg-app-surface-3 text-app-accent" : "text-app-ink-1"
      }`}
    >
      {children}
    </span>
  );
}

function TopBar({ edited }: { edited: boolean }) {
  return (
    <div className="relative flex h-11 shrink-0 items-center gap-2 border-b border-app-line bg-app-surface-1 px-3">
      {/* The traffic lights of a macOS window, which the app leaves room for. */}
      <span aria-hidden className="mr-3 hidden gap-2 @3xl/plate:flex">
        <span className="size-3 rounded-full bg-app-surface-4" />
        <span className="size-3 rounded-full bg-app-surface-4" />
        <span className="size-3 rounded-full bg-app-surface-4" />
      </span>
      <Icon>
        <House aria-hidden className="size-4" />
      </Icon>
      <span className="text-[13px] font-semibold text-app-ink-0">bay</span>
      <span aria-hidden className="h-4 w-px bg-app-line-strong" />
      <span className={edited ? "text-app-ink-1" : "text-app-ink-3"}>
        <Undo2 aria-hidden className="size-4" />
      </span>
      <span className="text-app-ink-3">
        <Redo2 aria-hidden className="size-4" />
      </span>

      <span className="absolute left-1/2 hidden -translate-x-1/2 text-[13px] font-medium text-app-ink-0 @2xl/plate:block">
        {REEL.title}
      </span>

      <div className="ml-auto flex items-center gap-1.5">
        <span className="hidden items-center gap-0.5 rounded-[6px] bg-app-surface-2 p-0.5 @4xl/plate:flex">
          <Icon>
            <PanelLeft aria-hidden className="size-4" />
          </Icon>
          <Icon>
            <PanelBottom aria-hidden className="size-4" />
          </Icon>
          <Icon>
            <PanelRight aria-hidden className="size-4" />
          </Icon>
        </span>
        <span className="hidden @4xl/plate:contents">
          <Icon>
            <Moon aria-hidden className="size-4" />
          </Icon>
          <Icon>
            <Settings aria-hidden className="size-4" />
          </Icon>
        </span>
        <span
          data-on={edited ? "" : undefined}
          className="hidden px-1 text-[12px] text-app-ink-1 opacity-0 transition-opacity duration-500 data-[on]:opacity-100 @2xl/plate:inline"
        >
          Unsaved changes
        </span>
        <span className="flex items-center gap-1.5 rounded-[6px] bg-app-accent px-2.5 py-1 text-[12px] font-medium text-white">
          <Upload aria-hidden className="size-3.5" />
          Export
        </span>
      </div>
    </div>
  );
}

function Rail() {
  const pages = [Bot, FolderOpen, Type, LayoutTemplate, Sparkles, Upload];
  return (
    <div className="hidden w-11 shrink-0 flex-col items-center gap-1 border-r border-app-line bg-app-surface-1 py-2 @2xl/plate:flex">
      {pages.map((P, i) => (
        <span key={i} className="relative flex w-full justify-center">
          {i === 0 ? (
            <span
              aria-hidden
              className="absolute top-1/2 left-0 h-4 w-[2px] -translate-y-1/2 rounded-r-full bg-app-accent"
            />
          ) : null}
          <Icon active={i === 0}>
            <P aria-hidden className="size-4" />
          </Icon>
        </span>
      ))}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-[3px] text-[11px]">
      <span className="text-app-ink-2">{label}</span>
      <span className="truncate text-app-ink-0 tabular-nums">{value}</span>
    </div>
  );
}

function Field({ label, value, unit, keyed }: { label: string; value: string; unit?: string; keyed?: boolean }) {
  return (
    <div className="flex items-center gap-1">
      <span className="flex h-7 min-w-0 flex-1 items-center gap-1 rounded-[4px] border border-app-line-strong bg-app-surface-2 px-2 text-[11px]">
        <span className="text-app-ink-2">{label}</span>
        <span className="ml-auto text-[12px] text-app-ink-0 tabular-nums">{value}</span>
        {unit ? <span className="text-app-ink-2">{unit}</span> : null}
      </span>
      {keyed !== undefined ? (
        <Diamond
          aria-hidden
          className={`size-3 shrink-0 ${keyed ? "fill-app-accent text-app-accent" : "text-app-ink-2"}`}
        />
      ) : null}
    </div>
  );
}

/** One of the app's labelled sliders: caption, track with its fill and thumb, live value. */
function Slider({ label, at, value }: { label: string; at: number; value: string }) {
  const p = Math.min(1, Math.max(0, at));
  return (
    <div className="flex items-center gap-2 py-[5px] text-[11px]">
      <span className="w-16 shrink-0 text-app-ink-1">{label}</span>
      <span className="relative h-[3px] flex-1 overflow-hidden rounded-full bg-app-surface-4">
        {/* The fill is a scale of a full-width bar and the thumb rides on it,
            so a value changing moves them on the compositor. */}
        <span
          className="absolute inset-0 origin-left rounded-full bg-app-accent transition-transform duration-500 ease-paper"
          style={{ transform: `scaleX(${p})` }}
        />
      </span>
      <span className="w-12 shrink-0 text-right text-app-ink-1 tabular-nums">{value}</span>
    </div>
  );
}

function Section({ title, children, aside }: { title: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="border-b border-app-line px-3 py-2.5">
      <div className="mb-2 flex items-center">
        <p className="text-[11px] font-semibold tracking-[0.06em] text-app-ink-1 uppercase">{title}</p>
        {aside ? <span className="ml-auto flex items-center gap-1 text-app-ink-1">{aside}</span> : null}
      </div>
      {children}
    </div>
  );
}

const signed = (v: number, digits: number) => (v === 0 ? (0).toFixed(digits) : `${v > 0 ? "+" : ""}${v.toFixed(digits)}`);

/** The Grade section, with the app's ranges (GradeSection.tsx): temperature ±1000 K, tint ±1, saturation 0..2, wheels. */
function GradeSection({ g }: { g: Grade }) {
  return (
    <Section
      title="Grade"
      aside={
        <>
          <RotateCcw aria-hidden className="size-3" />
          <span className="text-[11px]">Reset</span>
        </>
      }
    >
      <Slider label="Temp" at={(g.temp + 1000) / 2000} value={`${g.temp > 0 ? "+" : ""}${g.temp}K`} />
      <Slider label="Tint" at={(g.tint + 1) / 2} value={signed(g.tint, 2)} />
      <Slider label="Saturation" at={g.saturation / 2} value={`${Math.round(g.saturation * 100)}%`} />
      <div className="h-1.5" />
      <Slider label="Lift" at={(g.lift + 0.2) / 0.4} value={signed(g.lift, 3)} />
      <Slider label="Gamma" at={g.gamma + 0.5} value={signed(g.gamma, 3)} />
      <Slider label="Gain" at={g.gain + 0.5} value={signed(g.gain, 3)} />
      <div className="h-1.5" />
      <Slider label="Halation" at={0} value="0%" />
      <Slider label="Vignette" at={g.vignette} value={`${Math.round(g.vignette * 100)}%`} />
      <Slider label="Grain" at={0} value="0%" />
    </Section>
  );
}

function Inspector({ s }: { s: ReturnType<typeof stateAt> }) {
  const header = (
    <div className="flex h-9 shrink-0 items-center border-b border-app-line px-3">
      <span className="text-[11px] font-semibold tracking-[0.06em] text-app-ink-0 uppercase">Inspector</span>
    </div>
  );
  const c = s.selected;

  if (!c) {
    return (
      <>
        {header}
        <div className="plate-in">
          <Section title="Canvas">
            <div className="flex flex-col gap-1.5">
              <Field label="Preset" value="1920 × 1080 · 16:9" />
              <Field label="Frame rate" value="30" />
            </div>
            <div className="mt-2">
              <Row label="Resolution" value="1920 × 1080" />
              <Row label="Tracks" value={String(s.tracks.length)} />
            </div>
          </Section>
          <Section title="Selection">
            <p className="text-[11px] leading-relaxed text-app-ink-2">
              Select a clip on the timeline to edit its position, size, fades and speed. Shift-click to add to the
              selection.
            </p>
          </Section>
        </div>
      </>
    );
  }

  const keyed = Boolean(s.keys[c.id]);
  const grade = s.grades[c.id];
  const size = c.kind === "brf" ? "—" : c.id === "walk" || c.id === "walksound" ? "1280 × 720" : "1920 × 1080";
  // The inspector is taller than the figure lets it be. Where the section the
  // step is about sits below the fold, it is scrolled to, past Source and
  // Timing, by a translate, so it moves on the compositor like the rest.
  const scrolled = Boolean(s.panel);

  return (
    <>
      {header}
      <div className="min-h-0 flex-1 overflow-hidden">
        <div
          key={`${c.id}-${s.panel ?? ""}`}
          className="plate-in transition-transform duration-700 ease-paper"
          style={{ transform: scrolled ? "translateY(-212px)" : undefined }}
        >
          <Section title="Source">
            <Row label="Name" value={c.name} />
            <Row label="Kind" value={c.kind === "brf" ? "brf" : (c.assetKind ?? c.kind)} />
            {c.assetKind === "audio" ? null : <Row label="Size" value={size} />}
            <Row label="Source length" value={`0:${String(Math.round(c.sourceSeconds)).padStart(2, "0")}`} />
          </Section>
          <Section title="Timing">
            <div className="grid grid-cols-2 gap-1.5">
              <Field label="In" value={String(c.from)} unit="f" />
              <Field label="Len" value={String(c.duration)} unit="f" />
            </div>
            <div className="mt-2">
              <Row label="Starts" value={timecode(c.from)} />
              <Row label="Ends" value={timecode(c.from + c.duration)} />
              <Row label="Duration" value={timecode(c.duration)} />
            </div>
          </Section>
          {c.kind === "audio" ? (
            <Section title="Audio & speed">
              <Slider label="Volume" at={c.id === "surf" && c.fadeIn ? 0.25 : 0.5} value={c.id === "surf" && c.fadeIn ? "50%" : "100%"} />
              <div className="mt-2 grid grid-cols-2 gap-1.5">
                <Field label="In" value={String(c.fadeIn ?? 0)} unit="f" />
                <Field label="Out" value={String(c.fadeOut ?? 0)} unit="f" />
              </div>
            </Section>
          ) : grade && s.panel === "grade" ? (
            <GradeSection g={grade} />
          ) : (
            <Section
              title="Transform"
              aside={
                keyed ? (
                  <>
                    <ChevronLeft aria-hidden className="size-3" />
                    <ChevronRight aria-hidden className="size-3" />
                  </>
                ) : null
              }
            >
              <div className="grid grid-cols-2 gap-1.5">
                <Field label="X" value="0" unit="px" keyed={false} />
                <Field label="Y" value="0" unit="px" keyed={false} />
                <Field label="W" value="1920" unit="px" keyed={false} />
                <Field label="H" value="1080" unit="px" keyed={false} />
                <Field label="Rotate" value="0" unit="°" keyed={false} />
                <Field label="Scale" value="100" unit="%" keyed={keyed} />
              </div>
            </Section>
          )}
        </div>
      </div>
    </>
  );
}

/** The app's waveform: a filled polygon of the source's peaks over the part of it the clip plays. */
function Waveform({ clip }: { clip: Clip }) {
  const data = PEAKS[clip.id];
  if (!data) return null;
  const span = Math.min(1, clip.duration / (clip.sourceFrames ?? clip.duration));
  const half = 50;
  const cols = 120;
  const top: string[] = [];
  const bottom: string[] = [];
  for (let c = 0; c <= cols; c++) {
    const ratio = (c / cols) * span;
    const peak = (data.peaks[Math.min(data.peaks.length - 1, Math.floor(ratio * data.peaks.length))] ?? 0) / 100;
    const a = Math.min(1, peak * data.scale) * (half - 1);
    const x = ((c / cols) * 100).toFixed(2);
    top.push(`${x},${(half - a).toFixed(1)}`);
    bottom.push(`${x},${(half + a).toFixed(1)}`);
  }
  return (
    <svg aria-hidden viewBox="0 0 100 100" preserveAspectRatio="none" className="plate-wave absolute inset-0 size-full">
      <polygon points={[...top, ...bottom.reverse()].join(" ")} fill="var(--color-app-waveform)" fillOpacity="0.45" />
    </svg>
  );
}

function ClipBody({
  clip,
  selected,
  keys,
  detached,
}: {
  clip: Clip;
  selected: boolean;
  keys?: number[];
  detached: boolean;
}) {
  const audio = clip.kind === "audio";
  const K = clip.kind === "brf" ? Sparkles : (clip.assetKind ?? clip.kind) === "video" ? Video : Music2;
  const linked = detached && (clip.id === "walk" || clip.id === "walksound");
  const fadeIn = (clip.fadeIn ?? 0) / clip.duration;
  const fadeOut = (clip.fadeOut ?? 0) / clip.duration;
  return (
    <div
      className={`plate-land absolute top-1 bottom-1 overflow-hidden rounded-[4px] border ${
        audio ? "bg-app-clip-audio" : "bg-app-clip-video"
      } ${
        selected
          ? "border-app-accent ring-1 ring-app-accent"
          : audio
            ? "border-app-clip-audio-edge"
            : "border-app-clip-video-edge"
      }`}
      style={{ left: pct(clip.from), width: pct(clip.duration) }}
    >
      {clip.strip ? (
        // The filmstrip: frames of the source, repeated along the clip at the lane's height.
        <span
          aria-hidden
          className="absolute inset-0 bg-left bg-repeat-x"
          style={{ backgroundImage: `url(/plate/strip-${clip.strip}.avif)`, backgroundSize: "auto 100%" }}
        />
      ) : null}
      {audio ? <Waveform clip={clip} /> : null}
      {/* Fades are geometry on the clip, the way the app draws them: a wedge. */}
      {fadeIn > 0 ? (
        <span
          aria-hidden
          className="absolute inset-y-0 left-0 bg-black/45"
          style={{ width: `${fadeIn * 100}%`, clipPath: "polygon(0 0, 100% 100%, 0 100%)" }}
        />
      ) : null}
      {fadeOut > 0 ? (
        <span
          aria-hidden
          className="absolute inset-y-0 right-0 bg-black/45"
          style={{ width: `${fadeOut * 100}%`, clipPath: "polygon(100% 0, 100% 100%, 0 100%)" }}
        />
      ) : null}
      {keys && keys.length > 0 ? (
        <div aria-hidden className="absolute inset-x-0 bottom-0.5 h-2">
          {keys.map((k, n) => (
            <span
              key={k}
              className="absolute bottom-0 size-1.5 -translate-x-1/2"
              style={{ left: `${(k / clip.duration) * 100}%` }}
            >
              <span
                className="plate-key block size-1.5 rotate-45 border border-black/50 bg-app-accent"
                style={{ animationDelay: `${n * 70}ms` }}
              />
            </span>
          ))}
        </div>
      ) : null}
      <div className="relative flex h-full items-start gap-1 px-1.5 py-1">
        <K aria-hidden className="mt-px size-3 shrink-0 text-app-on-media/70" />
        <span
          className={`truncate text-[11px] leading-tight font-medium text-app-on-media ${
            clip.strip ? "-mx-0.5 rounded-[2px] bg-black/55 px-0.5" : ""
          }`}
        >
          {clip.name}
        </span>
        {linked ? <Link2 aria-hidden className="mt-px size-3 shrink-0 text-app-on-media/80" /> : null}
        {linked && clip.id === "walk" ? (
          <VolumeX aria-hidden className="mt-px size-3 shrink-0 text-app-on-media/80" />
        ) : null}
      </div>
    </div>
  );
}

export function AppPlate({ step, live = false }: { step: number; live?: boolean }) {
  const s = stateAt(step);
  const clips = [...s.clips.values()];
  // Clips that abut on V1 make a junction; the app marks each, quietly until it carries a transition.
  const v1 = clips.filter((c) => c.track === "V1").sort((a, b) => a.from - b.from);
  const junctions = v1
    .slice(1)
    .filter((c, i) => v1[i].from + v1[i].duration === c.from)
    .map((c) => c.from);
  // With a fifth track the lanes outgrow the panel, and it is scrolled to keep the new one in view.
  const scrollLanes = s.tracks.length > 4;

  return (
    // The window, set on night: 12px corners like every surface on the site,
    // and an edge one step lighter than the app's own hairline so it holds its
    // shape against the darker ground. No shadow: there is nothing to cast on.
    <div className="@container/plate">
      <div className="relative flex flex-col overflow-hidden rounded-[12px] border border-app-line-strong bg-app-surface-0 font-app text-app-ink-0 antialiased">
        <TopBar edited={s.edited} />

        <div className="flex min-h-0 flex-col @5xl/plate:flex-row">
          <div className="order-2 flex min-w-0 @5xl/plate:order-1">
            <Rail />
            <div className="relative h-[27vh] w-full min-w-0 border-t border-app-line @5xl/plate:h-auto @5xl/plate:w-[300px] @5xl/plate:border-t-0 @5xl/plate:border-r">
              <div className="absolute inset-0">
                <AgentPanel step={step} />
              </div>
            </div>
          </div>

          <div className="order-1 flex min-w-0 flex-1 flex-col @5xl/plate:order-2">
            {/* Preview over transport, beside the inspector. */}
            <div className="flex min-h-0">
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex h-[21vh] items-center justify-center bg-app-surface-0 p-2.5 @md/plate:h-[210px] @4xl/plate:h-[240px]">
                  <div className="relative aspect-video h-full max-w-full bg-black">
                    {/* Frames bay rendered at each state of the edit, cross-faded as the state changes. */}
                    {STILLS.map((f) => (
                      // eslint-disable-next-line @next/next/no-img-element -- a static AVIF, lazily loaded, no optimiser to call.
                      <img
                        key={f}
                        src={`/plate/still-${f}.avif`}
                        alt=""
                        loading="lazy"
                        decoding="async"
                        data-on={s.frame === f ? "" : undefined}
                        className="absolute inset-0 size-full object-cover opacity-0 transition-opacity duration-500 ease-paper data-[on]:opacity-100"
                      />
                    ))}
                    {s.frame === "empty" ? (
                      <div className="absolute top-1/2 left-1/2 flex w-[200px] -translate-1/2 flex-col items-center gap-1.5 text-center">
                        <Film aria-hidden className="size-4 text-app-ink-1" />
                        <p className="text-[11px] text-app-ink-0">Nothing on the timeline yet</p>
                        <p className="hidden text-[10px] leading-snug text-app-ink-2 @md/plate:block">
                          Import media and click a clip to place it at the playhead.
                        </p>
                      </div>
                    ) : null}
                  </div>
                </div>

                <div className="flex h-9 shrink-0 items-center gap-1.5 border-y border-app-line bg-app-surface-1 px-2 text-app-ink-1">
                  <span className="hidden items-center gap-1.5 @xl/plate:flex">
                    <ChevronFirst aria-hidden className="size-4" />
                    <SkipBack aria-hidden className="size-4" />
                  </span>
                  <Play aria-hidden className="size-4 text-app-ink-0" />
                  <span className="hidden items-center gap-1.5 @xl/plate:flex">
                    <SkipForward aria-hidden className="size-4" />
                    <ChevronLast aria-hidden className="size-4" />
                    <span className="mx-1 h-4 w-px bg-app-line-strong" />
                    <Scissors aria-hidden className="size-4" />
                  </span>
                  <span className="mx-auto text-[13px] text-app-ink-0 tabular-nums">
                    {timecode(s.playhead)}
                    <span className="text-[11px] text-app-ink-2"> / {timecode(s.duration)}</span>
                  </span>
                  <span className="hidden items-center gap-2 @xl/plate:flex">
                    <ZoomOut aria-hidden className="size-4" />
                    <span className="relative h-1 w-20 rounded-full bg-app-surface-4">
                      <span className="absolute inset-y-0 left-0 w-[52%] rounded-full bg-app-accent" />
                    </span>
                    <ZoomIn aria-hidden className="size-4" />
                  </span>
                </div>
              </div>

              {/* Positioned, so its sections clip at the preview's height instead
                  of stretching the figure: the app scrolls this panel too. */}
              <div className="relative hidden w-[248px] shrink-0 border-l border-app-line bg-app-surface-1 @4xl/plate:block">
                <div className="absolute inset-0 flex flex-col overflow-hidden">
                  <Inspector s={s} />
                </div>
              </div>
            </div>

            {/* Timeline. A fixed height, the way its panel is: a track that
                arrives takes empty room below the others instead of pushing
                the figure taller. */}
            <div className="relative h-[176px] overflow-hidden bg-app-surface-0 @xl/plate:h-[282px]">
              <div className="relative z-10 flex h-[26px] border-b border-app-line bg-app-surface-0">
                <div className="flex w-16 shrink-0 items-center border-r border-app-line px-2 @xl/plate:w-[148px]">
                  <span className="hidden text-[11px] font-semibold tracking-[0.06em] text-app-ink-1 uppercase @xl/plate:inline">
                    Timeline
                  </span>
                </div>
                <div className="relative flex-1">
                  {Array.from({ length: 10 }, (_, i) => i * 2).map((sec) => (
                    <span
                      key={sec}
                      className={`absolute top-0 h-full border-l border-app-line-strong pl-1 text-[10px] leading-[18px] text-app-ink-2 tabular-nums ${
                        sec % 4 === 0 ? "" : "hidden @xl/plate:block"
                      }`}
                      style={{ left: pct(sec * REEL.fps) }}
                    >
                      0:{String(sec).padStart(2, "0")}
                    </span>
                  ))}
                </div>
              </div>

              <div
                className="transition-transform duration-700 ease-paper"
                style={{ transform: scrollLanes ? "translateY(-30px)" : undefined }}
              >
                {s.tracks.map((track) => {
                  const video = track.kind === "video";
                  return (
                    <div key={track.id} className="plate-in flex">
                      <div
                        className={`flex w-16 shrink-0 flex-col justify-center gap-1 border-b border-l-2 border-b-app-line px-2 @xl/plate:w-[148px] ${
                          video
                            ? "h-9 border-l-app-clip-video-edge @xl/plate:h-[58px]"
                            : "h-[30px] border-l-app-clip-audio-edge @xl/plate:h-[46px]"
                        }`}
                      >
                        <span
                          className={`self-start truncate rounded-[4px] px-1.5 py-px text-[11px] font-semibold text-app-on-media ${
                            video ? "bg-app-clip-video-edge" : "bg-app-clip-audio-edge"
                          }`}
                        >
                          {track.id}
                        </span>
                        <span className="hidden items-center gap-1.5 text-app-ink-1 @xl/plate:flex">
                          <LockOpen aria-hidden className="size-3" />
                          {video ? <Eye aria-hidden className="size-3" /> : null}
                          <Volume2 aria-hidden className="size-3" />
                          <Trash2 aria-hidden className="size-3" />
                        </span>
                      </div>
                      <div className="relative min-w-0 flex-1 border-b border-app-line">
                        {clips
                          .filter((c) => c.track === track.id)
                          .map((c) => (
                            <ClipBody
                              key={c.id}
                              clip={c}
                              selected={s.selected?.id === c.id}
                              keys={s.keys[c.id]}
                              detached={s.detached}
                            />
                          ))}
                        {track.id === "V1"
                          ? junctions.map((j) => {
                              const on = s.transitions.includes(j);
                              return (
                                <span
                                  key={`${j}-${on}`}
                                  aria-hidden
                                  className={`absolute top-1/2 z-10 flex h-3.5 min-w-3.5 -translate-1/2 items-center justify-center rounded-[2px] border ${
                                    on
                                      ? "plate-key border-app-accent/70 bg-app-accent/25 px-[3px] text-app-accent"
                                      : "border-app-line-strong bg-app-surface-3 text-app-ink-1 opacity-40"
                                  }`}
                                  style={{ left: pct(j) }}
                                >
                                  {on ? (
                                    <span className="text-[9px] leading-none tabular-nums">18</span>
                                  ) : (
                                    // The app's own mark for a cut with room to cross: two triangles meeting.
                                    <svg viewBox="0 0 8 10" aria-hidden className="size-2">
                                      <path d="M0 0 L4 5 L0 10 Z M8 0 L4 5 L8 10 Z" fill="currentColor" />
                                    </svg>
                                  )}
                                </span>
                              );
                            })
                          : null}
                      </div>
                    </div>
                  );
                })}
                <div className="flex h-[30px]">
                  <div className="flex w-16 shrink-0 items-center gap-2 border-b border-app-line px-2 text-[11px] text-app-ink-2 @xl/plate:w-[148px]">
                    <span className="hidden @xl/plate:inline">Add track</span>
                    <span className="ml-auto hidden items-center gap-2 @xl/plate:flex">
                      <Video aria-hidden className="size-3" />
                      <Music aria-hidden className="size-3" />
                    </span>
                  </div>
                  <div className="flex-1" />
                </div>
              </div>

              {/* The playhead. A layer as wide as the lanes, translated by the
                  playhead's share of the view, so moving it is a transform and
                  a percentage is a frame. */}
              <div
                aria-hidden
                className="pointer-events-none absolute inset-y-0 right-0 left-16 z-20 overflow-hidden @xl/plate:left-[148px]"
              >
                <div
                  data-plate-playhead
                  className={live ? "plate-playhead absolute inset-0" : "absolute inset-0"}
                  // Live, the scroll owns it (globals.css, or ScrollSequence's
                  // fallback). Still, it sits where the step leaves it.
                  style={live ? undefined : { translate: `${pct(s.playhead)} 0` }}
                >
                  <span className="absolute inset-y-0 left-0 w-px bg-app-playhead" />
                  <span className="absolute -top-px -left-[5px] size-0 border-x-[5px] border-t-[7px] border-x-transparent border-t-app-playhead" />
                </div>
              </div>
            </div>

            <div className="hidden h-6 shrink-0 items-center gap-3 border-t border-app-line bg-app-surface-1 px-3 text-[11px] text-app-ink-2 tabular-nums @xl/plate:flex">
              <span>fps 30</span>
              <span>duration {timecode(s.duration)}</span>
              <span>canvas 1920×1080</span>
              <span>media {s.media}</span>
              <span>selected {s.selected ? 1 : 0}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
