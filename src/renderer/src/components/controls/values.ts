/**
 * The arithmetic every value control shares — modifier scales, clamping, rounding, snapping and
 * the scroll-wheel mapping — kept free of React and the DOM so it can be tested under plain Node.
 */

/**
 * **One modifier convention for the whole kit, for drag and for keys alike.**
 *
 * - **Shift = coarse (×10).** After Effects and Premiere Pro both scrub in tens with Shift held
 *   (Adobe community threads quoted in `r&d/research/value-controls.md` §2.1; Adobe's own helpx
 *   pages refused the fetcher, so these are community/search-excerpt sources).
 * - **Cmd/Ctrl = fine (×0.1).** The same Adobe sources: Ctrl/Cmd scrubs in tenths.
 * - **Alt/Option = fine (×0.1) too**, for Resolve users: Alt-drag gives finer adjustment in
 *   Resolve's Inspector (a Blackmagic forum thread, forum-only; not found in the manual).
 *
 * Fine wins when both are held: a person reaching for precision with a second finger on Shift
 * has not asked for a bigger step. Before this, `NumberField` dragged Shift = fine and Alt =
 * coarse while its own arrow keys used Shift = coarse, under a comment calling the drag "the
 * convention every editor shares" — it matched none of them.
 */
export const MODIFIER_SCALE = { coarse: 10, fine: 0.1 } as const

export interface Modifiers {
  shift: boolean
  alt: boolean
  /** Cmd on macOS, Ctrl elsewhere. */
  meta: boolean
}

/** The multiplier a held modifier applies to a step. */
export function modifierScale(mods: Modifiers): number {
  if (mods.alt || mods.meta) return MODIFIER_SCALE.fine
  if (mods.shift) return MODIFIER_SCALE.coarse
  return 1
}

/** A keyboard or wheel event's modifiers in the kit's terms. */
export function modifiersOf(event: { shiftKey: boolean; altKey: boolean; metaKey: boolean; ctrlKey: boolean }): Modifiers {
  return { shift: event.shiftKey, alt: event.altKey, meta: event.metaKey || event.ctrlKey }
}

/**
 * **The one guard every control commits through** — the value to commit, or null for none.
 *
 * Not defensive — measured, in `NumberField` first (CLAUDE.md): every *typed* route in is already
 * finite, but a value arriving *from the store* is not always — seed `layout.rotation = NaN` or
 * `track.volume = NaN`, and a drag, an arrow or a wheel notch carries the NaN through its
 * arithmetic into a commit, which writes NaN into the project and pushes an undo step for it. The
 * undo stack is the observable: `past` moves with the guard gone and stays still with it.
 * `silence` lets `-Infinity` through, which is a fader's −∞ and a real level.
 */
export function committable(value: number, silence = false): number | null {
  if (Number.isFinite(value)) return value
  if (silence && value === Number.NEGATIVE_INFINITY) return value
  return null
}

/** `onCommit` behind `committable`: a non-finite value is dropped rather than written. */
export function guardCommit(onCommit: (value: number) => void, silence = false): (value: number) => void {
  return (value) => {
    const safe = committable(value, silence)
    if (safe !== null) onCommit(safe)
  }
}

/**
 * A drag accumulated move by move, each move's delta scaled by the modifier held *during that
 * move* — so pressing Cmd halfway through a drag makes the rest of it fine instead of jumping the
 * value to a tenth of the whole drag so far. `move` takes the drag's total offset (as `useDrag`
 * reports it) and a function turning one move's delta into a value change; repeating the same
 * offset (the release after the last move) changes nothing. `hold` clamps after each move, so a
 * drag past an end turns back from the end rather than from where the pointer overshot to.
 */
export function createDragAccumulator(
  start: number,
  hold: (value: number) => number = (value) => value
): { move(dx: number, dy: number, change: (ddx: number, ddy: number) => number): number; readonly value: number } {
  let value = start
  let lastX = 0
  let lastY = 0
  return {
    move(dx, dy, change) {
      value = hold(value + change(dx - lastX, dy - lastY))
      lastX = dx
      lastY = dy
      return value
    },
    get value() {
      return value
    }
  }
}

export function clamp(value: number, min: number | undefined, max: number | undefined): number {
  let out = value
  if (min !== undefined) out = Math.max(min, out)
  if (max !== undefined) out = Math.min(max, out)
  return out
}

/** Decimal places in a step: 0.05 → 2, 1 → 0, 1e-3 → 3. */
export function decimalsOf(step: number): number {
  if (!Number.isFinite(step)) return 0
  const text = String(step)
  const exp = /e-(\d+)$/.exec(text)
  if (exp) return Number(exp[1])
  return (text.split('.')[1] ?? '').length
}

/** Rounds to `decimals` places without leaving 0.30000000000000004 behind. */
export function roundTo(value: number, decimals: number): number {
  return Number(value.toFixed(Math.max(0, Math.min(20, decimals))))
}

/** `value` on the grid of `step` (from 0), clamped, with the step's own decimals. */
export function snapToStep(value: number, step: number, min?: number, max?: number): number {
  if (!(step > 0)) return clamp(value, min, max)
  const snapped = Math.round(value / step) * step
  return roundTo(clamp(snapped, min, max), decimalsOf(step))
}

/**
 * The increment one arrow press (or one wheel notch) moves a field by: `step` scaled by the held
 * modifier, but never finer than what the field shows. A fine step of 0.1 on a whole-pixel field
 * would round straight back to where it started, so a fine press there moves one pixel — the
 * smallest move the field can show — rather than doing nothing.
 */
export function keyStep(step: number, mods: Modifiers, precision: number): number {
  const smallest = 10 ** -Math.max(0, precision)
  return Math.max(step * modifierScale(mods), smallest)
}

/** The value a drag reaches: where it started plus pixels travelled × step × modifier. */
export function dragValue(start: number, pixels: number, step: number, mods: Modifiers): number {
  return start + pixels * step * modifierScale(mods)
}

// ---------------------------------------------------------------------------
// Scroll wheel
// ---------------------------------------------------------------------------

/**
 * Pixels of wheel travel that make one step. A mouse notch is ~100px (deltaMode 0) in Chromium;
 * a trackpad sends many small deltas, which accumulate to the same distance per step, so one
 * flick of each moves a field about as far.
 */
export const WHEEL_PIXELS_PER_STEP = 100
/** A scroll of the page this recent means the wheel belongs to the page, not the field. */
export const WHEEL_SCROLL_QUIET_MS = 300

/**
 * Whole steps in `accumulated + delta` wheel travel, and what is left over. Wheel down (positive
 * `deltaY`) is a decrease, as in every NLE that wheels a value; a line-mode delta (deltaMode 1)
 * counts a line as a notch.
 */
export function wheelSteps(
  accumulated: number,
  deltaY: number,
  deltaMode = 0
): { steps: number; rest: number } {
  const pixels = deltaMode === 1 ? deltaY * WHEEL_PIXELS_PER_STEP : deltaMode === 2 ? deltaY * WHEEL_PIXELS_PER_STEP * 3 : deltaY
  const total = accumulated - pixels
  const steps = Math.trunc(total / WHEEL_PIXELS_PER_STEP)
  return { steps, rest: total - steps * WHEEL_PIXELS_PER_STEP }
}

/**
 * Whether a wheel event may change the value: only while the pointer is over the control **and**
 * the control has focus, and not while the page is scrolling. An inspector scrolls, and a wheel
 * that changed whatever passed under the pointer is how values get changed by accident; a field
 * that scrolls under a pointer mid-scroll keeps the scroll going.
 */
export function wheelAdjusts(state: { hovered: boolean; focused: boolean; msSinceScroll: number }): boolean {
  return state.hovered && state.focused && state.msSinceScroll >= WHEEL_SCROLL_QUIET_MS
}
