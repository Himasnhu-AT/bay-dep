/**
 * `checkCanvasSize` and the canvas presets. Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CANVAS_PRESETS, checkCanvasSize } from './project'

test('an even size in range is accepted', () => {
  assert.equal(checkCanvasSize(1920, 1080), null)
  assert.equal(checkCanvasSize(16, 16), null)
  assert.equal(checkCanvasSize(8192, 8192), null)
})

test('an odd side is refused, naming the nearest even size to use instead', () => {
  const odd = checkCanvasSize(1081, 1920)
  assert.ok(odd)
  assert.match(odd, /even/)
  assert.match(odd, /1082 × 1920/)
  assert.match(checkCanvasSize(1920, 1081) ?? '', /1920 × 1082/)
})

test('fractions, zero and sizes out of range are refused with the range', () => {
  assert.match(checkCanvasSize(1920.5, 1080) ?? '', /whole pixels/)
  assert.match(checkCanvasSize(Number.NaN, 1080) ?? '', /whole pixels/)
  assert.match(checkCanvasSize(0, 1080) ?? '', /16 to 8192/)
  assert.match(checkCanvasSize(8194, 1080) ?? '', /16 to 8192/)
})

test('every preset is a usable canvas, the ids are unique, and the default stays first', () => {
  for (const preset of CANVAS_PRESETS) assert.equal(checkCanvasSize(preset.width, preset.height), null, preset.id)
  assert.equal(new Set(CANVAS_PRESETS.map((preset) => preset.id)).size, CANVAS_PRESETS.length)
  // A new timeline and a new project take the first entry; 1920×1080 is what every existing one had.
  assert.deepEqual([CANVAS_PRESETS[0]?.width, CANVAS_PRESETS[0]?.height], [1920, 1080])
  // The shapes the settings promise are all there.
  const sizes = CANVAS_PRESETS.map((preset) => `${preset.width}x${preset.height}`)
  for (const wanted of ['1280x720', '1920x1080', '2560x1440', '3840x2160', '1080x1920', '1080x1080', '1080x1350', '2560x1080']) {
    assert.ok(sizes.includes(wanted), wanted)
  }
})
