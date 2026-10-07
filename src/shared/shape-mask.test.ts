/**
 * Shape masks as numbers: how much of a point each shape keeps, how the feather falls, what
 * invert and the combine modes do, and that the grid the compositor draws from is that same
 * function at every pixel.
 *
 * The assertions are the requirement — inside is kept, outside is not, the soft edge is as wide
 * as it says and never rises on the way out — written against geometry worked out by hand or by
 * brute force, never against the implementation's own formula.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  checkShapeMask,
  combineCoverage,
  defaultShapeMask,
  flattenPath,
  framePointToMask,
  initialCoverage,
  maskPointToFrame,
  masksCoverage,
  MAX_PATH_POINTS,
  MAX_SHAPE_FEATHER,
  rampCoverage,
  rasterMasks,
  shapeCoverage,
  shapeDistance,
  type EllipseMask,
  type PathMask,
  type RectMask,
  type ShapeMask
} from './shape-mask'

/** A 16:9 clip: not square, so anything that confuses the two axes shows. */
const FRAME = { width: 1600, height: 900 }
const near = (a: number, b: number, eps = 1e-6): boolean => Math.abs(a - b) <= eps

const rect = (extra: Partial<RectMask> = {}): RectMask => ({ kind: 'rect', x: 0.5, y: 0.5, width: 0.5, height: 0.4, ...extra })
const ellipse = (extra: Partial<EllipseMask> = {}): EllipseMask => ({ kind: 'ellipse', x: 0.5, y: 0.5, width: 0.5, height: 0.4, ...extra })
/** A right triangle filling the lower-left half of its box. */
const triangle = (extra: Partial<PathMask> = {}): PathMask => ({
  kind: 'path', x: 0.5, y: 0.5, width: 0.5, height: 0.4, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }], ...extra
})

// -- inside and outside, per shape ----------------------------------------------------------------

test('a rectangle keeps what is inside it and nothing outside, on a frame that is not square', () => {
  // 0.5 × 0.4 of 1600 × 900 centred: x 400..1200, y 270..630.
  const m = rect()
  assert.equal(shapeCoverage(m, 800, 450, FRAME), 1)
  assert.equal(shapeCoverage(m, 401, 271, FRAME), 1)
  assert.equal(shapeCoverage(m, 1199, 629, FRAME), 1)
  assert.equal(shapeCoverage(m, 399, 450, FRAME), 0)
  assert.equal(shapeCoverage(m, 800, 631, FRAME), 0)
  assert.equal(shapeCoverage(m, 1201, 629, FRAME), 0)
  // The distance is in pixels of the frame: 100 px left of the left edge, 50 px inside the top.
  assert.ok(near(shapeDistance(m, 300, 450, FRAME), 100))
  assert.ok(near(shapeDistance(m, 800, 320, FRAME), -50))
  // Diagonally off a corner it is the straight-line distance to the corner.
  assert.ok(near(shapeDistance(m, 400 - 30, 270 - 40, FRAME), 50))
})

test('a corner radius rounds the corner and leaves the sides alone', () => {
  // Half the shorter side is 180 px; radius 0.5 is a 90 px corner.
  const square = rect()
  const round = rect({ radius: 0.5 })
  // Just inside the sharp corner: kept by the square, outside the rounded one.
  assert.equal(shapeCoverage(square, 405, 275, FRAME), 1)
  assert.equal(shapeCoverage(round, 405, 275, FRAME), 0)
  // The corner arc's centre is (490, 360): 90 px from it along the diagonal is on the edge.
  const onArc = { x: 490 - 90 * Math.SQRT1_2, y: 360 - 90 * Math.SQRT1_2 }
  assert.ok(near(shapeDistance(round, onArc.x, onArc.y, FRAME), 0, 1e-9))
  // Mid-side is unchanged.
  assert.ok(near(shapeDistance(round, 300, 450, FRAME), shapeDistance(square, 300, 450, FRAME)))
  // Fully round: the short side is a half-circle of radius 180 about (580, 450).
  const pill = rect({ radius: 1 })
  assert.ok(near(shapeDistance(pill, 400, 450, FRAME), 0, 1e-9))
  assert.ok(near(shapeDistance(pill, 580 - 180 * Math.SQRT1_2, 450 - 180 * Math.SQRT1_2, FRAME), 0, 1e-9))
})

test('an ellipse keeps its inside, and its distance is the true distance to the curve', () => {
  // Semi-axes 400 × 180 about (800, 450).
  const m = ellipse()
  assert.equal(shapeCoverage(m, 800, 450, FRAME), 1)
  assert.equal(shapeCoverage(m, 1199, 450, FRAME), 1)
  assert.equal(shapeCoverage(m, 1201, 450, FRAME), 0)
  assert.equal(shapeCoverage(m, 800, 631, FRAME), 0)
  // The box's corner is inside a rectangle of the same box and outside the ellipse.
  assert.equal(shapeCoverage(m, 410, 280, FRAME), 0)
  assert.equal(shapeCoverage(rect(), 410, 280, FRAME), 1)

  // Against a dense search of the outline, at points inside, outside and far away. A formula that
  // only scales the unit circle's distance is out by tens of pixels on a 400 × 180 ellipse.
  const brute = (px: number, py: number): number => {
    let best = Number.POSITIVE_INFINITY
    for (let i = 0; i < 200_000; i += 1) {
      const a = (i / 200_000) * Math.PI * 2
      best = Math.min(best, Math.hypot(px - (800 + 400 * Math.cos(a)), py - (450 + 180 * Math.sin(a))))
    }
    const inside = ((px - 800) / 400) ** 2 + ((py - 450) / 180) ** 2 < 1
    return inside ? -best : best
  }
  for (const [px, py] of [[800, 450], [1000, 500], [1150, 470], [1300, 450], [800, 700], [1100, 650], [450, 300], [820, 300], [1195, 452], [100, 100]] as const) {
    const got = shapeDistance(m, px, py, FRAME)
    assert.ok(Math.abs(got - brute(px, py)) < 0.02, `(${px}, ${py}): ${got} against ${brute(px, py)}`)
  }
  // And the naive answer is measurably wrong where this one is right — the specimen can tell them apart.
  const naive = (Math.hypot((1100 - 800) / 400, (650 - 450) / 180) - 1) * 180
  assert.ok(Math.abs(naive - brute(1100, 650)) > 5)
})

test('a path keeps the inside of its outline: straight sides, and a curved one', () => {
  // The triangle's box is x 400..1200, y 270..630; its corners (400,270), (1200,630), (400,630).
  const m = triangle()
  assert.equal(shapeCoverage(m, 500, 600, FRAME), 1)
  assert.equal(shapeCoverage(m, 1100, 300, FRAME), 0, 'the upper-right half of the box is outside')
  assert.equal(shapeCoverage(m, 390, 450, FRAME), 0)
  // Distance to the long side from the box's top-right corner: the triangle's height from there.
  const hyp = Math.hypot(800, 360)
  assert.ok(near(shapeDistance(m, 1200, 270, FRAME), (800 * 360) / hyp, 1e-6))

  // A handle bows a side outward: the point just beyond the straight side is then inside.
  const bowed: PathMask = { ...m, points: [{ x: 0, y: 0, outX: 0.6, outY: 0 }, { x: 1, y: 1, inX: 0, inY: -0.6 }, { x: 0, y: 1 }] }
  assert.equal(shapeCoverage(m, 900, 440, FRAME), 0)
  assert.equal(shapeCoverage(bowed, 900, 440, FRAME), 1)
  // A segment with no handles stays a single straight piece; a curved one is subdivided.
  assert.equal(flattenPath(m.points, 100, 100).length, 3 * 2)
  assert.ok(flattenPath(bowed.points, 100, 100).length > 3 * 2)
})

test('rotation turns the shape about its own centre, in pixels', () => {
  // A wide rectangle turned a quarter is tall: 800 × 360 becomes 360 × 800 on screen.
  const m = rect({ rotation: 90 })
  assert.equal(shapeCoverage(m, 800, 450 + 390, FRAME), 1)
  assert.equal(shapeCoverage(m, 800 + 390, 450, FRAME), 0)
  // 45°: the corner that was at (+400, −180) from the centre is where the rotation puts it.
  const turned = rect({ rotation: 45 })
  const c = Math.SQRT1_2
  const corner = { x: 800 + 400 * c + 180 * c, y: 450 + 400 * c - 180 * c }
  assert.ok(near(shapeDistance(turned, corner.x, corner.y, FRAME), 0, 1e-9))
  // The handle geometry agrees with the distance: a box corner maps onto the edge, and back.
  const p = maskPointToFrame(turned, 1, 0, FRAME)
  assert.ok(near(p.x, corner.x, 1e-9) && near(p.y, corner.y, 1e-9))
  const back = framePointToMask(turned, p.x, p.y, FRAME)
  assert.ok(near(back.u, 1, 1e-9) && near(back.v, 0, 1e-9))
})

// -- the feather ----------------------------------------------------------------------------------

test('the feather is a ramp of the stated width, centred on the edge, and never rises on the way out', () => {
  for (const feather of [10, 60, 200]) {
    for (const m of [rect({ feather }), ellipse({ feather }), triangle({ feather })] as ShapeMask[]) {
      // Walk out of the shape along a line on which the distance to the edge is the distance
      // walked, in tenth-pixel steps. Rect: straight out of its right side. Triangle: out of its
      // left side. Ellipse: out of its bottom, along the short axis — along the long axis the
      // nearest edge of a 400 × 180 ellipse is off to the side once you are 81 px in, so the walk
      // there is not a walk away from the edge.
      const at = (d: number): number =>
        m.kind === 'rect' ? shapeCoverage(m, 1200 + d, 450, FRAME) : m.kind === 'path' ? shapeCoverage(m, 400 - d, 520, FRAME) : shapeCoverage(m, 800, 630 + d, FRAME)
      assert.equal(at(-feather / 2 - 0.5), 1, `${m.kind} feather ${feather}: fully kept half a feather inside`)
      assert.equal(at(feather / 2 + 0.5), 0, `${m.kind} feather ${feather}: nothing half a feather outside`)
      assert.ok(near(at(0), 0.5, 1e-6), `${m.kind} feather ${feather}: half on the edge`)
      // Strictly between 0 and 1 just inside both ends: the ramp really is that wide, not narrower.
      assert.ok(at(-feather / 2 + 0.5) < 1 && at(-feather / 2 + 0.5) > 0.99)
      assert.ok(at(feather / 2 - 0.5) > 0 && at(feather / 2 - 0.5) < 0.01)
      let previous = 1
      let first = Number.NaN
      let last = Number.NaN
      for (let d = -feather; d <= feather; d += 0.1) {
        const c = at(d)
        assert.ok(c <= previous + 1e-12, `${m.kind} feather ${feather}: coverage rose at ${d}`)
        if (c < 1 && Number.isNaN(first)) first = d
        if (c > 0) last = d
        previous = c
      }
      // Measured: where it leaves 1 to where it reaches 0.
      assert.ok(Math.abs(last - first - feather) <= 0.25, `${m.kind}: measured ramp ${last - first}, stated ${feather}`)
    }
  }
})

test('no feather is a hard edge; an output pixel of antialiasing is the only ramp', () => {
  const m = rect()
  assert.equal(shapeCoverage(m, 1199.99, 450, FRAME), 1)
  assert.equal(shapeCoverage(m, 1200.01, 450, FRAME), 0)
  // With a pixel 2 frame-pixels wide (a half-size preview), the edge spans exactly that pixel.
  assert.ok(near(shapeCoverage(m, 1200, 450, FRAME, 2), 0.5))
  assert.equal(shapeCoverage(m, 1198.9, 450, FRAME, 2), 1)
  assert.equal(shapeCoverage(m, 1201.1, 450, FRAME, 2), 0)
  // A feather wider than a pixel is not narrowed or widened by the antialiasing.
  assert.equal(shapeCoverage(rect({ feather: 40 }), 1215, 450, FRAME, 2), shapeCoverage(rect({ feather: 40 }), 1215, 450, FRAME))
})

test('rampCoverage: the ends are exact, the middle is half, and it is symmetric', () => {
  assert.equal(rampCoverage(-5, 10), 1)
  assert.equal(rampCoverage(5, 10), 0)
  assert.equal(rampCoverage(0, 10), 0.5)
  for (const d of [0.5, 1, 2.5, 4, 4.9]) assert.ok(near(rampCoverage(d, 10) + rampCoverage(-d, 10), 1, 1e-12))
  assert.equal(rampCoverage(-0.001, 0), 1)
  assert.equal(rampCoverage(0.001, 0), 0)
})

// -- invert, opacity, combine --------------------------------------------------------------------

test('invert is the exact complement, at every point of the ramp', () => {
  for (const base of [rect({ feather: 80 }), ellipse({ feather: 80, rotation: 30 }), triangle({ feather: 80 })] as ShapeMask[]) {
    const inverted = { ...base, invert: true } as ShapeMask
    let partial = 0
    for (let x = 300; x <= 1300; x += 37) {
      for (let y = 200; y <= 700; y += 29) {
        const a = shapeCoverage(base, x, y, FRAME)
        const b = shapeCoverage(inverted, x, y, FRAME)
        assert.ok(near(a + b, 1, 1e-12), `${base.kind} at (${x}, ${y}): ${a} + ${b}`)
        if (a > 0 && a < 1) partial += 1
      }
    }
    assert.ok(partial > 10, 'the sample must cross the soft edge, or the complement was only tested at 0 and 1')
  }
})

test('opacity scales what a mask keeps', () => {
  assert.equal(shapeCoverage(rect({ opacity: 0.25 }), 800, 450, FRAME), 0.25)
  assert.equal(shapeCoverage(rect({ opacity: 0.25 }), 100, 100, FRAME), 0)
  // Inverted at 25%: the outside is kept at 25%, the inside not at all.
  assert.equal(shapeCoverage(rect({ opacity: 0.25, invert: true }), 100, 100, FRAME), 0.25)
  assert.equal(shapeCoverage(rect({ opacity: 0.25, invert: true }), 800, 450, FRAME), 0)
})

test('add, subtract and intersect on two overlapping shapes, in list order', () => {
  // Two 400 px squares-ish: A covers x 200..600, B covers x 400..800; both y 250..650.
  const a = rect({ x: 0.25, y: 0.5, width: 0.25, height: 400 / 900 })
  const b = rect({ x: 0.375, y: 0.5, width: 0.25, height: 400 / 900 })
  const onlyA = [300, 450] as const
  const both = [500, 450] as const
  const onlyB = [700, 450] as const
  const neither = [1000, 450] as const
  const at = (masks: ShapeMask[], p: readonly [number, number]): number => masksCoverage(masks, p[0], p[1], FRAME)

  const added = [a, { ...b, combine: 'add' as const }]
  assert.deepEqual([onlyA, both, onlyB, neither].map((p) => at(added, p)), [1, 1, 1, 0])
  assert.deepEqual([onlyA, both, onlyB, neither].map((p) => at([a, b], p)), [1, 1, 1, 0], 'add is the default')

  const subtracted = [a, { ...b, combine: 'subtract' as const }]
  assert.deepEqual([onlyA, both, onlyB, neither].map((p) => at(subtracted, p)), [1, 0, 0, 0])

  const intersected = [a, { ...b, combine: 'intersect' as const }]
  assert.deepEqual([onlyA, both, onlyB, neither].map((p) => at(intersected, p)), [0, 1, 0, 0])

  // Order matters: (A − B) + C is not A − (B + C). C sits over the part B removed.
  const c = rect({ x: 0.3125, y: 0.5, width: 0.05, height: 0.1 })
  assert.equal(at([a, { ...b, combine: 'subtract' }, c], both), 1)
  assert.equal(at([a, c, { ...b, combine: 'subtract' }], both), 0)

  // A lone subtract cuts a hole in everything; a lone intersect is the shape; no masks keep all.
  assert.deepEqual([onlyA, neither].map((p) => at([{ ...a, combine: 'subtract' }], p)), [0, 1])
  assert.deepEqual([onlyA, neither].map((p) => at([{ ...a, combine: 'intersect' }], p)), [1, 0])
  assert.equal(at([], neither), 1)
  assert.equal(initialCoverage([a]), 0)
  assert.equal(initialCoverage([{ ...a, combine: 'subtract' }]), 1)
})

test('combining soft edges stays between 0 and 1 and agrees with sets at the corners', () => {
  for (const mode of ['add', 'subtract', 'intersect'] as const) {
    for (let acc = 0; acc <= 1; acc += 0.125) {
      for (let c = 0; c <= 1; c += 0.125) {
        const out = combineCoverage(acc, c, mode)
        assert.ok(out >= 0 && out <= 1, `${mode}(${acc}, ${c}) = ${out}`)
      }
    }
  }
  assert.equal(combineCoverage(0.5, 0.5, 'add'), 0.75)
  assert.equal(combineCoverage(0.5, 0.5, 'subtract'), 0.25)
  assert.equal(combineCoverage(0.5, 0.5, 'intersect'), 0.25)
  assert.equal(combineCoverage(0.5, 0.5, undefined), 0.75)
})

// -- the grid the compositor draws from ----------------------------------------------------------

test('rasterMasks is masksCoverage at every pixel centre — the picture is the measured function', () => {
  const masks: ShapeMask[] = [
    ellipse({ feather: 30, rotation: 20 }),
    rect({ x: 0.3, y: 0.4, width: 0.3, height: 0.5, radius: 0.4, combine: 'subtract', feather: 12 }),
    triangle({ x: 0.7, y: 0.6, combine: 'add', opacity: 0.6 })
  ]
  // A 160 × 90 picture of the whole 1600 × 900 frame: each pixel is 10 frame pixels.
  const view = { width: 160, height: 90, originX: 0, originY: 0, stepX: 10, stepY: 10 }
  const grid = rasterMasks(masks, FRAME, view)
  assert.equal(grid.length, 160 * 90)
  let partial = 0
  for (let j = 0; j < 90; j += 1) {
    for (let i = 0; i < 160; i += 1) {
      const want = masksCoverage(masks, (i + 0.5) * 10, (j + 0.5) * 10, FRAME, 10) * 255
      const got = grid[j * 160 + i]!
      assert.ok(Math.abs(got - want) <= 0.5 + 1e-9, `pixel (${i}, ${j}): ${got} against ${want}`)
      if (got > 0 && got < 255) partial += 1
    }
  }
  assert.ok(partial > 100, 'the grid must hold soft pixels, or only 0 and 255 were compared')
})

test('settling whole squares at once changes no pixel', () => {
  const cases: ShapeMask[][] = [
    // Off the pixel grid, so its hard edge passes through pixels rather than between them.
    [rect({ x: 0.5007, y: 0.5011 })],
    [ellipse({ feather: 90 })],
    [triangle({ feather: 5, rotation: 33 })],
    [rect({ invert: true, feather: 20 }), ellipse({ x: 0.2, y: 0.2, width: 0.2, height: 0.3, combine: 'intersect' })],
    [ellipse({ width: 0.9, height: 0.05, rotation: 70, feather: 3 })]
  ]
  for (const masks of cases) {
    for (const view of [
      { width: 320, height: 180, originX: 0, originY: 0, stepX: 5, stepY: 5 },
      // A crop and a zoom: a window on the middle of the frame, at more than one pixel per frame pixel.
      { width: 301, height: 173, originX: 500, originY: 300, stepX: 0.5, stepY: 0.5 }
    ]) {
      const fast = rasterMasks(masks, FRAME, view)
      const exact = rasterMasks(masks, FRAME, view, { exact: true })
      let differing = 0
      for (let i = 0; i < fast.length; i += 1) if (fast[i] !== exact[i]) differing += 1
      assert.equal(differing, 0, `${masks.map((m) => m.kind).join('+')} at step ${view.stepX}`)
      // The whole-frame view must hold kept, removed and soft pixels, or settled squares were all there was to compare.
      if (view.originX === 0) {
        assert.ok(exact.some((v) => v === 255) && exact.some((v) => v === 0) && exact.some((v) => v > 0 && v < 255), `${masks.map((m) => m.kind).join('+')}: a specimen with nothing to get wrong`)
      }
    }
  }
})

test('a view of part of the frame shows that part: a crop moves the window, not the mask', () => {
  const m = rect()
  // The right-hand 60% of the frame (a 40% left crop), at one output pixel per frame pixel.
  const grid = rasterMasks([m], FRAME, { width: 960, height: 900, originX: 640, originY: 0, stepX: 1, stepY: 1 })
  // The mask's right edge is frame x = 1200, which is column 560 of this window.
  assert.equal(grid[450 * 960 + 558], 255)
  assert.equal(grid[450 * 960 + 561], 0)
  // Its left edge (frame x = 400) is outside the window: the first column is already inside.
  assert.equal(grid[450 * 960 + 0], 255)
  // Twice the output resolution (a zoom): the same frame point is at twice the column.
  const zoomed = rasterMasks([m], FRAME, { width: 1920, height: 1800, originX: 640, originY: 0, stepX: 0.5, stepY: 0.5 })
  assert.equal(zoomed[900 * 1920 + 1117], 255)
  assert.equal(zoomed[900 * 1920 + 1122], 0)
})

test('no masks keep every pixel', () => {
  assert.ok(rasterMasks([], FRAME, { width: 8, height: 4, originX: 0, originY: 0, stepX: 1, stepY: 1 }).every((v) => v === 255))
})

// -- validation ----------------------------------------------------------------------------------

test('a well-formed mask of each kind is accepted, and defaults are stored as absence', () => {
  const r = checkShapeMask({ kind: 'rect', x: 0.5, y: 0.5, width: 0.4, height: 0.4, radius: 0, rotation: 0, feather: 0, invert: false, opacity: 1, combine: 'add' }, 'masks[0]')
  assert.deepEqual(r, { ok: true, value: { kind: 'rect', x: 0.5, y: 0.5, width: 0.4, height: 0.4 } })
  const full = { kind: 'rect', x: 0.2, y: 0.8, width: 0.4, height: 0.3, radius: 0.5, rotation: -12, feather: 30, invert: true, opacity: 0.5, combine: 'subtract' }
  assert.deepEqual(checkShapeMask(full, 'masks[0]'), { ok: true, value: full })
  assert.ok(checkShapeMask({ kind: 'ellipse', x: 0.5, y: 0.5, width: 1, height: 1 }, 'masks[0]').ok)
  const path = { kind: 'path', x: 0.5, y: 0.5, width: 1, height: 1, points: [{ x: 0, y: 0, outX: 0.2, outY: 0 }, { x: 1, y: 0 }, { x: 0.5, y: 1, inX: 0, inY: 0 }] }
  const checked = checkShapeMask(path, 'masks[2]')
  assert.ok(checked.ok)
  assert.deepEqual(checked.ok && (checked.value as PathMask).points[2], { x: 0.5, y: 1 }, 'a zero handle is no handle')
  for (const kind of ['rect', 'ellipse', 'path'] as const) assert.ok(checkShapeMask(defaultShapeMask(kind), 'm').ok, `the default ${kind} must be legal`)
})

test('a bad field is refused by name, with its legal range — beside the nearest value that passes', () => {
  const base = { kind: 'rect', x: 0.5, y: 0.5, width: 0.4, height: 0.4 }
  const refused = (extra: Record<string, unknown>, ...needles: string[]): void => {
    const result = checkShapeMask({ ...base, ...extra }, 'masks[1]')
    assert.equal(result.ok, false, JSON.stringify(extra))
    for (const needle of needles) assert.ok(!result.ok && result.error.includes(needle), `${JSON.stringify(extra)} → ${!result.ok && result.error} lacks "${needle}"`)
  }
  const accepted = (extra: Record<string, unknown>): void => {
    const result = checkShapeMask({ ...base, ...extra }, 'masks[1]')
    assert.ok(result.ok, `${JSON.stringify(extra)}: ${!result.ok && result.error}`)
  }
  refused({ feather: MAX_SHAPE_FEATHER + 1 }, 'masks[1].feather', '0 to 1000', '1001')
  accepted({ feather: MAX_SHAPE_FEATHER })
  refused({ feather: -1 }, 'masks[1].feather')
  accepted({ feather: 0 })
  refused({ opacity: 1.5 }, 'masks[1].opacity', '0 to 1', '1.5')
  accepted({ opacity: 1 })
  refused({ radius: 2 }, 'masks[1].radius', '0', '1')
  accepted({ radius: 1 })
  refused({ width: 0 }, 'masks[1].width', '0.001 to 8')
  accepted({ width: 0.001 })
  refused({ x: 'left' }, 'masks[1].x', '-2 to 3', '"left"')
  accepted({ x: -2 })
  refused({ rotation: 1e9 }, 'masks[1].rotation', '-3600 to 3600')
  accepted({ rotation: 3600 })
  refused({ combine: 'xor' }, 'masks[1].combine', '"add", "subtract" or "intersect"', '"xor"')
  accepted({ combine: 'intersect' })
  refused({ invert: 'yes' }, 'masks[1].invert', 'true or false')
  accepted({ invert: true })
  refused({ blur: 3 }, 'no field "blur"', 'feather')
  refused({ kind: 'star' }, 'masks[1].kind', '"rect", "ellipse", "path"', '"star"')
  refused({ height: Number.NaN }, 'masks[1].height')
  // A rectangle has no points; a path has no radius.
  refused({ points: [] }, 'no field "points"')
  assert.equal(checkShapeMask({ ...base, kind: 'path', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }], radius: 0.2 }, 'm').ok, false)
})

test('a path is refused for too few or too many points, or a point out of range — and passes at the limits', () => {
  const base = { kind: 'path', x: 0.5, y: 0.5, width: 0.4, height: 0.4 }
  const two = checkShapeMask({ ...base, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }, 'masks[0]')
  assert.ok(!two.ok && two.error.includes('masks[0].points') && two.error.includes('3 to 64') && two.error.includes('2 points'))
  assert.ok(checkShapeMask({ ...base, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] }, 'masks[0]').ok)
  const many = Array.from({ length: MAX_PATH_POINTS + 1 }, (_, i) => ({ x: (i % 8) / 8, y: Math.floor(i / 8) / 9 }))
  assert.equal(checkShapeMask({ ...base, points: many }, 'masks[0]').ok, false)
  assert.ok(checkShapeMask({ ...base, points: many.slice(0, MAX_PATH_POINTS) }, 'masks[0]').ok)
  const far = checkShapeMask({ ...base, points: [{ x: 0, y: 0 }, { x: 99, y: 1 }, { x: 0, y: 1 }] }, 'masks[0]')
  assert.ok(!far.ok && far.error.includes('masks[0].points[1].x') && far.error.includes('-4 to 5'))
  const handle = checkShapeMask({ ...base, points: [{ x: 0, y: 0, outX: 'big' }, { x: 1, y: 1 }, { x: 0, y: 1 }] }, 'masks[0]')
  assert.ok(!handle.ok && handle.error.includes('masks[0].points[0].outX') && handle.error.includes('-4 to 4'))
  assert.equal(checkShapeMask({ ...base }, 'masks[0]').ok, false, 'a path with no points')
})
