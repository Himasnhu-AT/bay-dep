/**
 * The viewer's mask handles as arithmetic: where a handle is, and what a drag writes. The checks
 * are against `@shared/shape-mask`'s own coverage — a handle must sit on the edge that is drawn,
 * and a dragged mask must keep what the pointer was dragged over.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Layout } from '@shared/project'
import { checkShapeMask, shapeDistance, type PathMask, type RectMask, type ShapeMask } from '@shared/shape-mask'
import { handlePoint } from './geometry'
import {
  canvasToClip,
  clipToCanvas,
  featherHandle,
  insertPathPoint,
  maskDragResult,
  maskFrame,
  maskOutline,
  pathPointPositions,
  removePathPoint
} from './maskGeometry'

const SIZE = { width: 800, height: 450 }
const near = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) <= eps
const rect: RectMask = { kind: 'rect', x: 0.5, y: 0.5, width: 0.5, height: 0.4 }
const path: PathMask = { kind: 'path', x: 0.5, y: 0.5, width: 0.5, height: 0.4, points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] }
const legal = (mask: ShapeMask): void => {
  const checked = checkShapeMask(mask, 'mask')
  assert.ok(checked.ok, `a drag wrote a mask the validator refuses: ${!checked.ok && checked.error}`)
}

test('canvas and clip coordinates invert each other through the clip\'s position, rotation and zoom', () => {
  const layouts: Layout[] = [
    { left: 0, top: 0, width: 800, height: 450, opacity: 1, rotation: 0 },
    { left: 300, top: -120, width: 800, height: 450, opacity: 1, rotation: 0 },
    { left: 100, top: 60, width: 800, height: 450, opacity: 1, rotation: 30, scale: 1.5 },
    { left: 100, top: 60, width: 800, height: 450, opacity: 1, rotation: -90, scale: 0.5 }
  ]
  for (const layout of layouts) {
    for (const p of [{ x: 0, y: 0 }, { x: 800, y: 450 }, { x: 123, y: 400 }]) {
      const onCanvas = clipToCanvas(layout, p)!
      const back = canvasToClip(layout, onCanvas)!
      assert.ok(near(back.x, p.x, 1e-9) && near(back.y, p.y, 1e-9), JSON.stringify({ layout, p, back }))
    }
  }
  // Unrotated and unzoomed, the clip's top-left is the layout's.
  assert.deepEqual(clipToCanvas(layouts[1]!, { x: 0, y: 0 }), { x: 300, y: -120 })
  // Zoomed 1.5× about its centre (500, 285): the centre stays, a point 100 px right of it lands 150 px right.
  const c = clipToCanvas({ ...layouts[2]!, rotation: 0 }, { x: 500, y: 225 })!
  assert.ok(near(c.x, 500 + 150) && near(c.y, 285))
  assert.equal(canvasToClip({ ...layouts[0]!, width: 0 }, { x: 1, y: 1 }), null, 'a clip that draws nothing has no clip space')
})

test('every handle and every outline point sits on the edge the coverage function draws', () => {
  const masks: ShapeMask[] = [
    rect,
    { ...rect, rotation: 37, radius: 0.6 },
    { kind: 'ellipse', x: 0.3, y: 0.6, width: 0.4, height: 0.7, rotation: -20 },
    { ...path, rotation: 15 }
  ]
  for (const mask of masks) {
    for (const p of maskOutline(mask, SIZE)) {
      assert.ok(Math.abs(shapeDistance(mask, p.x, p.y, SIZE)) < 0.05, `${mask.kind}: an outline point ${shapeDistance(mask, p.x, p.y, SIZE)} px off the edge`)
    }
  }
  // The side handles of a rectangle are on its edge; of an ellipse, on its curve.
  for (const mask of [masks[0]!, masks[2]!]) {
    const frame = maskFrame(mask, SIZE)
    for (const handle of ['n', 'e', 's', 'w'] as const) {
      const at = handlePoint(frame, handle)
      assert.ok(Math.abs(shapeDistance(mask, at.x, at.y, SIZE)) < 1e-6, `${mask.kind} ${handle}`)
    }
  }
  // A path's points are where its outline turns.
  for (const p of pathPointPositions(path, SIZE)) assert.ok(Math.abs(shapeDistance(path, p.x, p.y, SIZE)) < 1e-9)
})

test('the feather handle sits at the outer end of the soft edge, and dragging it sets the feather it then sits at', () => {
  const soft: RectMask = { ...rect, feather: 40, rotation: 25 }
  const at = featherHandle(soft, SIZE, 10)
  // 10 px of padding beyond the ramp's outer end, which is half the feather outside the edge.
  assert.ok(near(shapeDistance(soft, at.x, at.y, SIZE), 20 + 10, 1e-6))
  // Drag it 30 px further out along the mask's own axis: the ramp's outer end follows, so 60 px more feather.
  const dir = { x: Math.cos((25 * Math.PI) / 180), y: Math.sin((25 * Math.PI) / 180) }
  const dragged = maskDragResult({ mode: { kind: 'feather', pad: 10 }, mask: soft, size: SIZE, pointer: at }, { x: at.x + dir.x * 30, y: at.y + dir.y * 30 })
  assert.equal(dragged.feather, 100)
  const now = featherHandle(dragged, SIZE, 10)
  assert.ok(near(now.x, at.x + dir.x * 30, 1e-6) && near(now.y, at.y + dir.y * 30, 1e-6), 'the handle is under the pointer')
  // Dragged inside the edge it stops at no feather, stored as absence.
  const none = maskDragResult({ mode: { kind: 'feather', pad: 10 }, mask: soft, size: SIZE, pointer: at }, { x: 400, y: 225 })
  assert.equal('feather' in none, false)
  legal(dragged)
  legal(none)
})

test('a move shifts the centre by the pointer\'s travel, in fractions of the clip; ⇧ holds one axis', () => {
  const start = { mode: { kind: 'move' as const }, mask: rect, size: SIZE, pointer: { x: 400, y: 225 } }
  const moved = maskDragResult(start, { x: 480, y: 180 })
  assert.equal(moved.x, 0.6)
  assert.equal(moved.y, 0.4)
  assert.equal(moved.width, rect.width)
  const held = maskDragResult(start, { x: 480, y: 180 }, { shift: true, alt: false })
  assert.equal(held.x, 0.6)
  assert.equal(held.y, 0.5)
  // Dragged absurdly far it stops at the range the validator accepts.
  legal(maskDragResult(start, { x: 1e7, y: -1e7 }))
})

test('a resize keeps the opposite edge where it was, along the mask\'s own axes', () => {
  for (const rotation of [0, 40]) {
    const mask: RectMask = { ...rect, ...(rotation ? { rotation } : {}) }
    const frame = maskFrame(mask, SIZE)
    const east = handlePoint(frame, 'e')
    const west = handlePoint(frame, 'w')
    const axis = { x: Math.cos((rotation * Math.PI) / 180), y: Math.sin((rotation * Math.PI) / 180) }
    const next = maskDragResult({ mode: { kind: 'resize', handle: 'e' }, mask, size: SIZE, pointer: east }, { x: east.x + axis.x * 100, y: east.y + axis.y * 100 })
    const after = maskFrame(next, SIZE)
    const westAfter = handlePoint(after, 'w')
    assert.ok(Math.hypot(westAfter.x - west.x, westAfter.y - west.y) < 0.1, `rotation ${rotation}: the west edge moved`)
    assert.ok(near(after.halfW * 2, frame.halfW * 2 + 100, 0.1), `rotation ${rotation}: 100 px wider`)
    assert.ok(near(after.halfH, frame.halfH, 0.1), 'the height is untouched')
    legal(next)
  }
  // ⌥ resizes about the centre: both edges move, the centre does not.
  const frame = maskFrame(rect, SIZE)
  const east = handlePoint(frame, 'e')
  const centred = maskDragResult({ mode: { kind: 'resize', handle: 'e' }, mask: rect, size: SIZE, pointer: east }, { x: east.x + 50, y: east.y }, { shift: false, alt: true })
  assert.equal(centred.x, rect.x)
  assert.ok(near(centred.width * SIZE.width, rect.width * SIZE.width + 100, 0.1))
})

test('a rotate turns the mask by the angle the pointer swept about its centre; ⇧ steps by 15°', () => {
  const centre = { x: 400, y: 225 }
  const start = { mode: { kind: 'rotate' as const }, mask: rect, size: SIZE, pointer: { x: centre.x, y: centre.y - 100 } }
  const quarter = maskDragResult(start, { x: centre.x + 100, y: centre.y })
  assert.equal(quarter.rotation, 90)
  const snapped = maskDragResult(start, { x: centre.x + 100, y: centre.y - 80 }, { shift: true, alt: false })
  assert.equal((snapped.rotation ?? 0) % 15, 0)
  // Back to upright is stored as absence.
  const upright = maskDragResult({ ...start, mask: { ...rect, rotation: 90 }, pointer: { x: centre.x + 100, y: centre.y } }, { x: centre.x, y: centre.y - 100 })
  assert.equal('rotation' in upright, false)
})

test('dragging a path point moves that point alone, to where the pointer is', () => {
  const turned: PathMask = { ...path, rotation: 30 }
  const at = pathPointPositions(turned, SIZE)
  const target = { x: at[2]!.x + 37, y: at[2]!.y - 21 }
  const next = maskDragResult({ mode: { kind: 'point', index: 2 }, mask: turned, size: SIZE, pointer: at[2]! }, target) as PathMask
  const after = pathPointPositions(next, SIZE)
  assert.ok(Math.hypot(after[2]!.x - target.x, after[2]!.y - target.y) < 0.05, 'the point is under the pointer')
  for (const i of [0, 1, 3]) assert.deepEqual(next.points[i], turned.points[i])
  legal(next)
  // A point index the path does not have changes nothing.
  assert.equal(maskDragResult({ mode: { kind: 'point', index: 9 }, mask: turned, size: SIZE, pointer: at[2]! }, target), turned)
})

test('a point is inserted on the side that was clicked, and removed down to three and no further', () => {
  // The right-hand side of the square runs from point 1 to point 2; click near its middle.
  const right = pathPointPositions(path, SIZE)
  const click = { x: right[1]!.x + 3, y: (right[1]!.y + right[2]!.y) / 2 }
  const inserted = insertPathPoint(path, SIZE, click)!
  assert.equal(inserted.index, 2)
  assert.equal(inserted.mask.points.length, 5)
  assert.deepEqual(inserted.mask.points.slice(0, 2), path.points.slice(0, 2))
  assert.deepEqual(inserted.mask.points.slice(3), path.points.slice(2))
  const where = pathPointPositions(inserted.mask, SIZE)[2]!
  assert.ok(Math.hypot(where.x - click.x, where.y - click.y) < 0.05)
  legal(inserted.mask)

  const four = removePathPoint(inserted.mask, 2)!
  assert.deepEqual(four.points, path.points)
  const three = removePathPoint(four, 0)!
  assert.equal(three.points.length, 3)
  assert.equal(removePathPoint(three, 0), null, 'a path needs three points')
  assert.equal(removePathPoint(four, 7), null)
  // At the point limit nothing more is added.
  const full: PathMask = { ...path, points: Array.from({ length: 64 }, (_, i) => ({ x: (i % 8) / 8, y: Math.floor(i / 8) / 8 })) }
  assert.equal(insertPathPoint(full, SIZE, click), null)
})
