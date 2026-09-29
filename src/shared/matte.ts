/**
 * Subject mattes: which pixels of a clip are the person, and the masks that use them.
 *
 * The first slice of masking (r&d/research/masking.md, corrected by audit.md §10) is "text behind
 * the subject": the clip, then the title, then a copy of the clip cut out to the person. This
 * module is the contract between the three places that meet over it —
 *
 * - **main** computes a matte for a source range (`src/main/matte/`): frames decoded by bay's
 *   ffmpeg, segmented by Apple Vision in one long-lived `osascript -l JavaScript` process, lightly
 *   smoothed, and stored content-addressed in the cache as a *matte pack*;
 * - **the project** records that a matte exists (`Asset.subjectMattes`) and which item uses one
 *   (`Item.masks`) — the pixels stay in the cache, like a poster;
 * - **the compositor** reads the matte frame for the source time the picture element is showing
 *   and applies it inside `#drawSource`, after the grade, so the preview, `preview_frame` and
 *   export mask through one path.
 *
 * Everything here is pure and shared, so the tool, the store and the engine cannot disagree about
 * which record covers a moment or which frame of it is "now".
 */

import { itemEnd, sourceTimeAt, type Asset, type Item, type Micros } from './project'

// ---------------------------------------------------------------------------
// The model: what the project stores
// ---------------------------------------------------------------------------

/**
 * A mask on an item. An array on the item (`Item.masks`) from day one: a single `mask` retyped to
 * an array later would be a format change under bay's own rules, and shape masks and track mattes
 * are the planned next kinds. This slice has one kind.
 */
export type Mask = SubjectMask

/**
 * Keep only the subject (a person) of a clip — or, inverted, everything but the subject.
 *
 * `assetId` names whose subject: absent is the item's own asset, which is the cut-out copy's case.
 * The matte frame is chosen at the source time the item's own picture shows, so another asset's
 * matte only lines up when this item plays that asset's footage at the same source times.
 */
export interface SubjectMask {
  kind: 'subject'
  assetId?: string
  /** Keep everything *except* the subject. */
  invert?: boolean
  /** Softening of the matte edge, in timeline pixels (a Gaussian blur on the matte). 0 or absent: none. */
  feather?: number
}

/** The most feather a mask may ask for, in timeline pixels. Past this the cut-out is a glow. */
export const MAX_MASK_FEATHER = 200

/**
 * That a subject matte exists for a stretch of an asset's source, and where its pixels are.
 *
 * Kept on the asset (`Asset.subjectMattes`) like `beats`: derived from the file, written silently,
 * recomputable. `key` addresses the pack in main's cache (`<cache>/mattes-<scheme>/<key>.bmat`):
 * the same file content, range, engine and parameters always produce the same key, so a second
 * request is a lookup. A `.bay` opened on a Mac without the pack draws the masked item as a
 * named placeholder until the matte is computed again — never unmasked.
 */
export interface SubjectMatte {
  key: string
  /** The source range the pack covers, in microseconds from the start of the file. */
  fromUs: Micros
  toUs: Micros
  /** Which engine made it — `MATTE_ENGINE_VISION` today. A pack from another engine is another key. */
  engine: string
  frames: number
  /** The stored matte's own pixel size (Vision's balanced mask is 512×384 for any 16:9 or 4:3 frame). */
  width: number
  height: number
}

/**
 * Apple Vision person segmentation at `.balanced` quality, through JXA. Named with the quality
 * because `.accurate` would be a different matte for the same range.
 */
export const MATTE_ENGINE_VISION = 'apple-vision-person-balanced'

/**
 * Bumped whenever the pipeline would store different pixels for the same inputs (input size, the
 * smoothing, the quantisation), so an old pack is a different key rather than a wrong answer.
 */
export const MATTE_PARAMS_VERSION = 1

/** A matte key is 32 hex characters; anything else never reaches the filesystem. */
export const MATTE_KEY_PATTERN = /^[0-9a-f]{32}$/

/**
 * What the content address is a hash of: the file's content key (size and three 1 MiB windows,
 * `vision/cache.ts`), the source range, the engine and the parameters. The hash itself is main's
 * (`node:crypto`); the input is here so the rule is written once.
 */
export function matteKeyInput(contentKey: string, fromUs: Micros, toUs: Micros, engine: string, params = MATTE_PARAMS_VERSION): string {
  return `${contentKey}\0${Math.round(fromUs)}\0${Math.round(toUs)}\0${engine}\0${params}`
}

// ---------------------------------------------------------------------------
// Time: from an item's frame to a matte frame
// ---------------------------------------------------------------------------

/**
 * The source range an item plays, padded by one source frame at each end, for computing its matte.
 *
 * Through the in-point and the speed, exactly as the picture reads it (`sourceTimeAt`), so the
 * matte covers every source frame the clip can show. The padding covers the rounding at the ends
 * (a frame whose time rounds a microsecond past `toUs` must still find a matte) and is clamped to
 * the file.
 */
export function matteSpanForItem(item: Item, asset: Asset, timelineFps: number): { fromUs: Micros; toUs: Micros } {
  const fps = Number.isFinite(timelineFps) && timelineFps > 0 ? timelineFps : 30
  const sourceFps = asset.fps && asset.fps > 0 ? asset.fps : fps
  const pad = Math.round(1_000_000 / sourceFps)
  const start = sourceTimeAt(item, item.from, fps)
  const end = sourceTimeAt(item, itemEnd(item), fps)
  const duration = asset.durationUs > 0 ? asset.durationUs : Number.POSITIVE_INFINITY
  return {
    fromUs: Math.max(0, Math.min(start, end) - pad),
    toUs: Math.min(duration, Math.max(start, end) + pad)
  }
}

/**
 * The record covering `sourceUs`, or null. The latest written wins where two overlap (a re-run of
 * `put_behind_subject` after the clip was extended writes a wider one).
 */
export function matteRecordAt(records: readonly SubjectMatte[] | undefined, sourceUs: Micros): SubjectMatte | null {
  if (!records) return null
  for (let i = records.length - 1; i >= 0; i -= 1) {
    const record = records[i]!
    if (sourceUs >= record.fromUs && sourceUs <= record.toUs) return record
  }
  return null
}

/** Whether `records` hold one pack covering the whole of `[fromUs, toUs]`. */
export function matteCovers(records: readonly SubjectMatte[] | undefined, fromUs: Micros, toUs: Micros, engine = MATTE_ENGINE_VISION): SubjectMatte | null {
  if (!records) return null
  for (let i = records.length - 1; i >= 0; i -= 1) {
    const record = records[i]!
    if (record.engine === engine && record.fromUs <= fromUs && record.toUs >= toUs) return record
  }
  return null
}

/**
 * Tolerance for "at or before": source times carry microsecond rounding and the picture seek adds
 * `FRAME_EDGE_SECONDS` (0.5 ms), so a frame whose timestamp is a hair past the asked time is
 * still the frame being shown.
 */
const EDGE_US = 1_000

/**
 * Which stored frame is the picture at `sourceUs`: the last frame whose timestamp is at or before
 * it, as a `<video>` element shows. −1 when `sourceUs` is before the first frame or more than one
 * frame interval past the last — outside what the pack holds, which is a missing matte, never the
 * nearest one (a stale cut-out slides against the picture under it).
 *
 * `ptsUs` must be ascending; the pack writer guarantees it.
 */
export function matteFrameIndex(ptsUs: readonly Micros[], sourceUs: Micros): number {
  const n = ptsUs.length
  if (n === 0 || !Number.isFinite(sourceUs)) return -1
  const t = sourceUs + EDGE_US
  if (t < ptsUs[0]!) return -1
  let lo = 0
  let hi = n - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (ptsUs[mid]! <= t) lo = mid
    else hi = mid - 1
  }
  if (lo === n - 1) {
    const interval = n > 1 ? ptsUs[n - 1]! - ptsUs[n - 2]! : 1_000_000 / 30
    if (sourceUs > ptsUs[n - 1]! + interval) return -1
  }
  return lo
}

// ---------------------------------------------------------------------------
// Space: where a matte lands on the timeline
// ---------------------------------------------------------------------------

export { sourceFrameOnTimeline } from './matte-space'

// ---------------------------------------------------------------------------
// Validation, for tools and the loader
// ---------------------------------------------------------------------------

/** `masks` as a tool or file gave it, checked; the error names the field and what is allowed. */
export function checkMasks(value: unknown): { ok: true; masks: Mask[] } | { ok: false; error: string } {
  if (!Array.isArray(value)) return { ok: false, error: 'masks must be a list, e.g. [{ "kind": "subject" }]' }
  if (value.length > 1) {
    return { ok: false, error: `masks takes one mask in this version (a subject mask); got ${value.length}` }
  }
  const out: Mask[] = []
  for (const [index, raw] of value.entries()) {
    if (!raw || typeof raw !== 'object') return { ok: false, error: `masks[${index}] must be an object like { "kind": "subject" }` }
    const m = raw as Record<string, unknown>
    if (m.kind !== 'subject') return { ok: false, error: `masks[${index}].kind must be "subject" (the only kind so far); got ${JSON.stringify(m.kind)}` }
    const mask: SubjectMask = { kind: 'subject' }
    if (m.assetId !== undefined) {
      if (typeof m.assetId !== 'string' || !m.assetId) return { ok: false, error: `masks[${index}].assetId must be an asset id from read_project` }
      mask.assetId = m.assetId
    }
    if (m.invert !== undefined) {
      if (typeof m.invert !== 'boolean') return { ok: false, error: `masks[${index}].invert must be true or false` }
      if (m.invert) mask.invert = true
    }
    if (m.feather !== undefined) {
      if (typeof m.feather !== 'number' || !Number.isFinite(m.feather) || m.feather < 0 || m.feather > MAX_MASK_FEATHER) {
        return { ok: false, error: `masks[${index}].feather must be a number of pixels from 0 to ${MAX_MASK_FEATHER}; got ${JSON.stringify(m.feather)}` }
      }
      if (m.feather > 0) mask.feather = m.feather
    }
    out.push(mask)
  }
  return { ok: true, masks: out }
}

/** The subject mask an item draws with, if any — the one the compositor applies. */
export function subjectMaskOf(item: Item): SubjectMask | null {
  const mask = item.masks?.[0]
  return mask && mask.kind === 'subject' ? mask : null
}

// ---------------------------------------------------------------------------
// What main answers over IPC
// ---------------------------------------------------------------------------

/** Compute (or find) the subject matte for one source range of one file. */
export interface SubjectMatteRequest {
  /** The asset's file — refused unless `bay://` would serve it. */
  path: string
  fromUs: Micros
  toUs: Micros
}

/** How a matte came to be, for the tool's answer and the measurements in the commit. */
export interface SubjectMatteReport {
  /** True when the pack was already in the cache and nothing was computed. */
  cached: boolean
  frames: number
  /** Fraction of frames in which Vision found a person (≥ 0.2% of the frame at α ≥ 0.5). */
  coverage: number
  /** Mean fraction of the frame the person covers, over frames that have one. */
  meanArea: number
  /** Wall time of the whole job per frame — decode, pipe, Vision, smoothing, compression, write. */
  msPerFrame: number
  /** Vision's own time per frame inside the JXA process (median / 90th percentile). */
  visionMsMedian: number
  visionMsP90: number
  /** The size of the pack on disk. */
  bytes: number
  /** `bytes` scaled to one minute of this source at its own frame rate. */
  megabytesPerMinute: number
  /** The OS build the engine ran on: a macOS update can change Vision's matte for the same frame. */
  engineBuild: string
  seconds: number
}

export type SubjectMatteResult =
  | { ok: true; matte: SubjectMatte; report: SubjectMatteReport }
  | {
      ok: false
      /**
       * `unavailable`: no Apple Vision here (not a Mac, or too old); `no-picture`: the file has no
       * frames in that range; `failed`: the pipeline broke (the message has ffmpeg's or Vision's
       * words); `refused`: the path is not one bay serves.
       */
      code: 'unavailable' | 'no-picture' | 'failed' | 'refused'
      error: string
    }

/**
 * Where each frame of a pack is, for the engine to fetch through `bay://` with a Range request.
 * Each frame is `width × height` bytes of 8-bit alpha, raw-deflated (`MATTE_FRAME_CODEC`).
 */
export interface SubjectMatteIndex {
  key: string
  /** `bay://media/…` of the pack; the cache directory is admitted to `bay://` as a whole. */
  url: string
  width: number
  height: number
  fromUs: Micros
  toUs: Micros
  ptsUs: Micros[]
  offsets: number[]
  lengths: number[]
}

export const MATTE_FRAME_CODEC = 'deflate-raw-gray8'
