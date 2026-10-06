/**
 * Draws one timeline frame.
 *
 * The compositor is synchronous and total: given a frame it always returns, always leaves
 * the context's state as it found it, and never throws for anything the project model can
 * contain. A NaN in a layout, a 1x1 canvas, an asset whose file was deleted under us and a
 * clip whose decoder has not produced a picture yet are all normal inputs here.
 *
 * It owns the transport of `<video>` elements, because the picture is what they exist for:
 * during playback it lets them run and only corrects gross drift, while scrubbing it pins
 * each one to the exact source time. `<audio>` elements belong to the audio engine for the
 * same reason — split by element type so there is never a question of who moved something.
 */

import {
  fadeGainAt,
  findAsset,
  itemsAtFrame,
  resolveTransition,
  transitionAtFrame,
  type Asset,
  type TransitionKind,
  type Item,
  type Project,
  type Timeline,
  isCropped,
  cropSourceRect,
  cropDestRect,
  playableTimeline,
  TRANSPARENT_BACKGROUND
} from '@shared/project'
import { animatedItemAt } from '@shared/keyframes'
import { matteRecordAt, MAX_MASK_FEATHER, shapeMasksOf, subjectMaskOf } from '@shared/matte'
import { cutoutAsDrawn, cutoutPartner } from '@shared/behind-subject'
import { subjectMattes, type MatteImage } from './subjectMatte'
import { MaskScratch, maskedPicture, matteRect } from './subjectMask'
import { copiedPicture, ShapeMaskCache, shapedPicture, shapeView } from './shapeMask'
import { adjustmentChangesPicture, AdjustmentScratch, planAdjustment } from './adjustmentLayer'
import { MediaPool, isDrawable, type MediaEntry } from './mediaPool'
import type { CompositionPool } from './compositionPool'
import { planTransition } from './transitions'
import { BrfSurfaces, documentOf, layoutSizeOf, secondsAt } from './brf'
import { paintGlassBackdrop, planGlass, releaseGlassBuffers, surfaceToDevice, type GlassPatch } from './glass'
import { brfRuntime } from './brfCode'
import { importedFonts } from './importedFonts'
import type { BrfDocument } from '@shared/brf'
import { resolveVariables } from '@shared/composition'
import { adjustmentFilter, blendOperation, isPlainLook, NO_FILTER } from './looks'
import { gradeSource, resolvedGradeOf } from './grade'
import { drawEffects, resolvedEffectsOf } from './effects'
import { grainSeed } from '@shared/grade'
import {
  anchorFor,
  fontIsAvailable,
  FONT_PROBE_STRING,
  layoutText,
  resolvedTextStyle,
  type TextFit,
  type TextBox
} from './text'
import {
  DRIFT_TOLERANCE_SECONDS,
  MAX_SEEK_LEAD_MS,
  PLAYBACK_SEEK_PATIENCE_MS,
  PREROLL_SECONDS,
  STALE_SEEK_MS,
  clamp,
  clamp01,
  finite,
  playbackRateFor,
  sourceSecondsAt
} from './sync'

export type RenderTarget = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export interface DrawOptions {
  /**
   * 'playback' lets video elements run and tolerates {@link DRIFT_TOLERANCE_SECONDS} of
   * slip; 'scrub' pauses them and pins each to the frame, which is what a paused playhead
   * and an export both need.
   */
  mode?: 'playback' | 'scrub'
  /** Injectable for tests. */
  now?: () => number
}

export interface DrawStats {
  /** Items that put pixels on the canvas. */
  drawn: number
  /** Items whose media has not decoded anything yet — the frame is incomplete, not empty. */
  pending: number
  /** Items drawn as a placeholder because their asset is missing or unreadable. */
  placeholders: number
  /**
   * The names behind `pending` and `placeholders`.
   *
   * Reported by the compositor because **the code that tried to draw is the only thing that
   * knows what it could not draw.** The caller used to reconstruct this list by asking the
   * `MediaPool` whether each asset had a picture — which is false for every composition, since
   * those come from the `CompositionPool`. So a frame with one pending item named two innocent
   * composition files and never named the real one. Rebuilding the answer from a different
   * source than the question is what made it wrong; a second attempt keyed by the timeline
   * size instead of the scaled render size got it wrong again, differently.
   */
  unresolvedNames: string[]
  /**
   * The names behind `pending` alone — what this frame is still waiting for, as opposed to what
   * it drew as a placeholder. The exporter reports these when it writes a frame without them, and
   * `unresolvedNames` cannot tell it which is which.
   */
  pendingNames: string[]
  /**
   * The names behind `placeholders` alone, each with why: what this frame drew as a grey card
   * because it could not be drawn at all (a `.brf` that threw, missing or undecodable media).
   * Unlike `pendingNames`, waiting does not help — but an export that wrote such a frame wrote a
   * wrong picture just the same, and used to finish as a clean "Done". Every placeholder site
   * goes through `#placeholder`, so the count, this list and `unresolvedNames` move together.
   */
  placeholderNames: string[]
  /**
   * How each text item actually came out.
   *
   * Reported for the same reason `pending` is: the output looks plausible while being wrong.
   * A title auto-shrunk to 40% reads as a design choice rather than a failure, and a
   * substituted font has no visual cue at all — neither a model looking at `preview_frame`
   * nor a user glancing at the canvas can tell. Empty for a frame with no text.
   */
  textFits: TextFit[]
  /**
   * The transition playing at this frame, if any — and crucially why it is shorter than asked.
   *
   * `clampedBecause` must reach the caller. A 30-frame dissolve silently playing as 8 because
   * the outgoing clip has no footage past its end is the same class of failure as a title
   * silently drawn at 40%: the picture looks deliberate and nothing in it says otherwise.
   */
  transition?: {
    kind: TransitionKind
    /** 0 means the outgoing clip alone, 1 the incoming. */
    progress: number
    durationInFrames: number
    requestedFrames: number
    clampedBecause: string | null
  }
  /**
   * Clips whose grade could not be applied, and why — drawn ungraded rather than not at all.
   * Absent when there is nothing to say. A grade that silently fails looks like a grade that was
   * never set, which is the one outcome an agent reading `preview_frame` cannot tell from success.
   * A clip's effect stack reports here too (`effects.ts`): the same slot, the same kind of fault —
   * a pass that did not run — and the same readers (`preview_frame`, the exporter).
   */
  gradeIssues?: string[]
}

interface SeekState {
  targetSeconds: number
  issuedAt: number
  /**
   * A playback seek whose landing has not been timed yet. Only those measure latency: a scrub or
   * preroll seek may have landed long before anyone looks, and would read as a huge latency.
   */
  timing?: boolean
}

/** A subject mask resolved for one draw: the matte frame, and how to apply it. */
interface ResolvedMask {
  matte: MatteImage
  invert: boolean
  /** Timeline pixels. */
  feather: number
}

/** Matte frames fetched ahead of the playhead while playing, so the exact one is usually decoded in time. */
const MATTE_LOOKAHEAD = 6

const PLACEHOLDER_FILL = '#232329'
const PLACEHOLDER_EDGE = '#3a3a44'
const PLACEHOLDER_INK = '#8b8b96'

export class Compositor {
  readonly #pool: MediaPool
  /** Where `.brf` items are painted before they are drawn like any other source. */
  readonly #brf = new BrfSurfaces()
  /**
   * Outstanding seeks, keyed by asset rather than by item. One element cannot be at two
   * source times at once, so two items sharing an asset in the same frame would otherwise
   * issue competing seeks every frame and neither would ever land.
   *
   * Keying alone did **not** achieve that, and the gap was measured rather than argued: two
   * items on one asset wanting 20s and 0s put the element into a permanent seek thrash —
   * each frame re-issued the other's target, `readyState` sat at HAVE_METADATA with
   * `seeking` true, every item reported `pending`, and **the compositor drew nothing at
   * all, for ever**. Not "the lower one shows a stale frame", which is what this comment
   * used to claim: a blank canvas that no `redraw()` could repair. Make the targets agree
   * and the picture returns; make them differ and it vanishes again.
   *
   * The first fix for that was one writer per asset: the topmost item moved the element and
   * everything else painted what it held. That stopped the blank canvas and left a lie in
   * its place — the outgoing clip showing the incoming clip's frame — which is invisible
   * until two items on one asset are both *meant* to be seen. A dissolve between two halves
   * of a split clip is exactly that, and it is the commonest transition there is.
   *
   * So the pool now holds an element **per (asset, slot)** and {@link elementSlots} gives
   * each item in a frame its own. Every item moves its own element; there is still exactly
   * one writer per element, which is what the thrash needed. This map is keyed by element
   * rather than by asset for the same reason — two independent seeks must not overwrite each
   * other's outstanding target.
   *
   * **The hazard is a property of the frame, not of the project, and that distinction cost
   * most of the time spent finding this.** A project holding *one* clip is not safe: placing
   * that same clip a second time is an ordinary edit, and the moment both items sit under
   * the playhead there are two targets for one element. The repro everyone chased looked
   * like a single-item timeline because the *fixture on disk* held one item — measured at
   * the instant the canvas went blank, the timeline held two, both on the same asset, at
   * 20s and 0s. Nothing about a one-item file prevents this; only a one-item *frame* does.
   *
   * A one-item *frame* really is safe, and that is measured rather than assumed: on the
   * pre-fix build, against a one-item fixture, a probe that places nothing drew every time
   * (8/8), while a probe that places the same clip again failed intermittently — 3 of 8 in
   * one run of trials and 9 of 10 in another. Intermittent because it is a race: the loser
   * of the seek fight is whichever draw happens to catch the element mid-seek, which is why
   * this looked unreproducible for an afternoon.
   *
   * **The reload is not the trigger, and that was measured directly rather than inferred**,
   * because the probes both reload *and* place and so cannot tell the two apart. Driven over
   * a debugger with the handle already primed, so that nothing forced a page load: eight
   * consecutive reloads with nothing placed drew all eight times, and then placing one extra
   * item of the same asset — with no reload anywhere — blanked the canvas immediately. One
   * variable at a time is the only way this question has an answer.
   *
   * The blank also *latches*, which is the part that makes it look like a dead engine rather
   * than a race: the seek fight means every draw catches the element mid-seek and draws
   * nothing, and once the fight settles there is no further `seeked` to fire, so nothing
   * schedules the draw that would finally paint it. Measured sitting at `readyState` 4,
   * `seeking` false, on the topmost item's target, with the canvas still empty four seconds
   * later.
   *
   * One ordering trap for whoever measures this next: a probe reloads *first* (restoring the
   * file's single item) and places its second item *after*, so the frame it measures holds
   * two — and if you then attach again to inspect, that second reload restores the file and
   * the placed item is gone before you can see it. Read the timeline in the same evaluation
   * as the pixels, or the evidence destroys itself.
   */
  readonly #seeks = new Map<string, SeekState>()
  /** How long each element's last playback seek took to land, in ms. See `#syncElement`. */
  readonly #seekLatency = new Map<string, number>()

  readonly #compositions: CompositionPool | null
  /** Scratch surfaces for a subject-masked draw (`subjectMask.ts`), reused per size. */
  readonly #maskScratch = new MaskScratch()
  /** Coverage canvases for shape-masked draws (`shapeMask.ts`), kept by what they were made from. */
  readonly #shapeMasks = new ShapeMaskCache()
  /** Where an adjustment layer copies the frame so far (`adjustmentLayer.ts`). Untouched without one. */
  readonly #adjustmentScratch = new AdjustmentScratch()
  /** The project of the frame being drawn — where a graded clip's LUT asset is looked up. */
  #project: Project | null = null
  /** The timeline of the frame being drawn — where a subject cut-out finds the clip it draws its picture from. */
  #timeline: Timeline | null = null

  constructor(pool: MediaPool, compositions?: CompositionPool) {
    this.#compositions = compositions ?? null
    this.#pool = pool
  }

  get pool(): MediaPool {
    return this.#pool
  }

  /**
   * Draws `frame` of `timeline` into `ctx`, in timeline coordinates. The caller owns the
   * transform: the preview leaves it alone, the exporter scales it to the delivery size.
   */
  drawFrame(
    ctx: RenderTarget,
    project: Project,
    timeline: Timeline,
    frame: number,
    options: DrawOptions = {}
  ): DrawStats {
    // Where a subject cut-out finds its clip's picture: the timeline as stored, not the playable one.
    // A switched-off clip still frames its cut-out — measured, looked up in the playable timeline a
    // cut-out drawn with its clip off (background removal, or test/app/mask.mjs's cut-out-alone
    // render) fell back to its framing at creation, 1.15× away from a punched-in clip (IoU 78%).
    this.#timeline = timeline
    // A disabled clip draws nowhere — here, `preview_frame` and export all come through this line.
    timeline = playableTimeline(timeline)
    const mode = options.mode ?? 'scrub'
    const now = options.now ?? (() => performance.now())
    const stats: DrawStats = { drawn: 0, pending: 0, placeholders: 0, textFits: [], unresolvedNames: [], pendingNames: [], placeholderNames: [] }

    this.#pool.beginGeneration()
    // The project's imported fonts registered before anything draws — every drawing path (the
    // preview, `preview_frame`, export) comes through here, so none can draw text in a face the
    // project has and the document does not. A no-op when the font set has not changed.
    importedFonts.sync(project.assets)
    this.#project = project

    const width = Math.max(1, finite(timeline.width, 1))
    const height = Math.max(1, finite(timeline.height, 1))
    const fps = finite(timeline.fps, 30) > 0 ? timeline.fps : 30

    ctx.save()
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    // `'transparent'` is a render of a graphic alone (`render_brf`): the frame must leave here
    // with real alpha, and a fill in a transparent colour would leave the last frame under it.
    if (timeline.background === TRANSPARENT_BACKGROUND) ctx.clearRect(0, 0, width, height)
    else {
      ctx.fillStyle = timeline.background || '#000000'
      ctx.fillRect(0, 0, width, height)
    }

    // The one definition of what this frame draws, shared with `awaitSources` so the element
    // waited on is the element drawn. See `itemsToDraw`.
    const { items: drawing, active } = itemsToDraw(project, timeline, frame)
    const pair = active ? [active.resolved.from, active.resolved.to] : []
    // Decided before any of them is drawn: one element cannot be at two source times, so an
    // asset drawn twice in one frame gets two elements. See `elementSlots`.
    const slots = elementSlots(drawing)

    // In stack order, bottom first; the transition is painted where its pair sits in the list
    // (`itemsToDraw` keeps it at its track's place), so higher tracks draw over it.
    let transitionDrawn = false
    for (const item of drawing) {
      if (pair.some((p) => p.id === item.id)) {
        if (!transitionDrawn && active) {
          this.#paintTransition(ctx, project, active, frame, fps, mode, now, width, height, slots, stats)
        }
        transitionDrawn = true
        continue
      }
      this.#paintItem(ctx, project, item, frame, fps, mode, now(), slots.get(item.id) ?? 0, stats, {})
    }

    ctx.restore()
    // No retire sweep here. Pausing what the *picture* did not use would silence a hidden
    // track, and `hidden` governs picture only. `MediaPool.retireIdle()` does it once both
    // consumers have voted — see the engine.
    return stats
  }

  /**
   * Pauses every video element immediately, without waiting for a draw.
   *
   * The generation sweep normally handles this while frames are arriving. It is not
   * enough when they stop: an occluded window stops
   * `requestAnimationFrame`, so the next draw never comes, and a "stop playing" that is
   * only carried out by the next draw leaves the element running — measured at 4.5 seconds
   * of sound continuing past a frozen picture.
   */
  pauseAll(): void {
    this.#pool.forEach((entry) => {
      const element = entry.element
      if (element instanceof HTMLVideoElement && !element.paused) element.pause()
    })
  }

  /**
   * Puts the element of every clip about to come on screen at that clip's first source frame,
   * paused, before the playhead reaches it. Live playback only — export and `preview_frame`
   * wait for their sources instead, and never call this.
   *
   * Without it the incoming clip's element is wherever it was left (source 0 when new, the end of
   * its last play when warm), so the draw at the cut issues the seek, finds the element mid-seek
   * with nothing drawable, and paints the background: **one black picture at every cut**, cold
   * and warm, graded or not — measured by `test/app/cut-playback.mjs` on the reporter's own takes,
   * whose in-points sit up to 20 frames past their only keyframe. Prerolled, the draw at the cut
   * finds the element already there and only has to press play.
   *
   * Call it after every consumer has acquired what this frame needs and before
   * `MediaPool.retireIdle`: an element anything asked for this generation is in use — the picture
   * of another clip, or a hidden track's sound, which the compositor never sees — and is left
   * alone rather than paused and moved under its user. A same-asset jump cut is that case (one
   * element, two source times); `PictureHold` covers it.
   */
  preroll(project: Project, timeline: Timeline, frame: number, options: { now?: number } = {}): void {
    timeline = playableTimeline(timeline)
    const fps = finite(timeline.fps, 30) > 0 ? timeline.fps : 30
    const now = options.now ?? performance.now()
    for (const target of prerollTargets(project, timeline, frame, Math.ceil(PREROLL_SECONDS * fps))) {
      if (this.#pool.inUse(target.asset.id, target.slot)) continue
      const entry = this.#pool.acquire(target.asset, target.slot)
      const element = entry.element
      if (!(element instanceof HTMLVideoElement)) continue
      if (!element.paused) element.pause()
      const seconds = sourceSecondsAt(target.item, target.asset, target.startFrame, fps)
      // There, or on its way: `currentTime` reads a seek's target from the moment it is set.
      if (Math.abs(element.currentTime - seconds) <= 0.5 / fps) continue
      try {
        element.currentTime = seconds
        // Recorded where the draw will find it: a preroll seek still in flight when the clip
        // starts is then waited for, not restarted (`#syncElement`'s patience).
        this.#seeks.set(`${entry.assetId}#${entry.slot}`, { targetSeconds: seconds, issuedAt: now })
      } catch {
        // Before metadata a seek throws; the next frame asks again.
      }
    }
  }

  /** Drops seek bookkeeping for assets no longer on screen. */
  reset(): void {
    this.#seeks.clear()
    this.#seekLatency.clear()
    this.#brf.reset()
    this.#maskScratch.release()
    this.#shapeMasks.release()
    this.#adjustmentScratch.release()
    releaseGlassBuffers()
  }

  // -- internals ------------------------------------------------------------

  #drawSource(
    ctx: RenderTarget,
    // An ImageBitmap joins the two element types here because a composition frame arrives as
    // pixels rather than as a loaded element. Everything below is geometry, alpha, look and
    // rotation, none of which cares which of the three it was handed.
    element: HTMLVideoElement | HTMLImageElement | ImageBitmap | OffscreenCanvas,
    item: Item,
    frame: number,
    alphaMul = 1,
    stats?: DrawStats,
    /** Glass panes on a `.brf` surface: their backdrop is drawn from the canvas before the surface. */
    glass: GlassPatch[] = [],
    /** A subject matte to keep only the person with (`#subjectMatte`), applied after the grade. */
    mask: ResolvedMask | null = null
  ): void {
    const box = layoutBox(item)
    if (!box) return
    const alpha = clamp01(finite(item.layout.opacity, 1) * fadeGainAt(item, frame) * clamp01(alphaMul))
    if (alpha <= 0) return

    // Read before the rotation is applied, so the device scale is the preview's or the export's
    // and nothing else.
    const transform = ctx.getTransform()
    const scaleX = Math.hypot(transform.a, transform.b) || 1
    const scaleY = Math.hypot(transform.c, transform.d) || 1

    // Shape masks (`@shared/shape-mask`), applied in the mask slot below. Null for a clip with none.
    const shapes = shapeMasksOf(item)
    // Why a shape-masked picture could not be drawn; reported once the transform is put back.
    let shapeFault: string | null = null

    ctx.save()
    ctx.globalAlpha = alpha
    // Both are set inside this item's save/restore, so they cannot leak onto the next item or
    // onto the background fill — a blend mode left set would change how everything above it
    // combines, which looks like a bug in the wrong clip.
    applyLook(ctx, item)
    applyRotation(ctx, item, box)
    try {
      // The source's own pixel size, which each of the three element kinds spells
      // differently — and `videoWidth`/`naturalWidth` are 0 until the first frame decodes,
      // which is why a crop falls back to drawing uncropped rather than skipping: a clip that
      // vanished for two frames while loading would read as a bug in the crop.
      const sourceWidth = intrinsicWidth(element)
      const sourceHeight = intrinsicHeight(element)
      const cropped = isCropped(item.crop) ? cropSourceRect(item.crop, sourceWidth, sourceHeight) : null
      const src = cropped ?? { sx: 0, sy: 0, sw: sourceWidth, sh: sourceHeight }
      const dest = cropped
        ? cropDestRect(item.crop, box)
        : { dx: box.left, dy: box.top, dw: box.width, dh: box.height }

      if (glass.length > 0) this.#glassBackdrop(ctx, item, glass, src, dest, alpha)

      // The grade replaces the source with a graded picture of the same framing, at the size it
      // will be drawn — everything else about the draw (alpha, blend, filter, rotation) is
      // unchanged. An identity grade resolves to null and costs nothing.
      // Times the item's own zoom, which `applyRotation` applies after the device scale was read:
      // a pushed-in clip is graded (and masked) at the size it appears, not upscaled from its box.
      const deviceWidth = Math.max(1, Math.round(Math.abs(dest.dw) * scaleX * zoomOf(item)))
      const deviceHeight = Math.max(1, Math.round(Math.abs(dest.dh) * scaleY * zoomOf(item)))
      // What a mask is applied to: the graded picture when there is one, else the element's crop rect.
      let picture: { source: unknown; sx: number; sy: number; sw: number; sh: number } = { source: element, ...src }
      const grade = resolvedGradeOf(item.grade)
      const lutAsset = grade?.lut && this.#project ? findAsset(this.#project, grade.lut.assetId) : undefined
      const pass = {
        source: element,
        ...src,
        width: deviceWidth,
        height: deviceHeight,
        boxWidth: Math.abs(dest.dw),
        boxHeight: Math.abs(dest.dh),
        frame,
        seed: grainSeed(item.id),
        lut: lutAsset?.kind === 'lut' ? lutAsset.lut : undefined
      }
      // The effect stack (`effects.ts`): after the grade, which it runs itself as its first step,
      // and before the mask. A stack with nothing to draw resolves to null and costs nothing. One
      // that cannot run — or names an effect this build lacks — is reported beside failed grades,
      // so `preview_frame` and an export both say the picture is not the one the timeline describes.
      const effects = resolvedEffectsOf(item.effects)
      let effected = false
      if (effects) {
        for (const issue of effects.issues) noteGradeIssue(stats, `clip ${item.id}: ${issue}`)
        if (effects.active.length > 0 && src.sw > 0 && src.sh > 0) {
          const drawn = drawEffects(effects.active, { ...pass, grade })
          if (drawn.ok) {
            for (const warning of drawn.warnings) noteGradeIssue(stats, `clip ${item.id}: ${warning}`)
            // Shape masks need the mask slot below as much as a subject matte does: drawn here,
            // an effected clip would come out unmasked.
            if (!mask && !shapes) {
              ctx.drawImage(drawn.canvas, 0, 0, drawn.width, drawn.height, dest.dx, dest.dy, dest.dw, dest.dh)
              return
            }
            picture = { source: drawn.canvas, sx: 0, sy: 0, sw: drawn.width, sh: drawn.height }
            effected = true
          } else {
            noteGradeIssue(stats, `clip ${item.id} was drawn without its effects: ${drawn.error}`)
          }
        }
      }
      if (!effected && grade && src.sw > 0 && src.sh > 0) {
        const graded = gradeSource(grade, pass)
        if (graded.ok) {
          if (graded.warning) noteGradeIssue(stats, `clip ${item.id}: ${graded.warning}`)
          if (!mask && !shapes) {
            ctx.drawImage(graded.canvas, 0, 0, graded.width, graded.height, dest.dx, dest.dy, dest.dw, dest.dh)
            return
          }
          picture = { source: graded.canvas, sx: 0, sy: 0, sw: graded.width, sh: graded.height }
        } else {
          noteGradeIssue(stats, `clip ${item.id} was drawn ungraded: ${graded.error}`)
        }
      }

      // The subject mask: after the grade, on the picture at the size it will be drawn, so the
      // preview, `preview_frame` and export mask through this one line. The matte covers the whole
      // source frame, so the crop rect maps onto it by scale (`matteRect`) — which is also what
      // stretches Vision's 4:3 mask back over a 16:9 frame.
      //
      // Shape masks follow on the same surface: the picture (matted or not) has its alpha
      // multiplied by `rasterMasks`' coverage of the part of the clip's frame it shows. The frame
      // is the item's box, so layout, crop, keys, zoom and rotation carry the shapes with the clip.
      if ((mask || shapes) && src.sw > 0 && src.sh > 0) {
        let masked = mask
          ? maskedPicture(
              {
                ...picture,
                width: deviceWidth,
                height: deviceHeight,
                matte: mask.matte,
                ...matteRect(src, sourceWidth, sourceHeight, mask.matte),
                invert: mask.invert,
                featherPx: mask.feather * scaleX * zoomOf(item)
              },
              this.#maskScratch
            )
          : copiedPicture({ ...picture, width: deviceWidth, height: deviceHeight }, this.#maskScratch)
        if (shapes) {
          if ('error' in shapes) {
            masked = null
            shapeFault = shapes.error
          } else if (masked) {
            masked = shapedPicture(masked, shapes, shapeView(box, dest, deviceWidth, deviceHeight), this.#shapeMasks)
            if (!masked) shapeFault = `its ${shapes.length === 1 ? 'mask' : `${shapes.length} masks`} could not be drawn at ${deviceWidth}×${deviceHeight}`
          }
        }
        if (masked) ctx.drawImage(masked as unknown as CanvasImageSource, 0, 0, deviceWidth, deviceHeight, dest.dx, dest.dy, dest.dw, dest.dh)
        return
      }

      if (cropped) {
        ctx.drawImage(element, src.sx, src.sy, src.sw, src.sh, dest.dx, dest.dy, dest.dw, dest.dh)
      } else {
        ctx.drawImage(element, box.left, box.top, box.width, box.height)
      }
    } catch {
      // A frame can be pulled out from under us mid-draw (the element reloaded, the source
      // went away). One missing item must not abandon the rest of the frame.
    } finally {
      ctx.restore()
      // A shape mask that could not be applied: the clip was not drawn (never unmasked — the part
      // the mask was hiding would be in the picture, looking deliberate), and the frame says so.
      // Here, after the transform is put back, because the mask slot leaves by `return`.
      if (shapeFault && stats) this.#placeholder(ctx, item, stats, 'Mask could not be drawn', `clip ${item.id} (${shapeFault})`)
    }
  }

  /**
   * Frosts what the canvas holds under each glass pane, inside the pane, before the surface that
   * paints the pane's tint and rim is drawn over it. Mapped with the transform in force right now
   * — the device scale, any transition offset, the item's rotation and zoom — and the same
   * `src`/`dest` the surface is about to be drawn with, so crop and rotation place the frost where
   * the pane lands, clipped to the surface's drawn rect and the scene inside it. A blend mode
   * other than normal skips it: such an item is meant to combine with what is under it, and
   * replacing that with a blur would contradict the mode — the pane then draws tint and rim only,
   * which the guide says.
   */
  #glassBackdrop(
    ctx: RenderTarget,
    item: Item,
    glass: GlassPatch[],
    src: { sx: number; sy: number; sw: number; sh: number },
    dest: { dx: number; dy: number; dw: number; dh: number },
    alpha: number
  ): void {
    if (blendOperation(item.blendMode) !== 'source-over') return
    const t = ctx.getTransform()
    const toDevice = surfaceToDevice([t.a, t.b, t.c, t.d, t.e, t.f], src, dest)
    if (!toDevice) return
    const canvas = { width: ctx.canvas.width, height: ctx.canvas.height }
    for (const patch of glass) {
      const plan = planGlass(patch, toDevice, canvas, alpha)
      if (!plan) continue
      ctx.save()
      try {
        // Only where the surface itself lands (its box, or its crop), and only inside the scene
        // there: a pane sliding in from off-scene must not frost what the tint and rim cannot reach.
        ctx.beginPath()
        ctx.rect(dest.dx, dest.dy, dest.dw, dest.dh)
        ctx.clip()
        ctx.setTransform(...toDevice)
        ctx.beginPath()
        ctx.rect(patch.scene.x, patch.scene.y, patch.scene.w, patch.scene.h)
        ctx.clip()
        paintGlassBackdrop(ctx, plan)
      } finally {
        ctx.restore()
      }
    }
  }

  /** The transition across this frame: its two sides and any dip, per `planTransition`'s steps. */
  #paintTransition(
    ctx: RenderTarget,
    project: Project,
    active: NonNullable<ReturnType<typeof transitionAtFrame>>,
    frame: number,
    fps: number,
    mode: 'playback' | 'scrub',
    now: () => number,
    width: number,
    height: number,
    slots: Map<string, number>,
    stats: DrawStats
  ): void {
    const { resolved, progress } = active
    stats.transition = {
      kind: resolved.transition.kind,
      progress,
      durationInFrames: resolved.durationInFrames,
      requestedFrames: resolved.transition.durationInFrames,
      clampedBecause: resolved.clampedBecause
    }
    const byWhich = { from: resolved.from, to: resolved.to }
    for (const step of planTransition(
      resolved.transition.kind,
      resolved.transition.direction,
      progress,
      { width, height }
    )) {
      if (step.kind === 'fill') {
        if (step.alpha <= 0) continue
        ctx.save()
        ctx.globalAlpha = clamp01(step.alpha)
        ctx.fillStyle = step.color
        ctx.fillRect(0, 0, width, height)
        ctx.restore()
        continue
      }
      const item = byWhich[step.which]
      ctx.save()
      if (step.clipRect) {
        ctx.beginPath()
        ctx.rect(step.clipRect.left, step.clipRect.top, step.clipRect.width, step.clipRect.height)
        ctx.clip()
      }
      if (step.clipCircle) {
        ctx.beginPath()
        ctx.arc(step.clipCircle.centreX, step.clipCircle.centreY, step.clipCircle.radius, 0, Math.PI * 2)
        ctx.clip()
      }
      ctx.translate(step.offsetX, step.offsetY)
      this.#paintItem(ctx, project, item, frame, fps, mode, now(), slots.get(item.id) ?? 0, stats, {
        alphaMul: step.alpha
      })
      ctx.restore()
    }
  }

  /**
   * Paints one item, whatever kind it is, and records the outcome in `stats`.
   *
   * Extracted so a transition step can reuse it: the same item has to be drawable at an
   * offset, under a clip, at a reduced alpha, and at a frame outside its own range. Having
   * the transition path re-implement any of that is how the two paths drift.
   */
  #paintItem(
    ctx: RenderTarget,
    project: Project,
    item: Item,
    frame: number,
    fps: number,
    mode: 'playback' | 'scrub',
    now: number,
    slot: number,
    stats: DrawStats,
    opts: { alphaMul?: number }
  ): void {
    // Keyframes resolve here, once, into the layout every draw below reads — so a transition's
    // two sides, text, .brf, compositions and placeholders all animate through one sampler, and
    // an item with no keys is passed through as the same object.
    // A subject cut-out draws with its clip's layout, crop, keys, grade and look, read now — so a
    // punch-in or crop of the clip moves the cut-out with it (`cutoutAsDrawn`). Before keys resolve,
    // so the clip's keyframes animate the cut-out through the same sampler.
    if (this.#timeline && item.masks) item = cutoutAsDrawn(item, cutoutPartner(this.#timeline, item))
    item = animatedItemAt(item, frame)
    const asset = findAsset(project, item.assetId)
    if (!asset || asset.error) {
      this.#placeholder(ctx, item, stats, asset?.name ?? 'Missing media', asset ? `${asset.name} (${asset.error ?? 'unreadable'})` : 'a missing asset')
      return
    }

    // An adjustment layer has no source of its own: its picture is the frame drawn so far.
    if (asset.kind === 'adjustment') {
      this.#paintAdjustment(ctx, item, frame, stats, opts.alphaMul)
      return
    }

    const entry = this.#pool.acquire(asset, slot)
    if (entry.status === 'error') {
      this.#placeholder(ctx, item, stats, asset.name, `${asset.name} (could not be decoded)`)
      return
    }

    if (asset.kind === 'text') {
      // An imported face still loading: drawn now, the words would be in a fallback face, which
      // looks deliberate. Incomplete, like a decoding video, and waited for the same way.
      if (item.text && importedFonts.isLoading(item.text.fontFamily)) {
        notePending(stats, asset.name)
        return
      }
      const fit = this.#drawText(ctx, item, asset, frame, opts.alphaMul)
      if (fit) stats.textFits.push(fit)
      stats.drawn += 1
      return
    }

    if (asset.kind === 'brf') {
      // Painted here, from the document, at the size it will appear — no window, no capture,
      // nothing to wait for — then drawn like any source so crop, looks and fades apply.
      const box = layoutBox(item)
      if (!box) return
      const scale = Math.min(1, Math.abs(ctx.getTransform().a) || 1)
      const seconds = secondsAt(asset, item, frame, fps)
      const values = resolveVariables({ variables: asset.compositionVariables ?? [] }, item.variables)
      let doc: BrfDocument
      if (asset.brfCode !== undefined) {
        // Code runs in a worker; its scene for this frame is cached, on its way, or failed.
        const size = layoutSizeOf(asset, box)
        const lastFrame = Math.max(0, Math.ceil((asset.durationUs / 1_000_000) * fps) - 1)
        const scene = brfRuntime.scene(asset.brfCode, values, Math.min(lastFrame, Math.round(seconds * fps)), fps, size.width, size.height)
        if ('pending' in scene) {
          notePending(stats, asset.name)
          return
        }
        if ('error' in scene) {
          this.#placeholder(ctx, item, stats, asset.name, `${asset.name} (${scene.error})`)
          return
        }
        doc = scene.doc
      } else {
        const entry = documentOf(asset)
        if ('error' in entry) {
          this.#placeholder(ctx, item, stats, asset.name, `${asset.name} (${entry.error})`)
          return
        }
        doc = entry.doc
      }
      const painted = this.#brf.draw(doc, item, seconds, box, { width: box.width * scale, height: box.height * scale }, values)
      if ('pending' in painted) {
        // A variable-font face still loading (`brfFonts.ts`): incomplete, not empty.
        notePending(stats, asset.name)
        return
      }
      if ('error' in painted) {
        this.#placeholder(ctx, item, stats, asset.name, `${asset.name} (${painted.error})`)
        return
      }
      const brfMask = this.#subjectMatte(ctx, project, item, asset, null, frame, fps, mode, stats)
      if (brfMask === 'skip') return
      this.#drawSource(ctx, painted.surface, item, frame, opts.alphaMul, stats, painted.glass, brfMask)
      stats.drawn += 1
      return
    }

    if (asset.kind === 'html') {
      // A composition has no media element to sync — it is a page seeked in main and read
      // back as pixels. The pool answers from cache or not at all, so a miss is counted as
      // pending exactly like a video that has not decoded: the background shows through for
      // the frame or two it takes, which reads as a load rather than as a glitch.
      const box = layoutBox(item)
      // Ask for the frame at the size it will actually be drawn, not at the size it occupies
      // in timeline coordinates. A 640x360 preview of a 1920x1080 composition needs a 640x360
      // picture; requesting the full frame allocates an 8MB ImageBitmap per cache entry to
      // throw seven eighths of it away, and doing that continuously took the renderer down.
      // The transform already carries the preview scale that `drawFrame` applied, so this is
      // the exact factor between timeline units and device pixels — no second derivation to
      // disagree with the first.
      const scale = Math.min(1, Math.abs(ctx.getTransform().a) || 1)
      const bitmap = box
        ? (this.#compositions?.frameFor(asset, item, frame, fps, {
            width: Math.max(1, Math.round(box.width * scale)),
            height: Math.max(1, Math.round(box.height * scale))
          }) ?? null)
        : null
      if (!bitmap) {
        notePending(stats, asset.name)
        return
      }
      const htmlMask = this.#subjectMatte(ctx, project, item, asset, null, frame, fps, mode, stats)
      if (htmlMask === 'skip') return
      this.#drawSource(ctx, bitmap, item, frame, opts.alphaMul, stats, [], htmlMask)
      stats.drawn += 1
      return
    }

    // Every item has an element of its own, so every item moves its own — which is what lets
    // two source times coexist in one frame. One writer per element, still: `elementSlots`.
    // No special handling for a frame outside the item's own range, and that is deliberate:
    // `sourceSecondsAt` clamps to the **asset**, not the item, so asking for a time past a
    // clip's end or before its start already reads its handles — which is exactly what a
    // transition needs. A flag saying "unclamped" was written here first and did nothing;
    // nothing could have distinguished its presence from its absence.
    this.#syncElement(entry, item, asset, frame, fps, mode, now)

    if (!isDrawable(entry)) {
      // Nothing decoded yet. Drawing a placeholder here would flash a grey card for the one
      // or two frames a load takes, which reads as a glitch in the edit rather than as a
      // load; the background showing through for that long does not.
      notePending(stats, asset.name)
      return
    }

    const mask = this.#subjectMatte(ctx, project, item, asset, entry.element, frame, fps, mode, stats)
    if (mask === 'skip') return
    this.#drawSource(ctx, entry.element, item, frame, opts.alphaMul, stats, [], mask)
    stats.drawn += 1
  }

  /**
   * An adjustment layer: everything drawn so far, redrawn through this item's grade, adjustments
   * and masks (`adjustmentLayer.ts` has the arithmetic). The copy of the frame goes through
   * `#drawSource` like any clip's picture, so a layer is graded, masked and filtered by the code
   * that does it for clips — in the preview, `preview_frame` and export alike.
   *
   * A layer that would change nothing is skipped before anything is copied. One that cannot be
   * applied leaves the picture under it as it was and says so on the frame (`gradeIssues`, which
   * the export's `incompleteFrames` and `preview_frame`'s `gradeWarnings` carry): a grey card over
   * the whole frame would hide the edit to report a missing look.
   */
  #paintAdjustment(ctx: RenderTarget, item: Item, frame: number, stats: DrawStats, alphaMul = 1): void {
    if (!adjustmentChangesPicture(item)) return
    const alpha = clamp01(finite(item.layout.opacity, 1) * fadeGainAt(item, frame) * clamp01(alphaMul))
    if (alpha <= 0) return
    const size = { width: Math.max(1, finite(this.#timeline?.width ?? 1, 1)), height: Math.max(1, finite(this.#timeline?.height ?? 1, 1)) }
    const shapes = shapeMasksOf(item)
    if (shapes && 'error' in shapes) {
      noteGradeIssue(stats, `adjustment layer ${item.id} was not applied: ${shapes.error}`)
      return
    }
    const plan = planAdjustment(item, size, ctx.getTransform())
    const snapshot = plan ? this.#adjustmentScratch.copy(ctx.canvas, plan) : null
    if (!plan || !snapshot) {
      noteGradeIssue(stats, `adjustment layer ${item.id} was not applied: the frame under it could not be copied`)
      return
    }
    // The hole: what is there, less the layer's share of it — its mask coverage times its alpha.
    let cover: unknown = null
    if (shapes) {
      const box = { left: 0, top: 0, ...size }
      try {
        cover = this.#shapeMasks.get(shapes, size, shapeView(box, { dx: 0, dy: 0, dw: size.width, dh: size.height }, plan.width, plan.height).view)
      } catch {
        cover = null
      }
      if (!cover) {
        noteGradeIssue(stats, `adjustment layer ${item.id} was not applied: its masks could not be drawn at ${plan.width}×${plan.height}`)
        return
      }
    }
    ctx.save()
    ctx.globalAlpha = alpha
    ctx.globalCompositeOperation = 'destination-out'
    if (cover) ctx.drawImage(cover as CanvasImageSource, 0, 0, plan.width, plan.height, 0, 0, size.width, size.height)
    else {
      ctx.fillStyle = '#000000'
      ctx.fillRect(0, 0, size.width, size.height)
    }
    ctx.restore()
    // …and the adjusted copy, added back at that same share.
    this.#drawSource(ctx, snapshot, plan.item, frame, alphaMul, stats)
    stats.drawn += 1
  }

  /**
   * The matte an item's subject mask draws with this frame; `null` when it has no mask; `'skip'`
   * when it cannot be drawn correctly and has already been recorded — pending while a matte frame
   * loads (export and `preview_frame` wait for it), a named placeholder when there is no matte for
   * this moment or it cannot be read. **Never drawn unmasked**: a full copy of the clip over a
   * title hides the title behind a picture that looks deliberate.
   *
   * The moment is the one the picture is showing: a video element's own `currentTime` (the element
   * is shared with the clip under it — `elementSlots` — so both are one decoded frame), and the
   * item's mapped source time for anything without an element.
   */
  #subjectMatte(
    ctx: RenderTarget,
    project: Project,
    item: Item,
    asset: Asset,
    element: MediaEntry['element'] | null,
    frame: number,
    fps: number,
    mode: 'playback' | 'scrub',
    stats: DrawStats
  ): ResolvedMask | null | 'skip' {
    const mask = subjectMaskOf(item)
    if (!mask) return null
    const matteAsset = mask.assetId ? findAsset(project, mask.assetId) : asset
    if (!matteAsset) {
      this.#placeholder(ctx, item, stats, 'Subject matte missing', `${asset.name} (its subject mask names asset ${mask.assetId}, which is not in the project)`)
      return 'skip'
    }
    const seconds =
      element instanceof HTMLVideoElement && matteAsset.id === asset.id
        ? element.currentTime
        : sourceSecondsAt(item, matteAsset, frame, fps)
    const sourceUs = Math.round(seconds * 1_000_000)
    const record = matteRecordAt(matteAsset.subjectMattes, sourceUs)
    if (!record) {
      this.#placeholder(ctx, item, stats, 'Subject matte missing',
        `${asset.name} (no subject matte for ${seconds.toFixed(2)} s of ${matteAsset.name} — run put_behind_subject again to compute it)`)
      return 'skip'
    }
    const found = subjectMattes.lookup(record, sourceUs, { ahead: mode === 'playback' ? MATTE_LOOKAHEAD : 0 })
    if ('pending' in found) {
      notePending(stats, `${asset.name} (subject matte)`)
      return 'skip'
    }
    if ('missing' in found || 'error' in found) {
      const why = 'missing' in found ? found.missing : found.error
      this.#placeholder(ctx, item, stats, 'Subject matte missing', `${asset.name} (${why} — run put_behind_subject again to compute it)`)
      return 'skip'
    }
    // Capped here as well as in the tool: a `.bay` is data anyone can write, and a crafted feather of
    // 1e9 is a blur filter no canvas should be asked for.
    const feather = mask.feather !== undefined && Number.isFinite(mask.feather) ? Math.min(MAX_MASK_FEATHER, Math.max(0, mask.feather)) : 0
    return { matte: found.image, invert: mask.invert === true, feather }
  }

  /**
   * Draws a text item and reports how it came out.
   *
   * The arithmetic — wrapping, the shrink search, the anchor — lives in `text.ts` and is unit
   * tested against an injected measure. What is here is the part that genuinely needs a
   * canvas: assembling the font string, asking for widths, and painting in the right order.
   *
   * **Order is load-bearing**: background plate, then shadow+stroke, then fill. Painting the
   * plate after the glyphs hides them; painting the shadow with the fill leaves the stroke
   * casting its own shadow over the letterform it is meant to outline.
   */
  #drawText(ctx: RenderTarget, item: Item, asset: Asset, frame: number, alphaMul = 1): TextFit | null {
    const box = layoutBox(item)
    if (!box) return null
    const text = asset.text ?? asset.name
    if (!text) return null
    const alpha = clamp01(finite(item.layout.opacity, 1) * fadeGainAt(item, frame) * clamp01(alphaMul))

    // One resolver for the unstyled fallback, shared with the inspector and the fit hint.
    const style = resolvedTextStyle(item)

    const fontString = (size: number, family: string): string =>
      `${style.italic ? 'italic ' : ''}${style.fontWeight} ${size}px ${family}`

    ctx.save()
    try {
      // Set before any measurement: `measureText` reports widths for whatever font is current,
      // and letter spacing counts toward them.
      const spacing = finite(style.letterSpacing, 0)
      if (spacing !== 0 && 'letterSpacing' in ctx) {
        ;(ctx as CanvasRenderingContext2D).letterSpacing = `${spacing}px`
      }

      const measure = (candidate: string, fontSize: number): number => {
        ctx.font = fontString(fontSize, style.fontFamily)
        return ctx.measureText(candidate).width
      }
      const laid = layoutText(text, style, box as TextBox, measure)
      const fontAvailable = fontIsAvailable(style.fontFamily, (family) => {
        ctx.font = fontString(laid.fontSize, family)
        return ctx.measureText(FONT_PROBE_STRING).width
      })

      const fit: TextFit = {
        itemId: item.id,
        scale: laid.scale,
        fontSize: laid.fontSize,
        lines: laid.lines.length,
        clipped: laid.clipped,
        fontAvailable
      }

      // Report even when nothing is painted. A fully faded title that does not fit is still a
      // layout problem the next frame will show, and reporting only visible text would make
      // the warning blink.
      if (alpha <= 0) return fit

      ctx.globalAlpha = alpha
      applyLook(ctx, item)
      applyRotation(ctx, item, box)
      ctx.font = fontString(laid.fontSize, style.fontFamily)

      const anchor = anchorFor(box as TextBox, laid, style.align, style.verticalAlign)
      ctx.textAlign = anchor.textAlign
      ctx.textBaseline = 'alphabetic'

      if (style.background) {
        const pad = Math.max(0, finite(style.background.padding, 0))
        const plateWidth = laid.maxLineWidth + pad * 2
        const left =
          anchor.textAlign === 'left'
            ? anchor.x - pad
            : anchor.textAlign === 'right'
              ? anchor.x - plateWidth + pad
              : anchor.x - plateWidth / 2
        const top = anchor.firstBaseline - laid.lineHeight - pad
        const height = laid.blockHeight + pad * 2
        ctx.fillStyle = style.background.color
        const radius = Math.max(0, Math.min(finite(style.background.radius, 0), Math.min(plateWidth, height) / 2))
        ctx.beginPath()
        // `roundRect` is in Chromium; the fallback keeps this drawable if it ever is not.
        if (typeof (ctx as CanvasRenderingContext2D).roundRect === 'function') {
          ;(ctx as CanvasRenderingContext2D).roundRect(left, top, plateWidth, height, radius)
        } else {
          ctx.rect(left, top, plateWidth, height)
        }
        ctx.fill()
      }

      for (let i = 0; i < laid.lines.length; i += 1) {
        const line = laid.lines[i] ?? ''
        const y = anchor.firstBaseline + i * laid.lineHeight

        if (style.shadow) {
          ctx.shadowColor = style.shadow.color
          ctx.shadowBlur = Math.max(0, finite(style.shadow.blur, 0))
          ctx.shadowOffsetX = finite(style.shadow.offsetX, 0)
          ctx.shadowOffsetY = finite(style.shadow.offsetY, 0)
        }
        if (style.stroke && style.stroke.width > 0) {
          ctx.lineWidth = style.stroke.width
          ctx.strokeStyle = style.stroke.color
          ctx.lineJoin = 'round'
          ctx.strokeText(line, anchor.x, y)
        }
        // The fill must not cast a second shadow over the stroke it sits inside.
        ctx.shadowColor = 'transparent'
        ctx.shadowBlur = 0
        ctx.shadowOffsetX = 0
        ctx.shadowOffsetY = 0
        ctx.fillStyle = style.color
        ctx.fillText(line, anchor.x, y)
      }

      return fit
    } finally {
      ctx.restore()
    }
  }

  /**
   * Draws the grey card for an item that cannot be drawn and records it: the one way a
   * placeholder happens, so no site can paint one without the export hearing about it.
   */
  #placeholder(ctx: RenderTarget, item: Item, stats: DrawStats, label: string, why: string): void {
    this.#drawPlaceholder(ctx, item, label)
    stats.placeholders += 1
    stats.unresolvedNames.push(why)
    stats.placeholderNames.push(why)
  }

  #drawPlaceholder(ctx: RenderTarget, item: Item, name: string): void {
    const box = layoutBox(item)
    if (!box) return
    ctx.save()
    ctx.globalAlpha = clamp01(finite(item.layout.opacity, 1))
    applyRotation(ctx, item, box)
    ctx.fillStyle = PLACEHOLDER_FILL
    ctx.fillRect(box.left, box.top, box.width, box.height)
    ctx.strokeStyle = PLACEHOLDER_EDGE
    ctx.lineWidth = 2
    ctx.strokeRect(box.left + 1, box.top + 1, Math.max(0, box.width - 2), Math.max(0, box.height - 2))
    // A 12px label in a 16px box is unreadable noise; below that the box alone says enough.
    if (box.width > 64 && box.height > 32) {
      ctx.fillStyle = PLACEHOLDER_INK
      ctx.font = `500 ${Math.max(11, Math.min(28, Math.round(box.height * 0.12)))}px system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.save()
      ctx.beginPath()
      ctx.rect(box.left, box.top, box.width, box.height)
      ctx.clip()
      ctx.fillText(name, box.left + box.width / 2, box.top + box.height / 2)
      ctx.restore()
    }
    ctx.restore()
  }

  /**
   * Puts the element at the source time this item wants, without ever waiting for it.
   *
   * A seek is asynchronous and may take longer than a frame. Issuing one every frame for
   * the same target means the element restarts the seek before finishing it and never
   * arrives, so the outstanding target is remembered and only re-issued when the target
   * moves or the seek goes stale.
   *
   * **During playback the target always moves**, so "re-issue when it moves" was the same
   * restart one step removed: past {@link DRIFT_TOLERANCE_SECONDS} of clock (two frames at 24
   * fps) the seek was abandoned for a new one, and a seek slower than that never landed.
   * Measured on a same-asset jump cut 74 frames past its only keyframe: a new `currentTime`
   * every 83 ms, no `seeked` for 20 frames, the clip black for half a second. So in playback a
   * seek in flight is left to land ({@link PLAYBACK_SEEK_PATIENCE_MS}), and the next one is
   * aimed where the clock will be when it lands — ahead by how long this element's last seek
   * took — rather than where it was when it was asked, which would land late by that much again
   * and be corrected for ever.
   */
  #syncElement(
    entry: MediaEntry,
    item: Item,
    asset: Asset,
    frame: number,
    fps: number,
    mode: 'playback' | 'scrub',
    now: number
  ): void {
    const element = entry.element
    if (!(element instanceof HTMLVideoElement)) return

    // Keyed by element, not by asset. With two elements for one asset the two seeks are
    // independent, and a shared key would have each overwrite the other's outstanding
    // target — re-issuing both every frame, which is the thrash this bookkeeping prevents.
    const seekKey = `${entry.assetId}#${entry.slot}`

    const target = sourceSecondsAt(item, asset, frame, fps)
    // Half a frame while scrubbing: closer than that is the same picture, and a seek that
    // lands on the same picture costs a decode for nothing.
    const tolerance = mode === 'playback' ? DRIFT_TOLERANCE_SECONDS : 0.5 / fps

    if (mode === 'playback') {
      element.playbackRate = playbackRateFor(item.speed)
      if (element.paused) {
        // Rejected autoplay is not fatal — the picture still advances by seeking, and the
        // audio engine resumes the context on the next user gesture.
        void element.play().catch(() => {})
      }
    } else if (!element.paused) {
      element.pause()
    }

    const pending = this.#seeks.get(seekKey)
    if (pending && mode === 'playback') {
      // Before the drift check, because `currentTime` reports a seek's *target* from the moment it
      // is set: judged by drift, a seek in flight looks landed, its bookkeeping is dropped, and two
      // frames later it looks late and is asked again — the restart this exists to prevent.
      if (element.seeking && now - pending.issuedAt <= PLAYBACK_SEEK_PATIENCE_MS) return
      if (pending.timing && !element.seeking) {
        // Landed at most a frame ago, so this reads a little long. What the next seek leads by.
        this.#seekLatency.set(seekKey, Math.min(now - pending.issuedAt, MAX_SEEK_LEAD_MS))
        pending.timing = false
      }
    }

    const drift = Math.abs(element.currentTime - target)
    if (drift <= tolerance) {
      this.#seeks.delete(seekKey)
      return
    }

    const sameTarget = pending !== undefined && Math.abs(pending.targetSeconds - target) <= tolerance
    const stale = pending !== undefined && now - pending.issuedAt > STALE_SEEK_MS
    if (sameTarget && !stale) return

    // Rounded, not ceiled: the latency is read at the first draw after landing, so it is already up
    // to a frame long, and a ceiling turned every fast (~25 ms) seek into a one-frame lead that
    // opened the clip a source frame late.
    const leadFrames = mode === 'playback' ? Math.round(((this.#seekLatency.get(seekKey) ?? 0) / 1000) * fps) : 0
    const aim = leadFrames > 0 ? sourceSecondsAt(item, asset, frame + leadFrames, fps) : target
    try {
      element.currentTime = aim
      this.#seeks.set(seekKey, { targetSeconds: aim, issuedAt: now, timing: mode === 'playback' })
    } catch {
      // Seeking before metadata arrives throws; the next frame retries with metadata.
    }
  }

}


/**
 * Which of an asset's elements each item draws from, for the items in one frame.
 *
 * This replaces the one-owner-per-asset rule rather than refining it. That rule stopped the
 * seek thrash by letting a single item move the element and having the rest draw whatever it
 * held — correct as a way of not being permanently blank, and *wrong* as behaviour the moment
 * two items on one asset are both meant to be visible. A transition between two halves of a
 * split clip is exactly that, and it is the commonest transition there is: under the old rule
 * the outgoing half shows the incoming half's frame, so a dissolve dissolves into itself.
 *
 * So each item gets its own element instead. The nth item drawing a given asset in a frame
 * takes slot n, in draw order — which makes the assignment **stable**: `itemsAtFrame` returns
 * lowest track first and items within a track sorted by `from`, so the outgoing clip keeps
 * slot 0 across the whole transition while the incoming one holds slot 1. An assignment that
 * flipped between frames would swap what each element holds and reintroduce the thrash by a
 * different route.
 *
 * Slot 0 is the overwhelmingly common answer, and it keys the pool on the bare asset id, so
 * nothing changes for a timeline without overlaps.
 *
 * **Counted within the frame, and the alternative was tried and measured worse.** Indexing over
 * the whole timeline instead would make a slot a property of the item rather than of the frame,
 * which fixes a real edge case: the incoming clip of a transition holds slot 1 while both clips
 * are drawn and becomes slot 0 the moment the window ends, so it switches element at the edge
 * and re-seeks — three blank frames immediately after a dissolve.
 *
 * Timeline-stable slots cost far more than they save, because they also stop two *adjacent*
 * clips of one asset sharing a single continuously-playing element. Measured over 2.6s of
 * playback across a cut:
 *
 *                            blank frames     composite p50
 *     frame-local (this)          1              9.3 ms
 *     timeline-stable            23              0.2 ms      <- p50 that low means most
 *                                                               composites drew nothing
 *
 * The two goals conflict directly: sharing means one element for both clips, and a transition
 * needs two. Sharing by default and allocating a second element only when a frame genuinely
 * needs one is the better trade, so the edge re-seek after a dissolve is a known cost rather
 * than a bug to be fixed by making ordinary playback worse. Hysteresis — holding the pair's
 * slots for a few frames past the window — would get both, at the price of state that would
 * need its own correctness argument.
 */
/**
 * Everything this frame draws, in paint order, plus the transition playing across it.
 *
 * **Exported because two consumers need the identical answer and deriving it twice is a bug
 * I shipped.** The compositor draws it; `awaitSources` waits for it. When the compositor
 * started adding the transition pair and `awaitSources` still used `itemsAtFrame`, the two
 * lists differed at exactly the frames that matter — at the cut `itemsAtFrame` returns only
 * the incoming clip, so it took slot 0 while the compositor drew it from slot 1. The wait
 * prepared one element and the draw read another, and every frame from the cut onward came
 * back black. The comment warning against this was already in `awaitSources` at the time.
 *
 * A transition needs **both** clips in every frame of its window, and `itemsAtFrame` returns
 * only one: the window straddles the cut, so frames before it are inside the outgoing clip
 * and frames from it on are inside the incoming one. The other half is added here, and read
 * with a source time outside its own range — which is what the handles are for.
 *
 * Order is `from` then `to`, always. That is what makes `elementSlots` stable across the
 * window: a split clip transitioning into itself is one asset and two items, and an
 * assignment that flipped mid-window would swap what the two elements hold.
 *
 * `purpose` is which transition counts. The picture takes only one on a visible video track: a
 * crossfade between two music clips is a transition too, and taking it here put the music on
 * the draw list, where it waited for a picture it will never have and marked every frame of the
 * window incomplete in export. The sound (`audioRoutingAt`) takes any, as it always has — it
 * needs the pair to crossfade, and the pair's slots come after every picture item's, so the
 * picture items keep the slots the compositor gave them.
 */
export function itemsToDraw(
  project: Project,
  timeline: Timeline,
  frame: number,
  purpose: 'picture' | 'sound' = 'picture'
): { items: Item[]; active: ReturnType<typeof transitionAtFrame> } {
  const active = transitionAtFrame(project, timeline, frame, purpose === 'picture' ? 'video' : undefined)
  const present = itemsAtFrame(timeline, frame, 'video')
  if (!active) return { items: present, active }
  const pair = [active.resolved.from, active.resolved.to]
  const isPair = (item: Item): boolean => pair.some((p) => p.id === item.id)
  // The pair goes where its track sits in the stack, not on top of it: a title on V2 over a
  // dissolve on V1 must stay visible through the window. Appending the pair painted every
  // transition over every higher track, in the preview and in the export alike.
  const at = present.findIndex(isPair)
  const others = present.filter((item) => !isPair(item))
  const below = at < 0 ? others.length : present.slice(0, at).filter((item) => !isPair(item)).length
  return { items: [...others.slice(0, below), ...pair, ...others.slice(below)], active }
}

/** A clip that is not drawn yet, the frame it first will be, and the element it will be drawn from. */
export interface PrerollTarget {
  item: Item
  asset: Asset
  /** The slot `elementSlots` will give it at `startFrame` — the element the draw will read. */
  slot: number
  startFrame: number
}

/**
 * The video clips first drawn in `(frame, frame + lookahead]`, soonest first, one per element.
 *
 * "First drawn" is the clip's `from`, or earlier when it is the incoming side of a transition,
 * whose window starts before the cut. The slot is taken from `itemsToDraw` at that frame, the
 * same derivation the draw will use — prerolling a different element than the one drawn would
 * look exactly like no preroll at all. Two clips wanting one element keep the sooner.
 */
export function prerollTargets(
  project: Project,
  timeline: Timeline,
  frame: number,
  lookaheadFrames: number
): PrerollTarget[] {
  const early = new Map<string, number>()
  for (const transition of timeline.transitions ?? []) {
    const resolved = resolveTransition(project, timeline, transition)
    if (resolved) early.set(resolved.to.id, Math.min(resolved.firstFrame, resolved.to.from))
  }
  const candidates: Array<{ item: Item; asset: Asset; start: number }> = []
  for (const track of timeline.tracks) {
    if (track.kind !== 'video' || track.hidden) continue
    for (const item of track.items) {
      const start = early.get(item.id) ?? item.from
      if (start <= frame || start > frame + lookaheadFrames) continue
      const asset = findAsset(project, item.assetId)
      if (!asset || asset.error || asset.kind !== 'video' || !asset.hasVideo) continue
      candidates.push({ item, asset, start })
    }
  }
  candidates.sort((a, b) => a.start - b.start)
  const claimed = new Set<string>()
  const out: PrerollTarget[] = []
  for (const { item, asset, start } of candidates) {
    const slot = elementSlots(itemsToDraw(project, timeline, start).items).get(item.id) ?? 0
    const key = `${asset.id}#${slot}`
    if (claimed.has(key)) continue
    claimed.add(key)
    out.push({ item, asset, slot, startFrame: start })
  }
  return out
}

export function elementSlots(drawing: Item[]): Map<string, number> {
  const slots = new Map<string, number>()
  const used = new Map<string, number>()
  const views: Item[] = []
  for (const item of drawing) {
    // A second drawing of the *same moment* of the same file — the subject cut-out over its own
    // clip, or any duplicate-and-stack — takes the element the first one has. Two elements would
    // be two decoders, each allowed `DRIFT_TOLERANCE_SECONDS` of slip in playback, so up to
    // ~160 ms apart (one early, one late): the cut-out a different frame from the picture under
    // it, a doubled edge on every movement. One element is one decoded frame, exact by
    // construction, and preroll and `awaitSources` inherit it because they ask here too.
    //
    // Only a *silent* second drawing shares (the cut-out is `audioDetached`). The audio engine
    // routes one source node per element, so two sounding copies on one element would play once in
    // the preview and twice in the export, which mixes each item — a duplicate that sounds keeps an
    // element of its own, exactly as before.
    const same = item.audioDetached === true ? views.find((other) => sameSourceMoment(other, item)) : undefined
    if (same) {
      slots.set(item.id, slots.get(same.id) ?? 0)
      continue
    }
    const next = used.get(item.assetId) ?? 0
    slots.set(item.id, next)
    used.set(item.assetId, next + 1)
    views.push(item)
  }
  return slots
}

/**
 * Whether two items show the same source time at every frame: same file, same timeline start,
 * same in-point, same speed. Frame-independent, so the answer (and the slot) cannot flip mid-clip.
 * Trims and moves of a linked pair keep all four equal on both.
 */
export function sameSourceMoment(a: Item, b: Item): boolean {
  return a.assetId === b.assetId && a.from === b.from && a.sourceStartUs === b.sourceStartUs && a.speed === b.speed
}

export interface Box {
  left: number
  top: number
  width: number
  height: number
}

/**
 * The destination rectangle `drawImage` is given, in timeline coordinates, or null when the
 * layout cannot produce one.
 *
 * Exported because it is the whole of the compositor's placement arithmetic and it is worth
 * pinning. A `coverLayout` for a portrait clip in a landscape project legitimately produces a
 * negative `top` and a `height` three times the canvas — the image is meant to overflow on
 * both sides — and that shape looks wrong enough that three people have now read it as a bug.
 * The rect goes to `drawImage` unclamped, on purpose: clamping it into the canvas is what
 * would actually break cover framing.
 */
export function layoutBox(item: Item): Box | null {
  const layout = item.layout
  const width = finite(layout.width, 0)
  const height = finite(layout.height, 0)
  // Zero is a no-op in the spec but negative sizes are a mirror in some engines and an
  // exception in others; neither is what a broken layout means, so neither is drawn.
  if (width <= 0 || height <= 0) return null
  return {
    left: finite(layout.left, 0),
    top: finite(layout.top, 0),
    width,
    height
  }
}

/**
 * Applies an item's adjustments and blend mode to the context.
 *
 * Skipped entirely when both are the default, because asking for `filter: 'brightness(1)'` puts
 * the draw on the filtered path — measured at roughly twice the cost at 4K — and every clip in
 * every project would pay for a feature it is not using.
 */
function applyLook(ctx: RenderTarget, item: Item): void {
  const filter = adjustmentFilter(item.adjustments)
  const operation = blendOperation(item.blendMode)
  if (isPlainLook(filter, operation)) return
  if (filter !== NO_FILTER) ctx.filter = filter
  ctx.globalCompositeOperation = operation
}

/**
 * One item this frame is still waiting for. The count, the combined list and the pending-only
 * list move together here, because a pending site that bumped the count and forgot the name is
 * exactly how an export would report "1 frame incomplete" without saying what was missing — the
 * variable-font site arrived in a parallel branch after `pendingNames` and did just that.
 */
function notePending(stats: DrawStats, name: string): void {
  stats.pending += 1
  stats.unresolvedNames.push(name)
  stats.pendingNames.push(name)
}

function noteGradeIssue(stats: DrawStats | undefined, message: string): void {
  if (!stats) return
  const issues = (stats.gradeIssues ??= [])
  if (!issues.includes(message)) issues.push(message)
}

/**
 * `layout.scale`: a zoom about the box's centre, 1 when absent or not a finite non-negative
 * number (one NaN must not remove the clip).
 */
export function zoomOf(item: Item): number {
  const scale = item.layout.scale
  return scale === undefined || !Number.isFinite(scale) || scale < 0 ? 1 : scale
}

/** Rotation and zoom, both about the box's centre. Named for the rotation it did first. */
function applyRotation(ctx: RenderTarget, item: Item, box: Box): void {
  const degrees = finite(item.layout.rotation, 0) % 360
  const zoom = zoomOf(item)
  if (degrees === 0 && zoom === 1) return
  const centreX = box.left + box.width / 2
  const centreY = box.top + box.height / 2
  ctx.translate(centreX, centreY)
  if (degrees !== 0) ctx.rotate((degrees * Math.PI) / 180)
  if (zoom !== 1) ctx.scale(zoom, zoom)
  ctx.translate(-centreX, -centreY)
}

/** Exported for the exporter, which needs the same clamping the compositor applies. */
export { clamp, sourceSecondsAt }

/**
 * A source's own pixel width, whichever of the three kinds it is.
 *
 * Zero while a video or image is still loading, which callers must treat as "not yet known"
 * rather than as an empty source.
 */
function intrinsicWidth(
  element: HTMLVideoElement | HTMLImageElement | ImageBitmap | OffscreenCanvas
): number {
  if (element instanceof HTMLVideoElement) return element.videoWidth
  if (element instanceof HTMLImageElement) return element.naturalWidth
  return element.width
}

function intrinsicHeight(
  element: HTMLVideoElement | HTMLImageElement | ImageBitmap | OffscreenCanvas
): number {
  if (element instanceof HTMLVideoElement) return element.videoHeight
  if (element instanceof HTMLImageElement) return element.naturalHeight
  return element.height
}
