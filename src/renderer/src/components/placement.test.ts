/**
 * Floating placement: the geometry every menu, popover and tooltip shares.
 *
 * Each case is a position the old hand-rolled menus got wrong — the clip menu drew off-panel
 * near the right and bottom edges because it was placed at the raw pointer with no clamp.
 *
 * Run: node --import ./src/test-hooks.mjs --test src/renderer/src/components/placement.test.ts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { placeFloating } from './placement'

const viewport = { width: 1000, height: 800 }
const size = { width: 200, height: 150 }
const point = (x: number, y: number) => ({ left: x, top: y, width: 0, height: 0 })

test('below its trigger, start-aligned, growing from the trigger', () => {
  const p = placeFloating({ anchor: { left: 100, top: 100, width: 40, height: 28 }, size, viewport })
  assert.deepEqual([p.left, p.top, p.side], [100, 132, 'bottom'])
  assert.equal(p.origin, '20px 0px')
})

test('flips above when there is no room below', () => {
  const p = placeFloating({ anchor: { left: 100, top: 740, width: 40, height: 28 }, size, viewport })
  assert.equal(p.side, 'top')
  assert.equal(p.top, 740 - 4 - 150)
  assert.equal(p.origin, '20px 150px')
})

test('a context menu near the right edge opens leftward from the pointer', () => {
  const p = placeFloating({ anchor: point(950, 300), size, viewport, gap: 0 })
  assert.equal(p.left, 750)
  assert.equal(p.top, 300)
})

test('a context menu near the bottom-right corner stays wholly on screen', () => {
  const p = placeFloating({ anchor: point(995, 795), size, viewport, gap: 0 })
  assert.ok(p.left >= 8 && p.left + size.width <= viewport.width - 8, `left ${p.left}`)
  assert.ok(p.top >= 8 && p.top + size.height <= viewport.height - 8, `top ${p.top}`)
})

test('end alignment lines the right edges up, and falls back to start at the left edge', () => {
  const anchor = { left: 500, top: 100, width: 28, height: 28 }
  assert.equal(placeFloating({ anchor, size, viewport, align: 'end' }).left, 528 - 200)
  const nearLeft = { left: 10, top: 100, width: 28, height: 28 }
  assert.equal(placeFloating({ anchor: nearLeft, size, viewport, align: 'end' }).left, 10)
})

test('a tooltip wider than the space left of centre is clamped, not clipped', () => {
  const p = placeFloating({
    anchor: { left: 0, top: 10, width: 20, height: 20 },
    size: { width: 120, height: 24 },
    viewport,
    align: 'center'
  })
  assert.equal(p.left, 8)
})

test('a side placement flips across when the preferred side has no room', () => {
  const p = placeFloating({ anchor: { left: 900, top: 100, width: 40, height: 20 }, size, viewport, side: 'right' })
  assert.equal(p.side, 'left')
  assert.equal(p.left, 900 - 4 - 200)
})
