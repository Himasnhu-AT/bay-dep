/**
 * Remembering where the window was.
 *
 * The whole reason this is its own file, rather than four lines in `index.ts`, is the failure
 * it has to avoid: a window restored onto a display that is no longer attached opens
 * *offscreen*. The app is running, it is in the Dock, and there is nothing to click. That is
 * not a rare edge — it is what happens every time someone undocks a laptop, which is most
 * people most days.
 *
 * So the saved bounds are never trusted as given. They are checked against the displays that
 * exist right now, and discarded if no meaningful part of the window would be reachable.
 * Everything here is pure so that check can be tested against display layouts that are
 * tedious to reproduce by hand.
 */

/** Persisted in `app_state`. A key in the user's database — pinned as a literal in the test. */
export const WINDOW_BOUNDS_KEY = 'windowBounds'

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

export const MIN_WIDTH = 1100
export const MIN_HEIGHT = 700
export const DEFAULT_WIDTH = 1440
export const DEFAULT_HEIGHT = 900

/**
 * How much of the window's title area must land inside a display for it to count as
 * reachable. A window needs enough of its top edge on screen to be grabbed and dragged back.
 */
const VISIBLE_MARGIN = 80

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

export function parseBounds(raw: string | null): Bounds | null {
  if (!raw) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const { x, y, width, height } = parsed as Partial<Bounds>
  if (!isFiniteNumber(x) || !isFiniteNumber(y)) return null
  if (!isFiniteNumber(width) || !isFiniteNumber(height)) return null
  if (width <= 0 || height <= 0) return null
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }
}

export function serialiseBounds(bounds: Bounds): string {
  return JSON.stringify({
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.round(bounds.width),
    height: Math.round(bounds.height)
  })
}

function overlaps(bounds: Bounds, area: Bounds): boolean {
  const left = Math.max(bounds.x, area.x)
  const right = Math.min(bounds.x + bounds.width, area.x + area.width)
  const top = Math.max(bounds.y, area.y)
  // Only the top strip counts: a window whose title bar is above the display cannot be
  // dragged back down, however much of its body happens to overlap.
  const bottom = Math.min(bounds.y + VISIBLE_MARGIN, area.y + area.height)
  return right - left >= VISIBLE_MARGIN && bottom - top > 0
}

/**
 * The bounds to actually open with, or null to let the platform place a default window.
 *
 * Sizes are clamped to the app's minimums so a saved 200px-wide window — possible if a future
 * build lowers `minWidth`, or if the value is hand-edited — cannot produce an unusable window.
 */
export function restoreBounds(
  saved: Bounds | null,
  workAreas: readonly Bounds[]
): Bounds | null {
  if (!saved) return null
  if (workAreas.length === 0) return null

  const sized: Bounds = {
    ...saved,
    width: Math.max(MIN_WIDTH, saved.width),
    height: Math.max(MIN_HEIGHT, saved.height)
  }
  if (workAreas.some((area) => overlaps(sized, area))) return sized

  // The display it was on is gone. Rather than dropping to a default position — which loses
  // the size the user chose — keep the size and centre it on the primary display.
  const primary = workAreas[0]!
  return {
    width: Math.min(sized.width, primary.width),
    height: Math.min(sized.height, primary.height),
    x: Math.round(primary.x + (primary.width - Math.min(sized.width, primary.width)) / 2),
    y: Math.round(primary.y + (primary.height - Math.min(sized.height, primary.height)) / 2)
  }
}
