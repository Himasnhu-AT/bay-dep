/**
 * Tests for window bounds restoration.
 *
 * The case that matters is the undocked laptop: a window saved on an external display that is
 * no longer attached must not be restored onto coordinates nothing can reach. The app would
 * launch, appear in the Dock, and present nothing to click — and it would do it every launch
 * until the user found the database. That is untestable by hand without physically
 * unplugging a monitor, which is exactly why the geometry is pure and tested here.
 *
 * Mutation-tested: the offscreen check removed, the visible margin dropped to zero, the size
 * clamp removed, and the recovery re-centring replaced by the saved position. All fail here.
 *
 * Run with `pnpm test`, or on its own:
 *   node --import ./src/test-hooks.mjs --test src/main/window-state.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_HEIGHT,
  DEFAULT_WIDTH,
  MIN_HEIGHT,
  MIN_WIDTH,
  WINDOW_BOUNDS_KEY,
  parseBounds,
  restoreBounds,
  serialiseBounds,
  type Bounds
} from './window-state'

const LAPTOP: Bounds = { x: 0, y: 25, width: 1512, height: 945 }
const EXTERNAL: Bounds = { x: 1512, y: 0, width: 2560, height: 1440 }

// ---------------------------------------------------------------------------
// The persisted key
// ---------------------------------------------------------------------------

test('the bounds key is pinned, because it lives in the user’s database', () => {
  // Written as a literal: reading it through the constant on both sides would let a rename
  // move both together while every existing user silently loses their window position.
  assert.equal(WINDOW_BOUNDS_KEY, 'windowBounds')
})

test('bounds survive a round trip through the database as text', () => {
  const bounds: Bounds = { x: 100, y: 200, width: 1440, height: 900 }
  assert.deepEqual(parseBounds(serialiseBounds(bounds)), bounds)
})

test('fractional bounds are rounded, because a window cannot be at x=100.4', () => {
  const parsed = parseBounds('{"x":100.4,"y":200.6,"width":1440.2,"height":900.8}')
  assert.deepEqual(parsed, { x: 100, y: 201, width: 1440, height: 901 })
})

test('anything that is not usable bounds reads as nothing', () => {
  // Every one of these has to fall back to a default window rather than throw at launch.
  for (const raw of [
    null,
    '',
    'not json',
    '{}',
    '[]',
    '"a string"',
    '{"x":0,"y":0,"width":0,"height":900}',
    '{"x":0,"y":0,"width":-1440,"height":900}',
    '{"x":null,"y":0,"width":1440,"height":900}',
    '{"y":0,"width":1440,"height":900}'
  ]) {
    assert.equal(parseBounds(raw), null, `${JSON.stringify(raw)} should not parse`)
  }
})

test('NaN and Infinity do not survive parsing', () => {
  // JSON cannot carry them directly, but a hand-edited or corrupted value can produce them
  // through the numeric fields, and a NaN position is a window nothing can place.
  assert.equal(parseBounds('{"x":1e999,"y":0,"width":1440,"height":900}'), null)
})

// ---------------------------------------------------------------------------
// Restoring
// ---------------------------------------------------------------------------

test('a window on a display that still exists comes back where it was', () => {
  const saved: Bounds = { x: 200, y: 120, width: 1440, height: 900 }
  assert.deepEqual(restoreBounds(saved, [LAPTOP, EXTERNAL]), saved)
})

test('a window on the second display comes back on the second display', () => {
  const saved: Bounds = { x: 2000, y: 300, width: 1440, height: 900 }
  assert.deepEqual(restoreBounds(saved, [LAPTOP, EXTERNAL]), saved)
})

test('a window saved on a display that is gone is brought back onto the primary', () => {
  // The undocked laptop. Without this the window opens at x=2000 with nothing there.
  const saved: Bounds = { x: 2600, y: 300, width: 1440, height: 900 }
  const restored = restoreBounds(saved, [LAPTOP])

  assert.notEqual(restored, null)
  assert.ok(restored!.x >= LAPTOP.x, 'restored window starts left of the display edge')
  assert.ok(
    restored!.x + restored!.width <= LAPTOP.x + LAPTOP.width + 1,
    'restored window runs off the right of the display'
  )
  assert.ok(restored!.y >= LAPTOP.y - 1)
})

test('the size the user chose survives the display going away', () => {
  // Recovering by dropping to a default would lose a deliberately sized window; only the
  // position is wrong, so only the position is replaced.
  const saved: Bounds = { x: 2600, y: 300, width: 1300, height: 820 }
  const restored = restoreBounds(saved, [LAPTOP])
  assert.equal(restored?.width, 1300)
  assert.equal(restored?.height, 820)
})

test('a window mostly offscreen but with a grabbable title strip is left alone', () => {
  // Users park windows half off the edge on purpose. The test is whether it can be dragged
  // back, not whether it is fully visible.
  const saved: Bounds = { x: 1400, y: 100, width: 1440, height: 900 }
  assert.deepEqual(restoreBounds(saved, [LAPTOP]), saved)
})

test('a window whose title bar is above the screen is recovered, not kept', () => {
  // Overlap alone is not the test: this window covers most of the display, and none of it can
  // be grabbed, because the title bar is off the top.
  const saved: Bounds = { x: 200, y: -400, width: 1440, height: 900 }
  const restored = restoreBounds(saved, [LAPTOP])
  assert.notDeepEqual(restored, saved)
  assert.ok((restored?.y ?? 0) >= LAPTOP.y - 1)
})

test('a saved window smaller than the minimum is grown to it', () => {
  const saved: Bounds = { x: 100, y: 100, width: 320, height: 240 }
  const restored = restoreBounds(saved, [LAPTOP])
  assert.equal(restored?.width, MIN_WIDTH)
  assert.equal(restored?.height, MIN_HEIGHT)
})

test('a window larger than the only display is trimmed to fit it', () => {
  const saved: Bounds = { x: 3000, y: 0, width: 3800, height: 2000 }
  const restored = restoreBounds(saved, [LAPTOP])
  assert.ok((restored?.width ?? 0) <= LAPTOP.width)
  assert.ok((restored?.height ?? 0) <= LAPTOP.height)
})

test('nothing saved means the platform places the window', () => {
  assert.equal(restoreBounds(null, [LAPTOP]), null)
})

test('no displays at all means no opinion, rather than a window at 0,0', () => {
  // `screen.getAllDisplays()` returning empty should not be answered with a guess.
  assert.equal(restoreBounds({ x: 0, y: 0, width: 1440, height: 900 }, []), null)
})

test('the defaults are the size the app asks for when nothing is saved', () => {
  assert.ok(DEFAULT_WIDTH >= MIN_WIDTH)
  assert.ok(DEFAULT_HEIGHT >= MIN_HEIGHT)
})
