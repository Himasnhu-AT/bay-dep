/**
 * Tests for the compositor's placement arithmetic.
 *
 * This is the destination rectangle handed to `drawImage`, and it exists as its own test
 * because the correct answer looks wrong. A 1080x1920 clip covering a 1920x1080 project
 * gets `top: -1166, height: 3413` — the image overflows above and below by design, which
 * is what "cover" means — and that shape has now been read as a bug by three people on
 * three separate occasions. A test that says "this is intended" ends that argument in
 * seconds rather than hours.
 *
 * What this does *not* cover: whether the rect reaches the real canvas, whether the canvas
 * is the one on screen, and what the resulting pixels look like. Those need a DOM, a
 * decoder and a window, and they live in `test/app/geometry.mjs`.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { coverLayout, containLayout, type Item, type Layout } from '@shared/project'
import { layoutBox } from './compositor'

function itemWith(layout: Partial<Layout>): Item {
  return {
    id: 'itm',
    assetId: 'ast',
    trackId: 'trk',
    from: 0,
    durationInFrames: 100,
    sourceStartUs: 0,
    layout: { left: 0, top: 0, width: 100, height: 100, opacity: 1, rotation: 0, ...layout },
    volume: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    speed: 1
  }
}

test('a cover layout overflows the canvas, and the rect is passed through unclamped', () => {
  // The real case: a 1080x1920 phone clip in a 1920x1080 project.
  const layout = coverLayout({ width: 1920, height: 1080 }, 1080, 1920)
  assert.deepEqual(
    { left: layout.left, top: layout.top, width: layout.width, height: layout.height },
    { left: 0, top: -1166, width: 1920, height: 3413 },
    'coverLayout scales to fill both axes and centres the overflow'
  )

  const box = layoutBox(itemWith(layout))
  assert.deepEqual(box, { left: 0, top: -1166, width: 1920, height: 3413 })
  assert.ok(box !== null && box.top < 0, 'a negative top is not an error to be corrected')
  assert.ok(box !== null && box.height > 1080, 'nor is a height larger than the canvas')
})

test('clamping a cover rect into the canvas would squash the picture', () => {
  // Guarding the failure mode directly: if anyone "fixes" the negative top by clamping to
  // zero and fitting the height, a 9:16 source is squashed into 16:9 and every face in the
  // frame gets wider. The assertion is that the box is NOT that.
  const layout = coverLayout({ width: 1920, height: 1080 }, 1080, 1920)
  const box = layoutBox(itemWith(layout))
  assert.ok(box !== null)
  const squashed = { left: 0, top: 0, width: 1920, height: 1080 }
  assert.notDeepEqual(box, squashed)
  const sourceAspect = 1080 / 1920
  assert.ok(
    Math.abs(box.width / box.height - sourceAspect) < 0.001,
    'the rect keeps the source aspect ratio, which is the whole point of cover'
  )
})

test('a contain layout letterboxes rather than overflowing', () => {
  const layout = containLayout({ width: 1920, height: 1080 }, 1080, 1920)
  const box = layoutBox(itemWith(layout))
  assert.deepEqual(box, { left: 656, top: 0, width: 608, height: 1080 })
  assert.ok(box !== null && box.left > 0 && box.top === 0, 'pillarboxed, full height')
})

test('a layout that cannot produce a rectangle produces nothing', () => {
  // drawImage with a zero destination is a no-op, but a negative one is a mirror in some
  // engines and an exception in others. Neither is what a broken layout means.
  assert.equal(layoutBox(itemWith({ width: 0 })), null)
  assert.equal(layoutBox(itemWith({ height: 0 })), null)
  assert.equal(layoutBox(itemWith({ width: -100 })), null)
  assert.equal(layoutBox(itemWith({ height: -100 })), null)
})

test('NaN and Infinity cannot reach the canvas', () => {
  // The render path must not throw on anything the project model can hold, and a NaN in a
  // destination rect silently draws nothing while poisoning nothing else.
  assert.equal(layoutBox(itemWith({ width: Number.NaN })), null)
  assert.equal(layoutBox(itemWith({ height: Number.POSITIVE_INFINITY })), null)
  assert.deepEqual(layoutBox(itemWith({ left: Number.NaN, top: Number.NaN })), {
    left: 0,
    top: 0,
    width: 100,
    height: 100
  })
  assert.deepEqual(layoutBox(itemWith({ left: Number.NEGATIVE_INFINITY })), {
    left: 0,
    top: 0,
    width: 100,
    height: 100
  })
})

test('an ordinary layout passes through untouched', () => {
  assert.deepEqual(layoutBox(itemWith({ left: 12.5, top: -3.25, width: 640, height: 360 })), {
    left: 12.5,
    top: -3.25,
    width: 640,
    height: 360
  })
})
