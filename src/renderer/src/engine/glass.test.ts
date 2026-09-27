/**
 * The geometry of `<glass>`'s backdrop pass: which panes a painted surface reports, where each
 * lands on the canvas, and how the rim bends. The pixel work (`paintGlassBackdrop`) needs a canvas
 * and is checked in the app; what is here is every number it is handed.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateBrf, parseBrf, type Matrix } from '@shared/brf'
import { resolveGlass } from '@shared/glass'
import { glassPatches, multiply, planGlass, refractionBands, surfaceToDevice, type GlassPatch } from './glass'

const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0]
const close = (a: number, b: number, what: string): void => assert.ok(Math.abs(a - b) < 1e-6, `${what}: ${a} ≠ ${b}`)

function scene(layers: unknown[]) {
  const parsed = parseBrf({ brf: 1, duration: 2, layers })
  assert.ok(parsed.ok, parsed.ok ? '' : JSON.stringify(parsed.faults))
  return parsed.doc
}

test('a painted surface reports each glass pane, in surface pixels, and nothing else', () => {
  const doc = scene([
    { type: 'rect', x: 0, y: 0, anchor: [0, 0], w: 50, h: 50, fill: '#fff' },
    { type: 'glass', x: 200, y: 100, anchor: [0, 0], w: 400, h: 200, radius: 20, material: 'thin' },
    { type: 'text', x: 400, y: 200, text: 'on top' },
    { type: 'group', x: 1000, y: 500, layers: [{ type: 'glass', x: 0, y: 0, anchor: [0, 0], w: 100, h: 60, material: 'ultra' }] }
  ])
  // The surface is drawn at half the layout size: base halves everything.
  const base: Matrix = [0.5, 0, 0, 0.5, 0, 0]
  const patches = glassPatches(evaluateBrf(doc, 1, 1920, 1080), base, { width: 1920, height: 1080 })
  assert.equal(patches.length, 2, 'both panes, the grouped one too, and no other layer')
  const [first, second] = patches as [GlassPatch, GlassPatch]
  assert.deepEqual(first.matrix, [0.5, 0, 0, 0.5, 100, 50])
  assert.equal(first.w, 400)
  assert.equal(first.look.blur, 6, 'thin')
  assert.deepEqual(second.matrix.slice(4), [500, 250], 'the group transform is carried')
  assert.equal(second.look.blur, 30, 'ultra')
  assert.deepEqual(first.scene, { x: 0, y: 0, w: 960, h: 540 }, 'the scene on the surface')
})

test('a letterboxed scene reports its own rectangle on the surface, for the frost to stay inside', () => {
  // A 1080×1920 design fitted into a 1920×1080 surface: scale 0.5625, centred.
  const doc = scene([{ type: 'glass', x: 0, y: 0, w: 100, h: 100 }])
  const s = 1080 / 1920
  const base: Matrix = [s, 0, 0, s, (1920 - 1080 * s) / 2, 0]
  const [only] = glassPatches(evaluateBrf(doc, 1, 1080, 1920), base, { width: 1080, height: 1920 })
  assert.ok(only)
  close(only.scene.x, (1920 - 1080 * s) / 2, 'left edge of the pillarbox')
  close(only.scene.w, 1080 * s, 'width')
  close(only.scene.h, 1080, 'height')
})

test('a pane that is fully transparent or not yet alive reports nothing', () => {
  const doc = scene([
    { type: 'glass', x: 0, y: 0, w: 10, h: 10, opacity: 0 },
    { type: 'glass', x: 0, y: 0, w: 10, h: 10, t: [1.5, 2] }
  ])
  const size = { width: 100, height: 100 }
  assert.deepEqual(glassPatches(evaluateBrf(doc, 1, 100, 100), IDENTITY, size), [])
  // Positive control: at 1.6s the second pane is alive and is reported.
  assert.equal(glassPatches(evaluateBrf(doc, 1.6, 100, 100), IDENTITY, size).length, 1)
})

test('surface → device follows drawImage: the box, the crop, then the transform in force', () => {
  // Uncropped: a 960×540 surface drawn into a 1920×1080 box at (0,0), previewed at 1/2.
  const preview: Matrix = [0.5, 0, 0, 0.5, 0, 0]
  const m = surfaceToDevice(preview, { sx: 0, sy: 0, sw: 960, sh: 540 }, { dx: 0, dy: 0, dw: 1920, dh: 1080 })!
  assert.deepEqual(m, [1, 0, 0, 1, 0, 0], 'surface pixels are device pixels when drawn at their own size')
  // Offset box: a surface pixel (0,0) lands at the box's corner, scaled by the preview.
  const moved = surfaceToDevice(preview, { sx: 0, sy: 0, sw: 960, sh: 540 }, { dx: 200, dy: 100, dw: 960, dh: 540 })!
  assert.deepEqual(moved, [0.5, 0, 0, 0.5, 100, 50])
  // Cropped: the left quarter of the surface cut away and the rest stretched over the dest.
  const cropped = surfaceToDevice(IDENTITY, { sx: 240, sy: 0, sw: 720, sh: 540 }, { dx: 0, dy: 0, dw: 1440, dh: 1080 })!
  const at = (x: number, y: number) => [cropped[0] * x + cropped[2] * y + cropped[4], cropped[1] * x + cropped[3] * y + cropped[5]]
  assert.deepEqual(at(240, 0), [0, 0], 'the crop edge is at the dest corner')
  assert.deepEqual(at(960, 540), [1440, 1080], 'the far corner at the far corner')
  assert.equal(surfaceToDevice(IDENTITY, { sx: 0, sy: 0, sw: 0, sh: 10 }, { dx: 0, dy: 0, dw: 10, dh: 10 }), null)
})

const patch = (over: Partial<GlassPatch> = {}): GlassPatch => ({
  matrix: [1, 0, 0, 1, 100, 100],
  w: 200,
  h: 100,
  radius: 16,
  wipe: 1,
  alpha: 1,
  look: resolveGlass('regular', {}),
  scene: { x: 0, y: 0, w: 1920, h: 1080 },
  ...over
})

test('a plan covers the pane plus room for the blur and the bend, clipped to the canvas', () => {
  const plan = planGlass(patch(), IDENTITY, { width: 1920, height: 1080 }, 1)!
  assert.ok(plan)
  close(plan.unit, 1, 'unit')
  close(plan.blurPx, 14, 'regular blur, at unit scale')
  const r = plan.region
  assert.ok(r.x < 100 - 28 && r.y < 100 - 28, `the region reaches 2×blur past the pane: ${JSON.stringify(r)}`)
  assert.ok(r.x + r.w > 300 + 28 && r.y + r.h > 200 + 28, 'on the far side too')
  // At the canvas edge the region stops there.
  const edge = planGlass(patch({ matrix: [1, 0, 0, 1, -50, -20] }), IDENTITY, { width: 1920, height: 1080 }, 1)!
  assert.equal(edge.region.x, 0)
  assert.equal(edge.region.y, 0)
  // Off the canvas: nothing to draw.
  assert.equal(planGlass(patch({ matrix: [1, 0, 0, 1, 5000, 5000] }), IDENTITY, { width: 1920, height: 1080 }, 1), null)
})

test('the device scale reaches the blur: a half-size preview blurs half as many pixels', () => {
  // The frost must look the same in a 960-wide preview and a 1920-wide export; a blur fixed in
  // device pixels would be twice as strong in the preview.
  const full = planGlass(patch(), IDENTITY, { width: 1920, height: 1080 }, 1)!
  const half = planGlass(patch(), [0.5, 0, 0, 0.5, 0, 0], { width: 960, height: 540 }, 1)!
  close(half.blurPx, full.blurPx / 2, 'blur scales with the device')
  // The pane itself lands at half the coordinates: (50,50)–(150,100).
  close(half.matrix[4], 50, 'x')
  close(half.matrix[0] * 200, 100, 'width')
})

test('rotation is carried in the matrix, and the region bounds the rotated pane', () => {
  const r = Math.PI / 4
  const rotate: Matrix = [Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 960, 540]
  const plan = planGlass(patch({ matrix: [1, 0, 0, 1, -100, -50] }), rotate, { width: 1920, height: 1080 }, 1)!
  close(plan.unit, 1, 'rotation does not change the scale')
  // The pane's centre maps to the rotation's origin.
  const cx = plan.matrix[0] * 100 + plan.matrix[2] * 50 + plan.matrix[4]
  const cy = plan.matrix[1] * 100 + plan.matrix[3] * 50 + plan.matrix[5]
  close(cx, 960, 'centre x')
  close(cy, 540, 'centre y')
  // A 200×100 pane at 45° spans (200+100)/√2 ≈ 212 each way.
  const span = 300 / Math.SQRT2
  assert.ok(plan.region.w > span && plan.region.h > span, `region ${plan.region.w}×${plan.region.h} bounds the rotated pane`)
})

test('opacity and wipe reach the plan; a zero alpha or zero wipe is no plan', () => {
  const plan = planGlass(patch({ alpha: 0.5 }), IDENTITY, { width: 1920, height: 1080 }, 0.5)!
  close(plan.alpha, 0.25, 'item alpha times pane alpha')
  assert.equal(planGlass(patch(), IDENTITY, { width: 1920, height: 1080 }, 0), null)
  assert.equal(planGlass(patch({ wipe: 0 }), IDENTITY, { width: 1920, height: 1080 }, 1), null)
})

test('under a wipe the pane keeps its whole shape and rim; only a plain rect clip narrows it', () => {
  // As `paintBrf` draws the tint: the full rounded pane, clipped by rect(0,0,w·wipe,h). A pane
  // narrowed to w·wipe instead would re-round its right edge and pull its rim in with the wipe.
  const canvas = { width: 1920, height: 1080 }
  const whole = planGlass(patch({ radius: 40 }), IDENTITY, canvas, 1)!
  const half = planGlass(patch({ radius: 40, wipe: 0.5 }), IDENTITY, canvas, 1)!
  assert.equal(half.w, 200, 'the whole width')
  assert.equal(half.radius, whole.radius, 'the whole radius')
  assert.deepEqual(half.bands, whole.bands, 'the whole rim')
  assert.equal(half.wipe, 0.5)
  assert.equal(whole.wipe, 1)
  // Only the revealed half is copied from the canvas.
  assert.ok(half.region.w < whole.region.w, `region ${half.region.w} narrower than ${whole.region.w}`)
})

test('the region is the pane plus the blur, and no more', () => {
  // The rim magnifies about the centre, which reads inward; it needs no extra margin.
  const plan = planGlass(patch({ look: resolveGlass('clear', { blur: 10 }) }), IDENTITY, { width: 1920, height: 1080 }, 1)!
  assert.deepEqual(plan.region, { x: 100 - 22, y: 100 - 22, w: 200 + 44, h: 100 + 44 })
})

test('the rim bends hardest at the edge, easing off inward, and not at all without refraction', () => {
  const bands = refractionBands(200, 100, { refraction: 16, bezel: 30 })
  assert.equal(bands.length, 3)
  // At the very edge the backdrop is pulled in by exactly `refraction`: d/(d − 16), d = 50.
  close(bands[0]!.scale, 50 / (50 - 16), 'edge magnification')
  assert.ok(bands[0]!.scale > bands[1]!.scale && bands[1]!.scale > bands[2]!.scale && bands[2]!.scale > 1, 'strongest outside')
  assert.equal(bands[0]!.outer, 0)
  close(bands[2]!.inner, 30, 'the bands tile the bezel')
  assert.deepEqual(refractionBands(200, 100, { refraction: 0, bezel: 30 }), [])
  assert.deepEqual(refractionBands(200, 100, { refraction: 16, bezel: 0 }), [])
  // A bezel wider than the pane stops short of the centre, so the innermost ring has an inside.
  const small = refractionBands(40, 40, { refraction: 60, bezel: 120 })
  assert.ok(small[2]!.inner < 20, `inner ${small[2]!.inner} stays inside the half side`)
  // Refraction never pulls more than half way to the centre.
  close(small[0]!.scale, 2, 'd/(d − d/2)')
})

test('the plan multiplies the pane matrix after the device transform', () => {
  // Composition order is the thing a transposed multiply gets wrong without any other symptom.
  const device: Matrix = [2, 0, 0, 2, 10, 20]
  const pane: Matrix = [1, 0, 0, 1, 5, 5]
  const plan = planGlass(patch({ matrix: pane }), device, { width: 4000, height: 4000 }, 1)!
  assert.deepEqual(plan.matrix, multiply(device, pane))
  assert.deepEqual(plan.matrix, [2, 0, 0, 2, 20, 30])
})
