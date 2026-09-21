/**
 * The bay project model.
 *
 * Two rules govern every type in this file, and both are load-bearing:
 *
 * 1. **Time on the timeline is frames, never seconds.** A frame index is exact at a given
 *    fps; a float second is not, and rounding it at each hop is how a cut drifts by a frame
 *    over a long edit. Source offsets into media are the one exception — those are
 *    microseconds, because the source has its own frame rate we do not control.
 * 2. **Assets are the "what", items are the "where and when".** One asset can back many
 *    items. Anything about the source file lives on the asset; anything about a particular
 *    appearance on the timeline lives on the item. Changing where a clip sits must never
 *    require touching the asset.
 */

export type AssetKind = 'video' | 'audio' | 'image' | 'gif' | 'text' | 'html'
export type TrackKind = 'video' | 'audio'

/** Microseconds. Used for durations and offsets that belong to source media. */
export type Micros = number

/** A frame index or count on a timeline, at that timeline's fps. */
export type Frames = number

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

export interface Asset {
  id: string
  kind: AssetKind
  /** Display name. Defaults to the file's basename, renameable by the user. */
  name: string
  /** Absolute path on this machine, or null for assets that have no file (text). */
  path: string | null
  /** Source duration. Zero for stills. */
  durationUs: Micros
  /** Intrinsic pixel size. Null when the asset has no picture (audio). */
  width: number | null
  height: number | null
  /** Source frame rate, when the source has one. */
  fps: number | null
  hasAudio: boolean
  hasVideo: boolean
  /** Absolute path to a cached poster frame, once one has been generated. */
  posterPath: string | null
  /** Absolute path to a cached peaks file, once one has been generated. */
  waveformPath: string | null
  /** For `kind: 'text'` — the string to draw. */
  text?: string
  /**
   * For `kind: 'html'` — the composition's own id, which is the key its paused timeline
   * registers under as `window.__timelines[compositionId]`.
   *
   * The only thing a composition declares that has nowhere else to live: its duration is
   * `durationUs`, its authored size is `width`/`height`, and its file is `path`. Without the
   * id there is no handle to seek, so an html asset missing it cannot be drawn — which is why
   * `readComposition` treats an absent or empty `data-composition-id` as fatal rather than
   * guessing at the first root in the file.
   */
  compositionId?: string
  createdAt: number
  /** Set when probing failed; the asset still lists, but cannot be placed. */
  error?: string
}

// ---------------------------------------------------------------------------
// Timeline
// ---------------------------------------------------------------------------

/** Where an item sits on the canvas. Origin is top-left of the canvas, in canvas pixels. */
export interface Layout {
  left: number
  top: number
  width: number
  height: number
  /** 0..1 */
  opacity: number
  /** Degrees, clockwise, about the item's centre. */
  rotation: number
}

/**
 * How a text item is drawn.
 *
 * **On the item rather than the asset, and the reason is not aesthetic.** No tool in the MCP
 * catalog writes to an `Asset` — so style on the asset would mean an agent can place a title
 * and never colour it, which is exactly the gap this exists to close. It would need a
 * fifteenth tool to reach, and a half-reachable feature is worse than an absent one.
 *
 * The model's own rule says the same thing from the other direction: the source lives on the
 * asset, the appearance on the item. A text asset has no file — `path` is null and the string
 * *is* the source — so font, colour and alignment are not the source, they are how this
 * appearance is drawn. `layout` is already on the item, and font size interacts directly with
 * that box; splitting the look across both types would leave half on each.
 *
 * **Optional, so it costs nothing to add.** A required field would touch fifteen construction
 * sites across fourteen files and need a migration; `undefined` means exactly the look that
 * shipped before this existed.
 *
 * **Nested nullable sub-objects rather than sixteen flat fields**, so "off" is one `null` and
 * a partial update merges the way `layout` already does — an agent sets `{ color: '#fff' }`
 * without restating the rest.
 *
 * Known and deliberately unsolved: a caption track is two hundred items wanting one style,
 * and per-item style means two hundred identical copies. Fine for now — an agent loops, the
 * UI multi-selects — but if captions are built on this, a shared style reference is the thing
 * that will be missing. Better to know that now than two hundred items later.
 */
export interface TextStyle {
  /** A stack. Must be installed on the machine; there are no webfonts here. */
  fontFamily: string
  /**
   * Canvas pixels, explicit rather than derived.
   *
   * Auto-shrink remains the last resort *after* wrapping, and when it fires it must be
   * reported: a title silently rendered at 40% of the size asked for is a lie the agent
   * cannot see, and the same shape as a playhead that clamps without saying so.
   */
  fontSize: number
  /** 100..900. */
  fontWeight: number
  italic: boolean
  color: string
  align: 'left' | 'center' | 'right'
  verticalAlign: 'top' | 'middle' | 'bottom'
  /** Multiple of `fontSize`. */
  lineHeight: number
  /** Canvas pixels. */
  letterSpacing: number
  stroke: { color: string; width: number } | null
  shadow: { color: string; blur: number; offsetX: number; offsetY: number } | null
  background: { color: string; padding: number; radius: number } | null
}

/**
 * Per-clip image adjustments, rendered through the canvas `filter` property.
 *
 * **Adjustments, not colour correction, and the name is the honest part.** These are a look
 * control: a saturation multiplier and a hue rotation are not lift/gamma/gain, and calling
 * them a grade would promise something 2D canvas genuinely cannot reach. The real version
 * needs a WebGL pass and a second render path that must match this one exactly — which would
 * cost the property that makes this codebase unusual, that preview, export and the agent's
 * `preview_frame` all composite through one implementation.
 *
 * Verified on the export target before being offered, because an effect that works in
 * preview and vanishes from the delivered file is the canonical web-editor bug: every value
 * here applies on the `OffscreenCanvas` the exporter builds, with `blur(0px)` and a nonsense
 * filter as negative controls.
 *
 * Blur was nearly excluded on a measurement that turned out to be about the canvas rather
 * than the filter — +31ms a frame at 4K against a software-backed target, +0.3ms against a
 * GPU-backed one.
 */
export interface Adjustments {
  /** 1 is unchanged. */
  brightness: number
  contrast: number
  saturate: number
  /** Degrees. 0 is unchanged. */
  hueRotate: number
  /** Canvas pixels. 0 is off. */
  blur: number
  /** 0..1. */
  grayscale: number
  sepia: number
  invert: number
}

/**
 * How a clip combines with what is under it.
 *
 * The fifteen separable and non-separable blend modes, deliberately not the full
 * `GlobalCompositeOperation` union — the Porter-Duff operators in that type are compositing
 * operations rather than blend modes, and offering `destination-atop` in a look menu would be
 * a control whose name means nothing to anyone choosing it.
 */
export type BlendMode =
  | 'normal'
  | 'multiply'
  | 'screen'
  | 'overlay'
  | 'darken'
  | 'lighten'
  | 'color-dodge'
  | 'color-burn'
  | 'hard-light'
  | 'soft-light'
  | 'difference'
  | 'exclusion'
  | 'hue'
  | 'saturation'
  | 'color'
  | 'luminosity'

/** The identity adjustments — exactly the look of an item with none. */
export function defaultAdjustments(): Adjustments {
  return {
    brightness: 1,
    contrast: 1,
    saturate: 1,
    hueRotate: 0,
    blur: 0,
    grayscale: 0,
    sepia: 0,
    invert: 0
  }
}

/**
 * There is deliberately no filter-string builder here.
 *
 * There were two — this one and `adjustmentFilter` in `renderer/src/engine/looks.ts` — and they
 * disagreed in ways that mattered: this one emitted `blur` fifth, in field order, while the
 * engine emits it last so it blurs corrected colour rather than colour about to be corrected,
 * and `contrast(0.5) blur(4px) grayscale(1)` is a different picture from
 * `contrast(0.5) grayscale(1) blur(4px)`. `mcp/adjustments.ts` reported this one's output as
 * "the filter the compositor will use" while the canvas drew the other's, which made a tool
 * result a confident lie about a picture the agent cannot see.
 *
 * The engine's is the survivor, because a CSS filter string is only ever consumed by a canvas
 * and the thing that composites is the only honest source for it. Its `1e-6` identity epsilon
 * came from here: a strict comparison puts `brightness: 1.0000001` on the filtered path, which
 * costs roughly twice as much at 4K to produce an image nobody can tell apart.
 *
 * `Adjustments` and `defaultAdjustments` stay — they are the model. Only the mapping to CSS left.
 */

export interface Item {
  id: string
  assetId: string
  trackId: string
  /** First frame of this item on the timeline. */
  from: Frames
  /** How many frames it plays for. Always >= 1. */
  durationInFrames: Frames
  /** Where in the source this item starts reading. Ignored for stills. */
  sourceStartUs: Micros
  layout: Layout
  /** 0..2, linear gain applied to this item's own audio. */
  volume: number
  fadeInFrames: Frames
  fadeOutFrames: Frames
  /** Playback rate multiplier. 1 is source speed. */
  speed: number
  /**
   * Text styling. Only meaningful when the item's asset is `kind: 'text'`; absent elsewhere,
   * and absent on text items written before this field existed.
   */
  text?: TextStyle
  /** Image adjustments. Absent means no filter is applied at all, which is the fast path. */
  adjustments?: Adjustments
  /** How this clip combines with what is beneath it. Absent means `normal`. */
  blendMode?: BlendMode
}

/**
 * The defaults a text item takes when nothing has been chosen — and, exactly, the look that
 * shipped before `TextStyle` existed. Pinned as a function rather than a shared constant so
 * one item's edits can never reach another's.
 */
export function defaultTextStyle(fontSize = 96): TextStyle {
  return {
    fontFamily: 'system-ui, -apple-system, Helvetica, Arial, sans-serif',
    fontSize,
    fontWeight: 600,
    italic: false,
    color: '#FFFFFF',
    align: 'center',
    verticalAlign: 'middle',
    lineHeight: 1.2,
    letterSpacing: 0,
    stroke: null,
    shadow: null,
    background: null
  }
}

export interface Track {
  id: string
  kind: TrackKind
  /** Display name: V1, V2, A1, A2 … Derived on creation, renameable. */
  name: string
  locked: boolean
  muted: boolean
  hidden: boolean
  items: Item[]
}

/**
 * What a transition draws. The names are the ones every editor uses, so an agent asking for
 * a "cross dissolve" gets one; the set is deliberately the universal intersection rather
 * than a catalogue, because a transition nobody recognises is a control nobody reaches for.
 */
export type TransitionKind =
  | 'cross-dissolve'
  | 'dip-to-black'
  | 'dip-to-white'
  | 'wipe'
  | 'push'
  | 'slide'
  | 'iris'

/** Where a directional transition comes from. Ignored by kinds that have no direction. */
export type TransitionDirection = 'left' | 'right' | 'up' | 'down'

/**
 * A transition across the cut between two adjacent items on one track.
 *
 * **It belongs to the junction, not to either clip**, which is why it lives on the timeline
 * rather than on an `Item`. `fadeInFrames` could live on an item because a fade involves one
 * clip and its own edge; a transition is a relationship, and putting it on one side would
 * make "which clip owns it" a question every reader has to answer.
 *
 * **It straddles the cut and moves nothing.** The outgoing clip keeps playing for
 * `durationInFrames / 2` past its own end, and the incoming clip starts the same amount
 * early — both reading source material outside the range they normally occupy, which editors
 * call handles. The alternative model, used by Premiere and Resolve, physically overlaps the
 * two clips and shortens the timeline. We cannot: two items on one track must never overlap,
 * and relaxing that to support transitions would put every existing operation — placement,
 * ripple, collision refusal — into a world where overlap is sometimes legal. Straddling keeps
 * the invariant and costs only handles.
 *
 * **A clip without handles cannot support the full duration**, and this is where a naive
 * implementation lies. If the outgoing clip ends at its source's last frame, there is nothing
 * to play during its half of the transition, and drawing its final frame repeatedly is a
 * freeze that reads as a stutter. `resolveTransition` clamps to what the handles allow and
 * **reports the clamp**, so a caller can say "this dissolve is 8 frames, not 30, because the
 * clip has no more footage" rather than silently producing something worse than a cut.
 */
export interface Transition {
  id: string
  kind: TransitionKind
  /** The item being left. The cut is at `itemEnd(fromItem)`. */
  fromItemId: string
  /** The item being entered. Must start exactly where `fromItem` ends. */
  toItemId: string
  /** Total length across the cut, half on each side. Always >= 2 so each side gets one. */
  durationInFrames: Frames
  direction?: TransitionDirection
  /** Kind-specific extras — feather width, iris shape. Absent means the kind's default. */
  params?: Record<string, number | string>
}

export interface Timeline {
  id: string
  name: string
  fps: number
  width: number
  height: number
  /** Background shown wherever no video track has an item. CSS colour. */
  background: string
  /**
   * Video tracks stack: later entries in this array render on top. Audio tracks mix in
   * parallel and their order carries no meaning beyond display.
   */
  tracks: Track[]
  /**
   * Transitions across cuts. Optional so every project written before transitions existed
   * still loads — `.bay` files on disk are a compatibility surface and a required field
   * would reject all of them.
   */
  transitions?: Transition[]
}

export interface Project {
  id: string
  name: string
  /** Schema version. Bump when a migration is needed; `migrate()` keys off it. */
  version: number
  assets: Asset[]
  timelines: Timeline[]
  activeTimelineId: string
  createdAt: number
  updatedAt: number
  /** Absolute path this project was last saved to, or null if never saved. */
  filePath?: string | null
}

export const PROJECT_VERSION = 1

// ---------------------------------------------------------------------------
// Time helpers — the only places frames and real time are allowed to meet
// ---------------------------------------------------------------------------

export const US_PER_SECOND = 1_000_000

export function framesToUs(frames: Frames, fps: number): Micros {
  return Math.round((frames / fps) * US_PER_SECOND)
}

export function usToFrames(us: Micros, fps: number): Frames {
  return Math.round((us / US_PER_SECOND) * fps)
}

export function framesToSeconds(frames: Frames, fps: number): number {
  return frames / fps
}

export function secondsToFrames(seconds: number, fps: number): Frames {
  return Math.round(seconds * fps)
}

/** `1:04:09` / `4:09` / `0:09`, plus frames when `withFrames`. */
export function formatTimecode(frames: Frames, fps: number, withFrames = false): string {
  const safeFps = fps > 0 ? fps : 30
  const total = Math.max(0, Math.floor(frames))
  const totalSeconds = Math.floor(total / safeFps)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const rest = total % safeFps
  const pad = (n: number): string => String(n).padStart(2, '0')
  const clock =
    hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`
  return withFrames ? `${clock}:${pad(rest)}` : clock
}

// ---------------------------------------------------------------------------
// Queries — pure, shared by the renderer engine, the UI and the main process
// ---------------------------------------------------------------------------

export function itemEnd(item: Item): Frames {
  return item.from + item.durationInFrames
}

export function itemsOverlap(a: Item, b: Item): boolean {
  return a.from < itemEnd(b) && b.from < itemEnd(a)
}

/** Last frame touched by any item, i.e. the timeline's duration. */
export function timelineDuration(timeline: Timeline): Frames {
  let end = 0
  for (const track of timeline.tracks) {
    for (const item of track.items) {
      const itemEndFrame = itemEnd(item)
      if (itemEndFrame > end) end = itemEndFrame
    }
  }
  return end
}

export function findTimeline(project: Project, timelineId: string): Timeline | undefined {
  return project.timelines.find((t) => t.id === timelineId)
}

export function activeTimeline(project: Project): Timeline | undefined {
  return findTimeline(project, project.activeTimelineId)
}

export function findAsset(project: Project, assetId: string): Asset | undefined {
  return project.assets.find((a) => a.id === assetId)
}

export function findTrack(timeline: Timeline, trackId: string): Track | undefined {
  return timeline.tracks.find((t) => t.id === trackId)
}

export function findItem(
  timeline: Timeline,
  itemId: string
): { item: Item; track: Track } | undefined {
  for (const track of timeline.tracks) {
    const item = track.items.find((i) => i.id === itemId)
    if (item) return { item, track }
  }
  return undefined
}

export function allItems(timeline: Timeline): Item[] {
  return timeline.tracks.flatMap((t) => t.items)
}

/**
 * Every item playing at `frame`, ordered the way the compositor must draw them:
 * lowest video track first, so later entries paint on top.
 *
 * **This answers a question about picture, not about sound.** `hidden` and `muted` are two
 * independent properties of a track and they govern two independent outputs:
 *
 * - `hidden` blanks the **picture** and nothing else. A hidden video track carrying speech
 *   keeps being heard. This is what every NLE does, and the reason is editorial: hiding a
 *   layer to see what is underneath it must not silently change the mix you are judging.
 * - `muted` silences the **sound** and nothing else, on a track of either kind — a video
 *   track carries audio, so it needs a mute of its own, and `AudioEngine` honours
 *   `track.muted` regardless of `track.kind`.
 *
 * So a consumer that wants sound must not filter on `hidden`, and must not reach this
 * function for the list — `AudioEngine.update` walks the tracks itself, deliberately,
 * because a muted track still has to reach its analyser or the meter goes dark and the user
 * cannot see what they muted.
 *
 * The trap this replaced: the compositor's "pause anything I did not draw" sweep silenced a
 * hidden track as a side effect, so hiding a picture killed its sound with no way to get it
 * back short of un-hiding. An element is idle only when *neither* the compositor nor the
 * audio engine wants it.
 */
export function itemsAtFrame(timeline: Timeline, frame: Frames, kind?: TrackKind): Item[] {
  const out: Item[] = []
  for (const track of timeline.tracks) {
    if (kind && track.kind !== kind) continue
    if (track.kind === 'video' && track.hidden) continue
    if (track.kind === 'audio' && track.muted) continue
    for (const item of track.items) {
      if (frame >= item.from && frame < itemEnd(item)) out.push(item)
    }
  }
  return out
}

/**
 * Where in the source, in microseconds, item `item` is reading at timeline frame `frame`.
 * Honours `speed`. Callers must have checked the frame is inside the item.
 */
export function sourceTimeAt(item: Item, frame: Frames, fps: number): Micros {
  const elapsed = framesToUs(frame - item.from, fps)
  return item.sourceStartUs + Math.round(elapsed * item.speed)
}

// ---------------------------------------------------------------------------
// Transitions
// ---------------------------------------------------------------------------

/**
 * How many timeline frames of source a clip has left *after* its out-point, and *before* its
 * in-point. These are its handles, and they are what a transition spends.
 *
 * A still — an image, or text — has no source duration and can be held for any length, so its
 * handles are unbounded. Reporting zero for a still would refuse transitions on exactly the
 * clips where they are safest.
 */
export function handlesFor(asset: Asset | undefined, item: Item, fps: number): {
  before: Frames
  after: Frames
} {
  if (!asset || asset.durationUs <= 0) {
    return { before: Number.POSITIVE_INFINITY, after: Number.POSITIVE_INFINITY }
  }
  const speed = item.speed > 0 ? item.speed : 1
  const consumedUs = framesToUs(item.durationInFrames, fps) * speed
  const sourceEndUs = item.sourceStartUs + consumedUs
  const beforeUs = Math.max(0, item.sourceStartUs)
  const afterUs = Math.max(0, asset.durationUs - sourceEndUs)
  return {
    before: Math.floor(usToFrames(beforeUs, fps) / speed),
    after: Math.floor(usToFrames(afterUs, fps) / speed)
  }
}

export interface ResolvedTransition {
  transition: Transition
  from: Item
  to: Item
  /** Effective length after clamping to the handles both clips actually have. */
  durationInFrames: Frames
  /** The frame the two clips meet on. */
  cutFrame: Frames
  /** Inclusive window the transition occupies. */
  firstFrame: Frames
  lastFrame: Frames
  /**
   * Why the effective duration is shorter than the one asked for, or null.
   *
   * Present so a caller can say "8 frames, not 30, because the outgoing clip has no footage
   * past its end" instead of quietly producing a freeze. A transition that silently shortens
   * is a control that does not do what it says.
   */
  clampedBecause: string | null
}

/**
 * Turn a stored transition into the window and the two items it plays across, or null if it
 * no longer describes a real junction — the items were deleted, moved apart, or are no longer
 * adjacent. A stale transition is dropped rather than drawn somewhere it does not belong.
 */
export function resolveTransition(
  project: Project,
  timeline: Timeline,
  transition: Transition
): ResolvedTransition | null {
  const from = findItem(timeline, transition.fromItemId)?.item
  const to = findItem(timeline, transition.toItemId)?.item
  if (!from || !to) return null
  // Abutting is the whole premise: the window is centred on a cut, and there is no cut if
  // the clips have drifted apart or overlap.
  if (itemEnd(from) !== to.from) return null

  const cutFrame = to.from
  const asked = Math.max(2, Math.floor(transition.durationInFrames))
  const half = Math.floor(asked / 2)

  const fromHandles = handlesFor(findAsset(project, from.assetId), from, timeline.fps)
  const toHandles = handlesFor(findAsset(project, to.assetId), to, timeline.fps)

  // Each side also cannot eat more than the clip's own length, or the transition would begin
  // before the clip it is leaving.
  const fromRoom = Math.min(fromHandles.after, from.durationInFrames)
  const toRoom = Math.min(toHandles.before, to.durationInFrames)

  let clampedBecause: string | null = null
  let effectiveHalf = half
  if (fromRoom < effectiveHalf) {
    effectiveHalf = Math.max(0, fromRoom)
    clampedBecause = `the outgoing clip has only ${fromRoom} frames of footage past its end`
  }
  if (toRoom < effectiveHalf) {
    effectiveHalf = Math.max(0, toRoom)
    clampedBecause = `the incoming clip has only ${toRoom} frames of footage before its start`
  }

  const duration = effectiveHalf * 2
  if (duration < 2) return null

  return {
    transition,
    from,
    to,
    durationInFrames: duration,
    cutFrame,
    firstFrame: cutFrame - effectiveHalf,
    lastFrame: cutFrame + effectiveHalf - 1,
    clampedBecause
  }
}

/**
 * The transition playing at `frame`, with its progress 0..1, or null.
 *
 * Progress is the only number a renderer needs: 0 means show the outgoing clip alone, 1 the
 * incoming alone. That contract is worth stating because every gl-transitions shader assumes
 * it, so a future WebGL path can consume the same value unchanged.
 */
export function transitionAtFrame(
  project: Project,
  timeline: Timeline,
  frame: Frames
): { resolved: ResolvedTransition; progress: number } | null {
  for (const transition of timeline.transitions ?? []) {
    const resolved = resolveTransition(project, timeline, transition)
    if (!resolved) continue
    if (frame < resolved.firstFrame || frame > resolved.lastFrame) continue
    const span = resolved.lastFrame - resolved.firstFrame + 1
    const progress = span <= 1 ? 1 : (frame - resolved.firstFrame) / (span - 1)
    return { resolved, progress: Math.max(0, Math.min(1, progress)) }
  }
  return null
}

/**
 * Where in the source an item is reading at `frame`, **allowing frames outside its own
 * range** so a transition can play its handles.
 *
 * `sourceTimeAt` requires the caller to have checked the frame is inside the item, which is
 * right for ordinary drawing and wrong here: during a transition the outgoing clip is asked
 * for time past its end and the incoming for time before its start. Same arithmetic, without
 * the precondition, and named differently so nobody removes the check from the other one.
 */
export function sourceTimeAtUnclamped(item: Item, frame: Frames, fps: number): Micros {
  const elapsed = framesToUs(frame - item.from, fps)
  return Math.max(0, item.sourceStartUs + Math.round(elapsed * item.speed))
}

/** The item's own fade envelope at `frame`, 0..1. Multiplies layout opacity / volume. */
export function fadeGainAt(item: Item, frame: Frames): number {
  const local = frame - item.from
  const remaining = item.durationInFrames - local
  let gain = 1
  if (item.fadeInFrames > 0 && local < item.fadeInFrames) {
    gain = Math.min(gain, local / item.fadeInFrames)
  }
  if (item.fadeOutFrames > 0 && remaining < item.fadeOutFrames) {
    gain = Math.min(gain, remaining / item.fadeOutFrames)
  }
  return Math.max(0, Math.min(1, gain))
}

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

export function defaultLayout(timeline: Pick<Timeline, 'width' | 'height'>): Layout {
  return {
    left: 0,
    top: 0,
    width: timeline.width,
    height: timeline.height,
    opacity: 1,
    rotation: 0
  }
}

/**
 * The layout that makes an asset *cover* the canvas without distortion — scaled up until
 * both axes are filled, then centred, so the overflow is clipped evenly on both sides.
 * Cropping into the source is a different operation and is deliberately not this one.
 */
export function coverLayout(
  timeline: Pick<Timeline, 'width' | 'height'>,
  sourceWidth: number,
  sourceHeight: number
): Layout {
  if (sourceWidth <= 0 || sourceHeight <= 0) return defaultLayout(timeline)
  const scale = Math.max(timeline.width / sourceWidth, timeline.height / sourceHeight)
  const width = Math.round(sourceWidth * scale)
  const height = Math.round(sourceHeight * scale)
  return {
    left: Math.round((timeline.width - width) / 2),
    top: Math.round((timeline.height - height) / 2),
    width,
    height,
    opacity: 1,
    rotation: 0
  }
}

/** The layout that *fits* an asset inside the canvas, letterboxing rather than clipping. */
/**
 * How much of a source must survive a crop before covering the frame is the better default.
 *
 * Cover fills the frame and crops whatever does not fit; contain shows everything and pads.
 * For a small mismatch cover is plainly right — nobody wants black slivers down the side of a
 * 16:9 clip on a 16:10 canvas. For a large one it is destructive: a phone video on a landscape
 * timeline keeps 31% of the picture and silently discards the rest, which reads as bay having
 * mangled the clip rather than as a framing choice.
 *
 * 0.9 puts the line at a tenth of the picture. 16:9 into 16:10 keeps 90% and covers; 4:3 either
 * way keeps 75% and is padded, which is the convention every viewer already understands.
 */
const MIN_COVER_VISIBLE = 0.9

/**
 * The layout a clip gets when it is first placed.
 *
 * Cover or contain, chosen by how much of the source cover would discard. Both are still one
 * click away in the inspector — this only decides which one a clip starts with, and the aim is
 * that the first thing you see is the whole shot rather than a band out of the middle of it.
 */
export function placementLayout(
  timeline: Pick<Timeline, 'width' | 'height'>,
  sourceWidth: number,
  sourceHeight: number
): Layout {
  if (sourceWidth <= 0 || sourceHeight <= 0) return defaultLayout(timeline)
  return coverKeeps(timeline, sourceWidth, sourceHeight) >= MIN_COVER_VISIBLE
    ? coverLayout(timeline, sourceWidth, sourceHeight)
    : containLayout(timeline, sourceWidth, sourceHeight)
}

/**
 * The fraction of the source that survives `coverLayout`, from 0 to 1.
 *
 * Exactly the ratio of the two aspect ratios: covering scales until the narrower dimension
 * fills, so what is lost is entirely the difference in shape. 1 means the shapes match and
 * cover crops nothing.
 */
export function coverKeeps(
  timeline: Pick<Timeline, 'width' | 'height'>,
  sourceWidth: number,
  sourceHeight: number
): number {
  if (sourceWidth <= 0 || sourceHeight <= 0 || timeline.width <= 0 || timeline.height <= 0) return 1
  const source = sourceWidth / sourceHeight
  const frame = timeline.width / timeline.height
  return Math.min(source, frame) / Math.max(source, frame)
}

export function containLayout(
  timeline: Pick<Timeline, 'width' | 'height'>,
  sourceWidth: number,
  sourceHeight: number
): Layout {
  if (sourceWidth <= 0 || sourceHeight <= 0) return defaultLayout(timeline)
  const scale = Math.min(timeline.width / sourceWidth, timeline.height / sourceHeight)
  const width = Math.round(sourceWidth * scale)
  const height = Math.round(sourceHeight * scale)
  return {
    left: Math.round((timeline.width - width) / 2),
    top: Math.round((timeline.height - height) / 2),
    width,
    height,
    opacity: 1,
    rotation: 0
  }
}

export interface CanvasPreset {
  id: string
  label: string
  width: number
  height: number
  fps: number
}

export const CANVAS_PRESETS: CanvasPreset[] = [
  { id: 'landscape-1080', label: '1920 × 1080 · 16:9', width: 1920, height: 1080, fps: 30 },
  { id: 'vertical-1080', label: '1080 × 1920 · 9:16', width: 1080, height: 1920, fps: 30 },
  { id: 'square-1080', label: '1080 × 1080 · 1:1', width: 1080, height: 1080, fps: 30 },
  { id: 'landscape-4k', label: '3840 × 2160 · 4K', width: 3840, height: 2160, fps: 30 }
]
