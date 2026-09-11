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
import { layoutBox, elementSlots } from './compositor'

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

/**
 * Which item is allowed to move a shared element.
 *
 * These exist because of a measured failure, not a hypothetical one. Two items on one asset
 * wanting different source times (20s and 0s) left the single pooled `<video>` seeking for
 * ever: `readyState` 1, `seeking` true, every item `pending`, and the canvas blank — 0 lit
 * pixels where the same project with one item drew 79,575, and no `redraw()` could mend it.
 * The compositor's own comment claimed the lower item would show a stale frame. It did not;
 * nothing was drawn at all.
 *
 * A unit test cannot watch an element thrash — that needs a decoder and a window, and it is
 * `test/app/` that measured the pixels. What it can pin is the rule that prevents it, which
 * is a pure question about ordering: exactly one item per asset per frame moves the element,
 * and it is the topmost, because that is the one on screen.
 */
test('two items sharing an asset in one frame get an element each', () => {
  // The case the one-writer rule could only degrade: both are meant to be visible, at
  // different source times, so each needs its own element. This is every transition between
  // two halves of a split clip - the commonest transition there is.
  const lower = { ...itemWith({}), id: 'itm_lower', assetId: 'ast_shared' }
  const upper = { ...itemWith({}), id: 'itm_upper', assetId: 'ast_shared' }
  const slots = elementSlots([lower, upper])
  assert.equal(slots.get('itm_lower'), 0)
  assert.equal(slots.get('itm_upper'), 1, 'not surrendered to the topmost - given its own')
  assert.notEqual(slots.get('itm_lower'), slots.get('itm_upper'))
})

test('the assignment is stable in draw order, so elements do not swap between frames', () => {
  // Stability is the safety property. itemsAtFrame returns lowest track first and items
  // within a track by `from`, so the outgoing clip keeps slot 0 for the whole transition
  // while the incoming holds slot 1. An assignment that flipped would swap what each element
  // holds every frame and reintroduce the thrash by another route.
  const a = { ...itemWith({}), id: 'itm_a', assetId: 'ast_shared' }
  const b = { ...itemWith({}), id: 'itm_b', assetId: 'ast_shared' }
  for (let frame = 0; frame < 5; frame += 1) {
    const slots = elementSlots([a, b])
    assert.equal(slots.get('itm_a'), 0, `frame ${frame}`)
    assert.equal(slots.get('itm_b'), 1, `frame ${frame}`)
  }
})

test('items on different assets all take slot 0', () => {
  // The ordinary frame: no asset is drawn twice, so nothing needs a second decoder and the
  // pool keys on the bare asset id exactly as it did before slots existed.
  const a = { ...itemWith({}), id: 'itm_a', assetId: 'ast_a' }
  const b = { ...itemWith({}), id: 'itm_b', assetId: 'ast_b' }
  assert.deepEqual([...elementSlots([a, b]).entries()], [['itm_a', 0], ['itm_b', 0]])
})

test('an interleaved repeat counts per asset, not per position', () => {
  // The shared asset appears at the bottom and again at the top with an unrelated clip
  // between. The unrelated one must not consume a slot of the shared asset.
  const bottom = { ...itemWith({}), id: 'itm_bottom', assetId: 'ast_shared' }
  const middle = { ...itemWith({}), id: 'itm_middle', assetId: 'ast_other' }
  const top = { ...itemWith({}), id: 'itm_top', assetId: 'ast_shared' }
  const slots = elementSlots([bottom, middle, top])
  assert.equal(slots.get('itm_bottom'), 0)
  assert.equal(slots.get('itm_middle'), 0, 'a different asset starts its own count')
  assert.equal(slots.get('itm_top'), 1)
})

test('three items on one asset get three elements', () => {
  const items = ['a', 'b', 'c'].map((n) => ({ ...itemWith({}), id: 'itm_' + n, assetId: 'ast_one' }))
  assert.deepEqual([...elementSlots(items).values()], [0, 1, 2])
})

test('an ordinary single item is slot 0, and an empty frame does not throw', () => {
  const only = { ...itemWith({}), id: 'itm_only', assetId: 'ast_only' }
  assert.equal(elementSlots([only]).get('itm_only'), 0)
  assert.equal(elementSlots([]).size, 0)
})
