/**
 * What the live preview shows while a playing frame is incomplete: the last complete picture,
 * for a bounded time, instead of the background.
 *
 * A playing frame is incomplete when a clip's element is mid-seek (a same-asset jump cut, where
 * one element must move between two source times and nothing can be prerolled; a press of play a
 * frame before a cut) or a composition or `.brf` scene has not arrived. The compositor then draws
 * the background where the clip belongs, and in playback that is a black flash at the cut. A
 * repeated picture is a dropped frame, which is what every player shows when decode falls behind;
 * a black one reads as a fault in the edit.
 *
 * **Live playback only.** Export and `preview_frame` wait for their sources and report what they
 * could not draw — a stand-in there would put the wrong picture in a file or in front of the
 * agent. A paused preview draws the truth too: `onReady` redraws it the moment the seek lands, and
 * a scrubbed frame showing the previous position would misreport where the playhead is.
 *
 * Bounded, so a clip that never decodes shows as missing rather than as a frozen picture.
 *
 * The decision is separate from the pixels so it can be tested without a canvas; the engine does
 * the copying (`useEngine.ts`).
 */

/**
 * Longest a held picture stands in for an incomplete one. Sized from a measurement: a same-asset
 * jump cut on the reporter's takes (one element seeking 74 frames past its only keyframe) landed in
 * ~25 ms on a quiet machine and 420-490 ms with other work running; 250 ms turned the busy case
 * into a freeze followed by a black flash. A second is still plainly "not playing" when a clip
 * genuinely cannot decode, which is what the bound is for.
 */
export const MAX_HOLD_MS = 1000

export type HoldVerdict =
  /** The frame just drawn is complete: show it, and keep a copy to hold later. */
  | 'fresh'
  /** Incomplete, and a held picture may stand in: put the copy back over it. */
  | 'hold'
  /** Incomplete, and nothing may stand in: show the frame as drawn. */
  | 'incomplete'

export interface HoldInput {
  /** The draw reported nothing pending. */
  complete: boolean
  /** Live playback, not a paused or scrubbed preview. */
  playing: boolean
  now: number
  width: number
  height: number
}

export class PictureHold {
  readonly #maxHoldMs: number
  #held: { width: number; height: number } | null = null
  #holdingSince: number | null = null

  constructor(options: { maxHoldMs?: number } = {}) {
    this.#maxHoldMs = options.maxHoldMs ?? MAX_HOLD_MS
  }

  /** Called after every draw of the live preview; the caller copies or restores as told. */
  decide(input: HoldInput): HoldVerdict {
    if (input.complete) {
      this.#held = { width: input.width, height: input.height }
      this.#holdingSince = null
      return 'fresh'
    }
    const held = this.#held
    const sameSize = held !== null && held.width === input.width && held.height === input.height
    if (!input.playing || !sameSize) {
      this.#holdingSince = null
      return 'incomplete'
    }
    this.#holdingSince ??= input.now
    if (input.now - this.#holdingSince > this.#maxHoldMs) return 'incomplete'
    return 'hold'
  }

  /** Forgets the held picture — a different project or timeline must never be shown in its place. */
  clear(): void {
    this.#held = null
    this.#holdingSince = null
  }
}
