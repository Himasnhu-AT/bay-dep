import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  containLayout,
  coverKeeps,
  coverLayout,
  defaultLayout,
  placementLayout
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
