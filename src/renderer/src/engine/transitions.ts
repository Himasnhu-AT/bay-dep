/**
 * What each transition kind draws, as a plan rather than as drawing.
 *
 * Every kind reduces to the same three primitives — paint one of the two clips, with an
 * alpha, an offset and optionally a clip region; or fill the frame with a colour. So the
 * kind-specific part is pure arithmetic over `progress`, and arithmetic is where the mistakes
 * are: an offset with the wrong sign slides the wrong way, a wipe edge that starts at the
 * far side flashes the incoming clip full-frame for one frame, a dip whose halves do not meet
 * at 0.5 shows a seam. None of that needs a canvas to be wrong, so none of it is written
 * where a canvas is required.
 *
 * The contract on `progress` comes from the model: **0 means the outgoing clip alone, 1 the
 * incoming alone.** Stated there because every gl-transitions shader assumes it, so a future
 * WebGL path consumes the same number unchanged.
 */

import type { TransitionDirection, TransitionKind } from '@shared/project'

export interface ClipRect {
  left: number
  top: number
  width: number
  height: number
}

export interface ClipCircle {
  centreX: number
  centreY: number
  radius: number
}

export type TransitionStep =
  | {
      kind: 'paint'
      /** Which of the two clips. */
      which: 'from' | 'to'
      alpha: number
      offsetX: number
      offsetY: number
      clipRect?: ClipRect
      clipCircle?: ClipCircle
    }
  | { kind: 'fill'; color: string; alpha: number }

/** The canvas, in timeline coordinates — the space every offset and clip below is in. */
export interface TransitionCanvas {
  width: number
  height: number
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0
}

/**
 * Turns `-0` into `0`.
 *
 * `-w * (1 - p)` at p = 1 is negative zero, which translates identically and compares
 * `false` against 0 under `Object.is`. Canonical plans are worth having: a plan that cannot
 * be compared by value makes every assertion about it awkward, and awkward assertions are
 * where a real sign error hides.
 */
function zeroed(value: number): number {
  return value + 0
}

/**
 * The steps to draw `kind` at `progress`, in paint order.
 *
 * Two rules hold across every kind, and both are asserted in the tests rather than trusted:
 *
 * - **At progress 0 the result is the outgoing clip, at 1 the incoming.** A transition that
 *   does not start and end on its own clips shows a jump at the cut, which is the one thing a
 *   transition exists to remove.
 * - **The frame is always covered.** A step that leaves part of the canvas unpainted shows
 *   the timeline background through the middle of a dissolve.
 */
export function planTransition(
  kind: TransitionKind,
  direction: TransitionDirection | undefined,
  progress: number,
  canvas: TransitionCanvas
): TransitionStep[] {
  const p = clamp01(progress)
  const w = Math.max(1, canvas.width)
  const h = Math.max(1, canvas.height)
  const dir: TransitionDirection = direction ?? 'left'

  switch (kind) {
    case 'cross-dissolve':
      // Source-over with the incoming at alpha p gives to*p + from*(1-p), which is the
      // classic cross dissolve exactly — no intermediate buffer needed.
      return [
        { kind: 'paint', which: 'from', alpha: 1, offsetX: 0, offsetY: 0 },
        { kind: 'paint', which: 'to', alpha: p, offsetX: 0, offsetY: 0 }
      ]

    case 'dip-to-black':
    case 'dip-to-white': {
      const color = kind === 'dip-to-black' ? '#000000' : '#FFFFFF'
      // The halves meet at exactly 1 at p = 0.5, so there is no seam and no frame where the
      // dip is partially lifted while the clip has already changed.
      if (p < 0.5) {
        return [
          { kind: 'paint', which: 'from', alpha: 1, offsetX: 0, offsetY: 0 },
          { kind: 'fill', color, alpha: p * 2 }
        ]
      }
      return [
        { kind: 'paint', which: 'to', alpha: 1, offsetX: 0, offsetY: 0 },
        { kind: 'fill', color, alpha: (1 - p) * 2 }
      ]
    }

    case 'wipe': {
      // The incoming clip is revealed by a growing region, drawn in place over the outgoing.
      // `direction` is where the wipe comes *from*, so 'left' reveals from the left edge.
      const rect =
        dir === 'left'
          ? { left: 0, top: 0, width: w * p, height: h }
          : dir === 'right'
            ? { left: w - w * p, top: 0, width: w * p, height: h }
            : dir === 'up'
              ? { left: 0, top: 0, width: w, height: h * p }
              : { left: 0, top: h - h * p, width: w, height: h * p }
      return [
        { kind: 'paint', which: 'from', alpha: 1, offsetX: 0, offsetY: 0 },
        { kind: 'paint', which: 'to', alpha: 1, offsetX: 0, offsetY: 0, clipRect: rect }
      ]
    }

    case 'push': {
      // Both clips move: the outgoing is pushed out as the incoming arrives, so they stay
      // edge to edge for the whole window.
      //
      // Derived from the *direction*, never from whether an offset happens to be zero. An
      // earlier version keyed the incoming clip's offset off `dx === 0`, meaning "this
      // direction has no horizontal component" — but at progress 0 a horizontal push also
      // has dx === 0, so the incoming clip was placed at offset 0 directly over the
      // outgoing and the transition began by showing its own destination. Caught by the
      // invariant that every kind must show the outgoing clip alone at progress 0.
      const horizontal = dir === 'left' || dir === 'right'
      const sign = dir === 'left' || dir === 'up' ? -1 : 1
      const travel = horizontal ? w : h
      const fromOffset = zeroed(sign * travel * p)
      // One full frame behind, so the pair never separates and never overlaps.
      const toOffset = zeroed(sign * travel * (p - 1))
      return [
        {
          kind: 'paint',
          which: 'from',
          alpha: 1,
          offsetX: horizontal ? fromOffset : 0,
          offsetY: horizontal ? 0 : fromOffset
        },
        {
          kind: 'paint',
          which: 'to',
          alpha: 1,
          offsetX: horizontal ? toOffset : 0,
          offsetY: horizontal ? 0 : toOffset
        }
      ]
    }

    case 'slide': {
      // Only the incoming moves; the outgoing stays put and is covered.
      const fromOffscreen =
        dir === 'left'
          ? { x: w * (1 - p), y: 0 }
          : dir === 'right'
            ? { x: -w * (1 - p), y: 0 }
            : dir === 'up'
              ? { x: 0, y: h * (1 - p) }
              : { x: 0, y: -h * (1 - p) }
      return [
        { kind: 'paint', which: 'from', alpha: 1, offsetX: 0, offsetY: 0 },
        { kind: 'paint', which: 'to', alpha: 1, offsetX: zeroed(fromOffscreen.x), offsetY: zeroed(fromOffscreen.y) }
      ]
    }

    case 'iris': {
      // A circle from the centre, grown to the corner so the whole frame is covered at p = 1.
      // Using half the width would leave the corners showing the outgoing clip at the end.
      const maxRadius = Math.hypot(w, h) / 2
      return [
        { kind: 'paint', which: 'from', alpha: 1, offsetX: 0, offsetY: 0 },
        {
          kind: 'paint',
          which: 'to',
          alpha: 1,
          offsetX: 0,
          offsetY: 0,
          clipCircle: { centreX: w / 2, centreY: h / 2, radius: maxRadius * p }
        }
      ]
    }
  }
}

/**
 * The transition audio curve lives in `@shared/audio-gain` so export, in main, uses the same
 * one. Re-exported so the engine's existing callers and tests are unchanged.
 */
export { transitionAudioGains } from '@shared/audio-gain'
