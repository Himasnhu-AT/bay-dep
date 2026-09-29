/**
 * What happens to Vision's mask between the model and the pack: a light temporal filter, then a
 * near-lossless quantisation that is most of why a pack is small.
 *
 * **Temporal: One-Frame Delay (OFD), from the MODNet paper (arXiv 2011.11961).** Per pixel, when
 * the frames either side agree (|αₜ₋₁ − αₜ₊₁| ≤ 16) and αₜ differs from both by more than 16, αₜ is
 * a one-frame flicker and becomes their mean. Nothing else moves: on a real two-person 1080p clip
 * it changed 0.7% of pixels. It costs one frame of latency, which an offline pass does not feel.
 * Vision's own `VNSequenceRequestHandler` smoothing runs before it. No EMA: it trades flicker for a
 * ghost that trails a fast-moving head, which is the worse fault behind a title.
 *
 * **Quantisation:** α ≤ 8 → 0 and α ≥ 247 → 255 (Vision's low-level noise in the background and in
 * the body, which cost more bytes than the edge), and the soft band in between rounded to steps of
 * 4 (64 levels; at most 2/255 off). Measured on that clip (246 frames, 512×384 masks), per frame
 * raw-deflated at level 9 (the pack uses 6: 9.0 KB instead of 8.7, three times faster):
 *
 *     as Vision gives it                 18.8 KB   33.0 MB/min at 30 fps
 *     + OFD + snap                       11.5 KB   20.3 MB/min
 *     + soft band in steps of 4 (this)    8.6 KB   15.1 MB/min
 *     gray PNG per frame (ffmpeg)        17.3 KB   30.4 MB/min
 *     VP9 lossless, whole clip           11.6 KB   20.4 MB/min
 *
 * The finished pack for that clip (24 fps, two people filling 28% of the frame) was 12.1 MB per
 * minute of footage — about 15 MB/min at 30 fps, 150 MB for ten minutes. The size follows the
 * length of the subject's edge, not the source resolution: the mask is 512×384 for any source.
 *
 * against the audit's 90 KB per 1080p `ya8` PNG (~160 MB/min). The pack stays per-frame and
 * random-access (a frame is one Range request and one inflate) rather than a video, which would
 * need a second decoder in the renderer and drift against the picture it masks.
 */

/** Pixels whose matte differs by at most this across a flicker are "agreeing" neighbours. */
const OFD_AGREE = 16
const SNAP_LOW = 8
const SNAP_HIGH = 247
const SOFT_STEP = 4

/** A pixel counts as subject at this alpha, and a frame "has a person" past this share of pixels. */
export const SUBJECT_ALPHA = 128
export const SUBJECT_MIN_AREA = 0.002

/** The OFD rule for one frame, given its neighbours; writes into `out` (which may be `cur`'s copy). */
export function oneFrameDelay(prev: Uint8Array, cur: Uint8Array, next: Uint8Array, out: Uint8Array): number {
  let changed = 0
  for (let i = 0; i < cur.length; i += 1) {
    const a = prev[i]!
    const b = cur[i]!
    const c = next[i]!
    if (Math.abs(a - c) <= OFD_AGREE && Math.abs(b - a) > OFD_AGREE && Math.abs(b - c) > OFD_AGREE) {
      out[i] = (a + c) >> 1
      changed += 1
    } else {
      out[i] = b
    }
  }
  return changed
}

/** Snap the extremes, step the soft band. In place. */
export function quantiseMatte(alpha: Uint8Array): void {
  for (let i = 0; i < alpha.length; i += 1) {
    const v = alpha[i]!
    alpha[i] = v <= SNAP_LOW ? 0 : v >= SNAP_HIGH ? 255 : Math.min(255, Math.round(v / SOFT_STEP) * SOFT_STEP)
  }
}

/** The share of the frame at or over {@link SUBJECT_ALPHA}. */
export function subjectArea(alpha: Uint8Array): number {
  if (alpha.length === 0) return 0
  let n = 0
  for (let i = 0; i < alpha.length; i += 1) if (alpha[i]! >= SUBJECT_ALPHA) n += 1
  return n / alpha.length
}

export interface SmoothedFrame {
  ptsUs: number
  alpha: Uint8Array
}

/**
 * The streaming form: push frames in order, receive each one a frame later (smoothed against both
 * neighbours), and `flush` the last. The first and last frames have one neighbour and pass through
 * the temporal rule unchanged; both are quantised.
 */
export class MatteSmoother {
  #prev: SmoothedFrame | null = null
  #cur: SmoothedFrame | null = null
  changed = 0
  pixels = 0

  push(frame: SmoothedFrame): SmoothedFrame | null {
    if (!this.#cur) {
      this.#cur = frame
      return null
    }
    const cur = this.#cur
    let out: SmoothedFrame
    if (this.#prev && this.#prev.alpha.length === cur.alpha.length && frame.alpha.length === cur.alpha.length) {
      const smoothed = new Uint8Array(cur.alpha.length)
      this.changed += oneFrameDelay(this.#prev.alpha, cur.alpha, frame.alpha, smoothed)
      out = { ptsUs: cur.ptsUs, alpha: smoothed }
    } else {
      out = { ptsUs: cur.ptsUs, alpha: Uint8Array.from(cur.alpha) }
    }
    this.pixels += cur.alpha.length
    // The neighbour for the next frame is the *raw* current frame: OFD compares model outputs.
    this.#prev = cur
    this.#cur = frame
    quantiseMatte(out.alpha)
    return out
  }

  flush(): SmoothedFrame | null {
    const cur = this.#cur
    this.#cur = null
    if (!cur) return null
    const out = { ptsUs: cur.ptsUs, alpha: Uint8Array.from(cur.alpha) }
    this.pixels += cur.alpha.length
    quantiseMatte(out.alpha)
    return out
  }
}
