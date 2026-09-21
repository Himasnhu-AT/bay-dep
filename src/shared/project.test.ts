import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  containLayout,
  coverKeeps,
  coverLayout,
  defaultLayout,
  placementLayout,
  positionFromOrigin,
  positionToOrigin,
  LAYOUT_ORIGINS,
  LAYOUT_ORIGIN_LABEL
} from './project'

/**
 * How a clip is framed the moment it lands on the timeline.
 *
 * `coverLayout` and `containLayout` are both exactly right and both wrong as a universal
 * default; the only question this file settles is which one a clip *starts* with. Both remain
 * one click away in the inspector, as Fill and Fit.
 */

// --- how a clip is framed when it is first placed -----------------------------------------

test('a source shaped like the frame is covered, cropping nothing', () => {
  const timeline = { width: 1920, height: 1080 }

  assert.equal(coverKeeps(timeline, 1920, 1080), 1)
  assert.deepEqual(
    placementLayout(timeline, 1920, 1080),
    coverLayout(timeline, 1920, 1080)
  )
})

test('a vertical phone video on a landscape timeline is fitted, not cropped to a band', () => {
  // The bug this exists for: covering keeps under a third of the picture, so the clip arrives
  // as a horizontal slice out of the middle and reads as bay having mangled it.
  const timeline = { width: 1920, height: 1080 }
  const keeps = coverKeeps(timeline, 1080, 1920)

  assert.ok(keeps < 0.35, `covering keeps ${keeps}`)
  assert.deepEqual(
    placementLayout(timeline, 1080, 1920),
    containLayout(timeline, 1080, 1920)
  )
})

test('and the whole source is then inside the frame', () => {
  // The property that matters, stated directly rather than by comparing to containLayout: no
  // part of the picture is outside the canvas.
  const timeline = { width: 1920, height: 1080 }
  const layout = placementLayout(timeline, 1080, 1920)

  assert.ok(layout.left >= 0, `left ${layout.left}`)
  assert.ok(layout.top >= 0, `top ${layout.top}`)
  assert.ok(layout.left + layout.width <= timeline.width)
  assert.ok(layout.top + layout.height <= timeline.height)
})

test('a small mismatch still covers, because slivers of padding are worse than a sliver of crop', () => {
  // The positive control for the check above: a rule that always contained would pass it and
  // put black bars down the side of every 16:10 clip.
  const timeline = { width: 1920, height: 1080 }

  assert.deepEqual(
    placementLayout(timeline, 1920, 1200),
    coverLayout(timeline, 1920, 1200)
  )
})

test('4:3 either way is padded, which is the convention everyone already reads', () => {
  const landscape = { width: 1920, height: 1080 }
  const square = { width: 1080, height: 1080 }

  assert.deepEqual(placementLayout(landscape, 1440, 1080), containLayout(landscape, 1440, 1080))
  assert.deepEqual(placementLayout(square, 1920, 1080), containLayout(square, 1920, 1080))
})

test('coverKeeps is symmetric — a shape mismatch costs the same either way round', () => {
  const landscape = { width: 1920, height: 1080 }
  const portrait = { width: 1080, height: 1920 }

  assert.equal(coverKeeps(landscape, 1080, 1920), coverKeeps(portrait, 1920, 1080))
})

test('a source with no dimensions falls back rather than dividing by zero', () => {
  const timeline = { width: 1920, height: 1080 }

  assert.deepEqual(placementLayout(timeline, 0, 0), defaultLayout(timeline))
  assert.equal(coverKeeps(timeline, 0, 1080), 1)
})

// --- which corner X and Y are measured from ------------------------------------------------

const FRAME = { width: 1920, height: 1080 }
const box = (left: number, top: number, width = 400, height = 200) => ({ left, top, width, height })

test('top-left is unchanged, because it is what left and top already mean', () => {
  assert.deepEqual(positionFromOrigin(box(120, 80), FRAME, 'top-left'), { x: 120, y: 80 })
})

test('top-right measures the gap from the right edge, not where the left edge is', () => {
  // "80px from the right" is the number someone means, and the one that stays put when the
  // clip is resized. A clip 400 wide at left 1440 touches the right edge.
  assert.deepEqual(positionFromOrigin(box(1440, 80), FRAME, 'top-right'), { x: 80, y: 80 })
  assert.deepEqual(positionFromOrigin(box(1520, 80), FRAME, 'top-right'), { x: 0, y: 80 })
})

test('bottom origins measure up from the bottom edge', () => {
  assert.deepEqual(positionFromOrigin(box(120, 780), FRAME, 'bottom-left'), { x: 120, y: 100 })
  assert.deepEqual(positionFromOrigin(box(1440, 780), FRAME, 'bottom-right'), { x: 80, y: 100 })
})

test('centre is the offset between the two centres, so 0,0 means centred', () => {
  const centred = box((1920 - 400) / 2, (1080 - 200) / 2)
  assert.deepEqual(positionFromOrigin(centred, FRAME, 'center'), { x: 0, y: 0 })
})

test('every origin round-trips exactly, which is what stops the field fighting the user', () => {
  // Typing a number in and reading it back must give the same number. Anything else and the
  // value creeps every time the inspector re-renders.
  const size = { width: 400, height: 200 }
  for (const origin of LAYOUT_ORIGINS) {
    for (const [x, y] of [[0, 0], [80, 100], [-40, 25], [1520, 880]]) {
      const absolute = positionToOrigin({ x: x!, y: y! }, size, FRAME, origin)
      const back = positionFromOrigin({ ...absolute, ...size }, FRAME, origin)
      assert.deepEqual(back, { x, y }, `${origin} at ${x},${y}`)
    }
  }
})

test('resizing a top-right clip keeps its distance from the right edge', () => {
  // The reason to anchor at all: a clip pinned 80px from the right should still be 80px from
  // the right after it grows, which a left/top pair cannot express.
  const before = box(1440, 80, 400, 200)
  const distance = positionFromOrigin(before, FRAME, 'top-right')

  const wider = positionToOrigin(distance, { width: 600, height: 200 }, FRAME, 'top-right')

  assert.equal(wider.left, 1920 - 600 - 80)
  assert.deepEqual(
    positionFromOrigin({ ...wider, width: 600, height: 200 }, FRAME, 'top-right'),
    distance
  )
})

test('a clip larger than the frame gives a negative distance rather than clamping', () => {
  // Overscan is legitimate — a background plate is often larger than the frame — and silently
  // clamping it here would move the clip the moment anyone opened the inspector.
  const oversized = box(-100, -50, 2120, 1180)
  assert.deepEqual(positionFromOrigin(oversized, FRAME, 'top-right'), { x: -100, y: -50 })
})

test('every origin has a label, so the selector can never show a raw value', () => {
  for (const origin of LAYOUT_ORIGINS) {
    assert.equal(typeof LAYOUT_ORIGIN_LABEL[origin], 'string')
    assert.ok(LAYOUT_ORIGIN_LABEL[origin].length > 0, origin)
  }
})
