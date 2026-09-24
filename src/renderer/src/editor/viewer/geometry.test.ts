import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Crop, Layout } from '@shared/project'
import {
  boundsOf,
  contains,
  corners,
  cropDragResult,
  dragResult,
  handlePoint,
  itemFrame,
  layoutForFrame,
  resizeFrame,
  resizeCursor,
  rotationFor,
  snapBounds,
  snapPoint,
  snapTargets,
  topmostAt,
  viewerSize,
  scrollForCentre,
  centreOfScroll,
  type Frame
} from './geometry'

const L = (patch: Partial<Layout> = {}): Layout => ({
  left: 0,
  top: 0,
  width: 100,
  height: 50,
  opacity: 1,
  rotation: 0,
  ...patch
})

const close = (actual: number, expected: number, what: string, eps = 1e-6): void =>
  assert.ok(Math.abs(actual - expected) <= eps, `${what}: ${actual} ≠ ${expected}`)

function sameFrame(a: Frame, b: Frame, what: string): void {
  close(a.cx, b.cx, `${what} cx`)
  close(a.cy, b.cy, `${what} cy`)
  close(a.halfW, b.halfW, `${what} halfW`)
  close(a.halfH, b.halfH, `${what} halfH`)
}

test('an untouched layout draws its own box', () => {
  sameFrame(itemFrame(L({ left: 10, top: 20 }))!, { cx: 60, cy: 45, halfW: 50, halfH: 25, angle: 0 }, 'plain')
  assert.equal(itemFrame(L({ width: 0 })), null, 'the compositor draws nothing for a zero box, so neither do we')
})

test('crop, rotation and zoom are about the box centre, as the compositor applies them', () => {
  // Worked by hand: a 100×50 box at the origin with its left half cropped away keeps x 50..100.
  // The kept part's centre (75, 25) is 25 right of the box centre (50, 25); rotated 90°
  // clockwise about the box centre it lands at (50, 50), and it is a 50×50 square.
  const crop: Crop = { left: 0.5, top: 0, right: 0, bottom: 0 }
  const f = itemFrame(L({ rotation: 90 }), crop)!
  sameFrame(f, { cx: 50, cy: 50, halfW: 25, halfH: 25, angle: 0 }, 'cropped + rotated')

  // Zoom 2 doubles the drawn size about the box centre, and doubles the crop's offset with it.
  const z = itemFrame(L({ scale: 2 }), crop)!
  sameFrame(z, { cx: 100, cy: 25, halfW: 50, halfH: 50, angle: 0 }, 'cropped + zoomed')
})

test('layoutForFrame is the exact inverse of itemFrame, crop and zoom and rotation included', () => {
  let seed = 7
  const rand = (): number => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < 500; i += 1) {
    const layout = L({
      left: rand() * 2000 - 500,
      top: rand() * 1200 - 300,
      width: 10 + rand() * 1900,
      height: 10 + rand() * 1000,
      rotation: rand() * 720 - 360,
      scale: 0.2 + rand() * 3
    })
    const crop: Crop = { left: rand() * 0.4, top: rand() * 0.4, right: rand() * 0.4, bottom: rand() * 0.4 }
    const back = layoutForFrame(itemFrame(layout, crop)!, layout, crop)!
    for (const key of ['left', 'top', 'width', 'height'] as const) close(back[key], layout[key], `#${i} ${key}`, 1e-6)
  }
})

test('the hit test follows the rotation, not the unrotated box', () => {
  // A 100×100 square turned 45°: its bounding box's corner is empty, its own corner is not.
  const f = itemFrame(L({ width: 100, height: 100, rotation: 45 }))!
  assert.equal(contains(f, { x: 50, y: 50 }), true, 'centre')
  assert.equal(contains(f, { x: 2, y: 2 }), false, 'the unrotated corner is outside a turned square')
  assert.equal(contains(f, { x: 50, y: 50 - 70 }), true, 'the turned corner reaches ~70.7 above centre')
  assert.equal(contains(f, { x: 2, y: 2 }, 40), true, 'slop widens it')
})

test('dragging a corner keeps the opposite corner still, rotated or not', () => {
  for (const rotation of [0, 30, 90, -135]) {
    const start = itemFrame(L({ rotation }))!
    const anchor = handlePoint(start, 'nw')
    const target = handlePoint({ ...start, halfW: 80, halfH: 40 }, 'se')
    const next = resizeFrame(start, 'se', target)
    const moved = handlePoint(next, 'nw')
    close(moved.x, anchor.x, `${rotation}° anchor x`)
    close(moved.y, anchor.y, `${rotation}° anchor y`)
    const reached = handlePoint(next, 'se')
    close(reached.x, target.x, `${rotation}° handle follows pointer x`)
    close(reached.y, target.y, `${rotation}° handle follows pointer y`)
  }
})

test('an edge handle changes one axis only', () => {
  const start = itemFrame(L())!
  const next = resizeFrame(start, 'e', { x: 150, y: 999 })
  close(next.halfW, 75, 'width grows to the pointer')
  close(next.halfH, 25, 'height untouched, whatever the pointer y')
  close(next.cx - next.halfW, 0, 'left edge stays')
})

test('shift keeps the aspect ratio on a corner; alt resizes from the centre', () => {
  const start = itemFrame(L())!
  const kept = resizeFrame(start, 'se', { x: 200, y: 60 }, { keepAspect: true })
  close(kept.halfW / kept.halfH, 2, 'aspect kept')
  close(kept.halfW, 100, 'follows the axis pulled further')

  const centred = resizeFrame(start, 'se', { x: 90, y: 45 }, { fromCentre: true })
  close(centred.cx, start.cx, 'centre x fixed')
  close(centred.cy, start.cy, 'centre y fixed')
  close(centred.halfW, 40, 'half-width is the pointer distance from centre')

  const floor = resizeFrame(start, 'se', { x: -500, y: -500 }, { minHalf: 4 })
  assert.ok(floor.halfW >= 4 && floor.halfH >= 4, 'dragging past the anchor never inverts the box')
})

test('rotation follows the pointer about the pivot and snaps to 15° with shift', () => {
  const pivot = { x: 0, y: 0 }
  close(rotationFor(0, pivot, { x: 0, y: -10 }, { x: 10, y: 0 }), 90, 'a quarter turn clockwise')
  close(rotationFor(10, pivot, { x: 0, y: -10 }, { x: 10, y: -10 }), 55, 'relative to the grab')
  close(rotationFor(0, pivot, { x: 0, y: -10 }, { x: 10, y: -9 }, true), 45, 'snapped')
  close(rotationFor(170, pivot, { x: 0, y: -10 }, { x: 10, y: 0 }), -100, 'normalised into (-180, 180]')
})

test('a move snaps to the canvas centre within the threshold and not beyond it', () => {
  const canvas = { width: 1920, height: 1080 }
  const targets = snapTargets(canvas, [])
  // A 200-wide clip whose centre is 3 units right of the canvas centre.
  const near = snapBounds({ left: 863, right: 1063, top: 100, bottom: 200 }, targets, 5)
  close(near.dx, -3, 'pulled onto the centre line')
  assert.equal(near.guideX, 960)
  const far = snapBounds({ left: 870, right: 1070, top: 100, bottom: 200 }, targets, 5)
  assert.equal(far.dx, 0, '10 away is not snapped')
  assert.equal(far.guideX, null)
})

test('other clips’ edges are targets too, and a handle snaps only on the axes it moves', () => {
  const targets = snapTargets({ width: 1000, height: 1000 }, [{ left: 300, top: 300, right: 400, bottom: 400 }])
  const s = snapBounds({ left: 402, right: 502, top: 600, bottom: 700 }, targets, 4)
  close(s.dx, -2, 'left edge onto the other clip’s right edge')
  assert.equal(s.guideX, 400)

  const p = snapPoint({ x: 398, y: 502 }, targets, 4, { x: true, y: false })
  assert.deepEqual(p.point, { x: 400, y: 502 }, 'an east handle does not snap vertically')
})

test('the topmost clip under the pointer wins', () => {
  const bottom = { id: 'a', frame: itemFrame(L({ width: 200, height: 200 })) }
  const top = { id: 'b', frame: itemFrame(L({ left: 50, top: 50 })) }
  assert.equal(topmostAt([bottom, top], { x: 60, y: 60 })?.id, 'b', 'drawn later is on top')
  assert.equal(topmostAt([bottom, top], { x: 180, y: 180 })?.id, 'a', 'only the lower clip is here')
  assert.equal(topmostAt([bottom, top], { x: 500, y: 500 }), null)
})

test('the AABB of a turned clip encloses all its corners', () => {
  const f = itemFrame(L({ rotation: 30 }))!
  const b = boundsOf(f)
  for (const c of corners(f)) assert.ok(c.x >= b.left - 1e-9 && c.x <= b.right + 1e-9 && c.y >= b.top - 1e-9 && c.y <= b.bottom + 1e-9)
})

const NO_MODS = { shift: false, alt: false, suspendSnap: false }
const canvasTargets = snapTargets({ width: 1920, height: 1080 }, [])

test('a move tracks the pointer 1:1 and writes position only', () => {
  const start = { mode: { kind: 'move' as const }, layout: L({ left: 100, top: 100 }), pointer: { x: 150, y: 120 }, targets: canvasTargets }
  const r = dragResult(start, { x: 187, y: 91 }, NO_MODS, 0)
  assert.deepEqual(r.patch, { left: 137, top: 71 }, 'the grab point stays under the pointer; size untouched')
})

test('a move snaps its centre to the frame centre, and ⌘ suspends it', () => {
  // A 100×50 clip dragged so its centre is 3 units off the frame's centre line (960).
  const start = { mode: { kind: 'move' as const }, layout: L({ left: 0, top: 500 }), pointer: { x: 0, y: 0 }, targets: canvasTargets }
  const snapped = dragResult(start, { x: 913, y: 0 }, NO_MODS, 6)
  assert.equal(snapped.patch.left, 910, 'centre on 960')
  assert.equal(snapped.guideX, 960)
  const free = dragResult(start, { x: 913, y: 0 }, { ...NO_MODS, suspendSnap: true }, 6)
  assert.equal(free.patch.left, 913, '⌘ held: exactly where the pointer put it')
  assert.equal(free.guideX, null)
})

test('⇧ constrains a move to one axis', () => {
  const start = { mode: { kind: 'move' as const }, layout: L({ left: 300, top: 300 }), pointer: { x: 0, y: 0 }, targets: canvasTargets }
  const r = dragResult(start, { x: 40, y: 7 }, { ...NO_MODS, shift: true, suspendSnap: true }, 6)
  assert.deepEqual(r.patch, { left: 340, top: 300 })
})

test('a handle keeps its grab offset: grabbing off-centre does not jump the edge', () => {
  // The east handle is at x=100; the pointer went down 3 units inside it.
  const start = { mode: { kind: 'resize' as const, handle: 'e' as const }, layout: L(), pointer: { x: 97, y: 25 }, targets: canvasTargets }
  const still = dragResult(start, { x: 97, y: 25 }, { ...NO_MODS, suspendSnap: true }, 0)
  assert.deepEqual(still.patch, { left: 0, top: 0, width: 100, height: 50 }, 'no movement, no change')
  const moved = dragResult(start, { x: 117, y: 40 }, { ...NO_MODS, suspendSnap: true }, 0)
  assert.equal(moved.patch.width, 120)
})

test('resizing a cropped, zoomed clip moves the visible edge with the pointer', () => {
  // The right half is cropped away and the clip is zoomed 2×: what shows is 100 wide, x 50..150.
  const crop: Crop = { left: 0.5, top: 0, right: 0, bottom: 0 }
  const layout = L({ scale: 2 })
  const before = itemFrame(layout, crop)!
  const eastX = before.cx + before.halfW
  const start = { mode: { kind: 'resize' as const, handle: 'e' as const }, layout, crop, pointer: { x: eastX, y: before.cy }, targets: canvasTargets }
  const r = dragResult(start, { x: eastX + 40, y: before.cy }, { ...NO_MODS, suspendSnap: true }, 0)
  const after = itemFrame({ ...layout, ...r.patch } as Layout, crop)!
  close(after.cx + after.halfW, eastX + 40, 'the visible east edge is under the pointer', 0.02)
  close(after.cx - after.halfW, before.cx - before.halfW, 'the visible west edge did not move', 0.02)
})

test('rotating with ⇧ lands on 15° steps', () => {
  const start = { mode: { kind: 'rotate' as const }, layout: L({ rotation: 0 }), pointer: { x: 50, y: -100 }, targets: canvasTargets }
  const r = dragResult(start, { x: 150, y: -60 }, { ...NO_MODS, shift: true }, 0)
  assert.equal((r.patch.rotation ?? 0) % 15, 0)
  assert.notEqual(r.patch.rotation, 0)
})

test('resize cursors turn with the clip', () => {
  assert.equal(resizeCursor('e', 0), 'ew-resize')
  assert.equal(resizeCursor('e', Math.PI / 2), 'ns-resize')
  assert.equal(resizeCursor('se', 0), 'nwse-resize')
  assert.equal(resizeCursor('ne', 0), 'nesw-resize')
})

// -- crop on canvas ------------------------------------------------------------

const NONE: Crop = { left: 0, top: 0, right: 0, bottom: 0 }

test('dragging the east crop handle in takes that fraction of the box off the right', () => {
  // A 100×50 box at the origin: 20 units left is 20% of its width.
  const crop = cropDragResult({ layout: L(), crop: NONE, handle: 'e', pointer: { x: 100, y: 25 } }, { x: 80, y: 25 })
  assert.deepEqual(crop, { left: 0, top: 0, right: 0.2, bottom: 0 })
})

test('the west and north handles crop the left and top, and dragging back out uncrops', () => {
  const start = { left: 0.1, top: 0.2, right: 0, bottom: 0 }
  const west = cropDragResult({ layout: L(), crop: start, handle: 'w', pointer: { x: 10, y: 25 } }, { x: 30, y: 25 })
  close(west.left, 0.3, 'left')
  const north = cropDragResult({ layout: L(), crop: start, handle: 'n', pointer: { x: 50, y: 10 } }, { x: 50, y: 0 })
  close(north.top, 0, 'top, dragged back to the edge')
  // Past the box's own edge it stops at no crop, not a negative one.
  const past = cropDragResult({ layout: L(), crop: start, handle: 'n', pointer: { x: 50, y: 10 } }, { x: 50, y: -40 })
  assert.equal(past.top, 0)
})

test('a corner handle moves both of its insets', () => {
  const crop = cropDragResult({ layout: L(), crop: NONE, handle: 'se', pointer: { x: 100, y: 50 } }, { x: 90, y: 40 })
  assert.deepEqual(crop, { left: 0, top: 0, right: 0.1, bottom: 0.2 })
})

test('⇧ crops symmetrically: the opposite inset takes the same value', () => {
  const crop = cropDragResult({ layout: L(), crop: NONE, handle: 'e', pointer: { x: 100, y: 25 } }, { x: 85, y: 25 }, { symmetric: true })
  assert.deepEqual(crop, { left: 0.15, top: 0, right: 0.15, bottom: 0 })
  // And stops before the two meet, leaving the 2% normaliseCrop requires.
  const far = cropDragResult({ layout: L(), crop: NONE, handle: 'e', pointer: { x: 100, y: 25 } }, { x: -500, y: 25 }, { symmetric: true })
  assert.equal(far.left, 0.49)
  assert.equal(far.right, 0.49)
})

test('an edge dragged past its opposite stops 2% short of it, on the edge normaliseCrop does not clamp', () => {
  // normaliseCrop clamps right/bottom against left/top, never left against right — so a left
  // edge the drag did not stop would be written past the right one.
  const start = { left: 0, top: 0, right: 0.3, bottom: 0 }
  const crop = cropDragResult({ layout: L(), crop: start, handle: 'w', pointer: { x: 0, y: 25 } }, { x: 200, y: 25 })
  close(crop.left, 0.68, 'left stops at 1 − right − 2%')
  assert.equal(crop.right, 0.3)
})

test('a rotated clip crops along its own axes', () => {
  // Turned 90° clockwise, the box's +x runs down the screen: pulling the east handle *up* 10
  // units crops 10% of its 100-unit width.
  const layout = L({ rotation: 90 })
  const box = itemFrame(layout)!
  const east = handlePoint(box, 'e')
  const crop = cropDragResult({ layout, crop: NONE, handle: 'e', pointer: east }, { x: east.x, y: east.y - 10 })
  close(crop.right, 0.1, 'right')
  close(crop.top, 0, 'top untouched')
})

test('a pushed-in clip crops by the fraction of what is drawn, not of the stored box', () => {
  // scale 2: the drawn box is 200 wide, so 20 units is 10%.
  const layout = L({ scale: 2 })
  const east = handlePoint(itemFrame(layout)!, 'e')
  const crop = cropDragResult({ layout, crop: NONE, handle: 'e', pointer: east }, { x: east.x - 20, y: east.y })
  close(crop.right, 0.1, 'right')
})

test('viewer zoom: fit letterboxes into the box, a percentage is literal', () => {
  const canvas = { width: 1920, height: 1080 }
  assert.deepEqual(viewerSize('fit', canvas, { width: 1000, height: 1000 }), { width: 976, height: 549 })
  assert.deepEqual(viewerSize(0.5, canvas, { width: 10, height: 10 }), { width: 960, height: 540 })
})

test('zooming centres the viewer: 200% of 1920 in an 864-wide viewer shows the middle, not the corner', () => {
  // The measured case: scrollWidth 3840, clientWidth 864 stayed at scrollLeft 0.
  assert.equal(scrollForCentre(0.5, 3840, 864), 1488)
  // What was centred stays centred through a resize, and nothing scrolls past either end.
  const centre = centreOfScroll(1488, 3840, 864)
  assert.equal(centre, 0.5)
  assert.equal(scrollForCentre(centre, 3840, 1200), 1320)
  assert.equal(scrollForCentre(0, 3840, 864), 0)
  assert.equal(scrollForCentre(1, 3840, 864), 3840 - 864)
  // Content smaller than the viewport has nothing to scroll.
  assert.equal(scrollForCentre(0.5, 500, 864), 0)
})
