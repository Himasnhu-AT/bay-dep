/**
 * Adjustment layers through the compositor, on pixels (`softCanvas.testkit`).
 *
 * The requirement, from the audit's own check: a look put on an adjustment layer must give the
 * frame the same look put **directly** on the clip under it gives — and it must reach everything
 * under the layer, nothing above it, only inside its span and its masks, as strongly as its
 * opacity says. Each case draws the scene both ways, or with and without the layer, and compares
 * colours.
 *
 * The looks here are CSS adjustments (`invert`, `brightness`), which the software canvas can
 * apply. The grade is a WebGL pass and cannot run under Node: a graded layer goes through the same
 * `#drawSource` call these tests exercise, and is measured in the app by `test/app/shape-mask.mjs`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TRANSPARENT_BACKGROUND, type Asset, type Item, type Project, type Timeline, type Track } from '@shared/project'
import { adjustmentAsset } from '@shared/adjustment-layer'
import { masksCoverage, type ShapeMask } from '@shared/shape-mask'
import type { Mask } from '@shared/matte'
import { FakePool, installCanvasGlobals, SoftCanvas, type Rgba } from './softCanvas.testkit'

installCanvasGlobals()
const { Compositor } = await import('./compositor')
const { adjustmentChangesPicture, planAdjustment } = await import('./adjustmentLayer')

const W = 64
const H = 36
const BG_HEX = '#00c800'
/** The lower clip: a red left half and a blue right half, so "everything under" is two colours. */
const lowerPixels = (): SoftCanvas => SoftCanvas.solid(W, H, (x) => (x < W / 2 ? [200, 40, 40, 255] : [20, 30, 120, 255]))
/** A second clip, drawn in the top-left quarter. */
const upperPixels = (): SoftCanvas => SoftCanvas.solid(W, H, () => [240, 240, 0, 255])

const video = (id: string): Asset => ({
  id, kind: 'video', name: `${id}.mp4`, path: `/m/${id}.mp4`, durationUs: 20_000_000, width: W, height: H, fps: 30,
  hasAudio: false, hasVideo: true, posterPath: null, waveformPath: null, createdAt: 0
})
const LAYER = adjustmentAsset('ast_adj', 0)

function item(id: string, assetId: string, trackId: string, extra: Partial<Item> = {}): Item {
  return {
    id, assetId, trackId, from: 0, durationInFrames: 300, sourceStartUs: 0,
    layout: { left: 0, top: 0, width: W, height: H, opacity: 1, rotation: 0 },
    volume: 1, fadeInFrames: 0, fadeOutFrames: 0, speed: 1, ...extra
  }
}
const track = (id: string, items: Item[]): Track => ({ id, kind: 'video', name: id, locked: false, muted: false, hidden: false, items })

function scene(tracks: Track[], background = BG_HEX): { project: Project; timeline: Timeline } {
  const timeline: Timeline = { id: 'tl', name: 'tl', fps: 30, width: W, height: H, background, tracks, transitions: [] }
  return { project: { id: 'p', name: 'p', version: 1, assets: [video('lower'), video('upper'), LAYER], timelines: [timeline], activeTimelineId: 'tl', createdAt: 0, updatedAt: 0 }, timeline }
}

const pool = (): FakePool => new FakePool((assetId) => (assetId === 'upper' ? upperPixels() : lowerPixels()))

function draw(s: { project: Project; timeline: Timeline }, frame = 45, scale = 1): { out: SoftCanvas; ctx: ReturnType<SoftCanvas['getContext']>; stats: ReturnType<InstanceType<typeof Compositor>['drawFrame']> } {
  const out = new SoftCanvas(Math.round(W * scale), Math.round(H * scale))
  const ctx = out.getContext()
  ctx.scale(scale, scale)
  const stats = new Compositor(pool() as never).drawFrame(ctx as never, s.project, s.timeline, frame)
  return { out, ctx, stats }
}

/** The largest difference between two frames, over every channel of every pixel (premultiplied, 0..1). */
function difference(a: SoftCanvas, b: SoftCanvas): number {
  assert.equal(a.px.length, b.px.length)
  let worst = 0
  for (let i = 0; i < a.px.length; i += 1) worst = Math.max(worst, Math.abs(a.px[i]! - b.px[i]!))
  return worst
}
const close = (a: Rgba, b: readonly number[], tol = 1e-4): boolean => a.every((v, i) => Math.abs(v - b[i]!) <= tol)

const INVERT = { adjustments: { invert: 1 } } as Partial<Item>
const DIM = { adjustments: { brightness: 0.5 } } as Partial<Item>
const lower = (extra: Partial<Item> = {}): Item => item('lower', 'lower', 'v1', extra)
const layer = (extra: Partial<Item> = {}): Item => item('adj', 'ast_adj', 'v3', extra)

// -- the same look, directly or through a layer ---------------------------------------------------

test('a look on an adjustment layer gives the frame the look put directly on the clip under it', () => {
  for (const look of [INVERT, DIM]) {
    const direct = draw(scene([track('v1', [lower(look)])]))
    const through = draw(scene([track('v1', [lower()]), track('v3', [layer(look)])]))
    assert.equal(through.stats.placeholders, 0)
    assert.equal(through.stats.gradeIssues, undefined)
    assert.ok(difference(direct.out, through.out) < 1e-6, `direct and layered differ by ${difference(direct.out, through.out)}`)
    // And the look did something: the plain frame is a different picture, so the comparison can fail.
    const plain = draw(scene([track('v1', [lower()])]))
    assert.ok(difference(plain.out, through.out) > 0.2)
  }
})

test('at preview size as at export size: half-size frames agree the same way', () => {
  const direct = draw(scene([track('v1', [lower(INVERT)])]), 45, 0.5)
  const through = draw(scene([track('v1', [lower()]), track('v3', [layer(INVERT)])]), 45, 0.5)
  assert.equal(through.out.width, 32)
  assert.ok(difference(direct.out, through.out) < 1e-6)
})

test('it changes everything under it — two tracks and the background — and nothing above it', () => {
  const quarter = { layout: { left: 0, top: 0, width: W / 2, height: H / 2, opacity: 1, rotation: 0 } }
  const under = draw(scene([track('v1', [lower({ layout: { left: 0, top: H / 2, width: W, height: H / 2, opacity: 1, rotation: 0 } })]), track('v2', [item('upper', 'upper', 'v2', quarter)]), track('v3', [layer(INVERT)])]))
  // Yellow (240, 240, 0) under the layer is inverted to (15, 15, 255); the background green to (255, 55, 255).
  assert.deepEqual(under.out.at(8, 4), [15, 15, 255, 255], 'the upper clip, under the layer')
  assert.deepEqual(under.out.at(48, 4), [255, 55, 255, 255], 'the bare background, under the layer')
  assert.deepEqual(under.out.at(8, 30), [55, 215, 215, 255], 'the lower clip, under the layer')
  // The same clips with the layer between them: the one above is untouched.
  const between = draw(scene([track('v1', [lower()]), track('v2', [layer(INVERT)]), track('v3', [item('upper', 'upper', 'v3', quarter)])]))
  assert.deepEqual(between.out.at(8, 4), [240, 240, 0, 255], 'above the layer: as it was')
  assert.deepEqual(between.out.at(8, 30), [55, 215, 215, 255], 'below the layer: changed')
})

test('only for its span, and not at all when switched off or on a hidden track', () => {
  const plain = draw(scene([track('v1', [lower()])]))
  const spanned = scene([track('v1', [lower()]), track('v3', [layer({ ...INVERT, from: 60, durationInFrames: 30 })])])
  assert.ok(difference(plain.out, draw(spanned, 59).out) === 0, 'the frame before it starts')
  assert.ok(difference(plain.out, draw(spanned, 60).out) > 0.2, 'its first frame')
  assert.ok(difference(plain.out, draw(spanned, 89).out) > 0.2, 'its last frame')
  assert.ok(difference(plain.out, draw(spanned, 90).out) === 0, 'the frame after it ends')
  assert.equal(difference(plain.out, draw(scene([track('v1', [lower()]), track('v3', [layer({ ...INVERT, disabled: true })])])).out), 0)
  const hidden = scene([track('v1', [lower()]), { ...track('v3', [layer(INVERT)]), hidden: true }])
  assert.equal(difference(plain.out, draw(hidden).out), 0)
})

// -- through its masks, and at its opacity ---------------------------------------------------------

test('through a mask, each pixel is the original and the adjusted picture mixed by the mask\'s coverage', () => {
  const masks: ShapeMask[] = [{ kind: 'ellipse', x: 0.5, y: 0.5, width: 0.6, height: 0.7, feather: 8 }]
  const plain = draw(scene([track('v1', [lower()])])).out
  const whole = draw(scene([track('v1', [lower(INVERT)])])).out
  const { out, stats } = draw(scene([track('v1', [lower()]), track('v3', [layer({ ...INVERT, masks })])]))
  assert.equal(stats.gradeIssues, undefined)
  let soft = 0
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      // The coverage reaches the canvas as 8-bit alpha, used for the hole and for the add alike.
      const m = Math.round(masksCoverage(masks, x + 0.5, y + 0.5, { width: W, height: H }, 1) * 255) / 255
      const a = plain.raw(x, y)
      const b = whole.raw(x, y)
      const want = a.map((v, i) => v * (1 - m) + b[i]! * m)
      assert.ok(close(out.raw(x, y), want, 2e-3), `(${x}, ${y}) m=${m}: ${out.raw(x, y)} against ${want}`)
      if (m > 0.05 && m < 0.95) soft += 1
    }
  }
  assert.ok(soft > 40, 'the specimen must hold soft pixels')
  // Outside the mask the frame is exactly the original; at its centre exactly the adjusted one.
  assert.deepEqual(out.at(1, 1), plain.at(1, 1))
  assert.deepEqual(out.at(20, 18), whole.at(20, 18))
})

test('opacity mixes the look in, and a fade eases it', () => {
  const plain = draw(scene([track('v1', [lower()])])).out
  const whole = draw(scene([track('v1', [lower(INVERT)])])).out
  const half = draw(scene([track('v1', [lower()]), track('v3', [layer({ ...INVERT, layout: { left: 0, top: 0, width: W, height: H, opacity: 0.5, rotation: 0 } })])])).out
  for (const [x, y] of [[4, 4], [40, 20]] as const) {
    const want = plain.raw(x, y).map((v, i) => (v + whole.raw(x, y)[i]!) / 2)
    assert.ok(close(half.raw(x, y), want), `(${x}, ${y})`)
  }
  // A 10-frame fade-in: nothing at its first frame, half way at frame 5, all of it from frame 10.
  const fading = scene([track('v1', [lower()]), track('v3', [layer({ ...INVERT, fadeInFrames: 10 })])])
  assert.equal(difference(draw(fading, 0).out, plain), 0)
  assert.ok(difference(draw(fading, 5).out, half) < 1e-4)
  assert.ok(difference(draw(fading, 10).out, whole) < 1e-6)
})

test('the frame\'s alpha is untouched: over a transparent background, edges stay as soft as they were', () => {
  // A half-opaque clip over nothing: every pixel has alpha 0.5. Dimmed through a layer, the colour
  // halves and the alpha must not move — a plain draw of the adjusted copy over the original would
  // raise it to 0.75.
  const ghost = { layout: { left: 0, top: 0, width: W, height: H, opacity: 0.5, rotation: 0 } }
  const plain = draw(scene([track('v1', [lower(ghost)])], TRANSPARENT_BACKGROUND)).out
  const direct = draw(scene([track('v1', [lower({ ...ghost, ...DIM })])], TRANSPARENT_BACKGROUND)).out
  const through = draw(scene([track('v1', [lower(ghost)]), track('v3', [layer(DIM)])], TRANSPARENT_BACKGROUND)).out
  assert.ok(Math.abs(plain.raw(10, 10)[3] - 0.5) < 1e-6, 'the specimen is half transparent')
  assert.ok(Math.abs(through.raw(10, 10)[3] - 0.5) < 1e-6, `alpha moved to ${through.raw(10, 10)[3]}`)
  assert.ok(difference(direct, through) < 1e-6)
  // And through a soft mask: alpha is the original's everywhere, inside, outside and on the ramp.
  const masked = draw(scene([track('v1', [lower(ghost)]), track('v3', [layer({ ...DIM, masks: [{ kind: 'ellipse', x: 0.5, y: 0.5, width: 0.5, height: 0.5, feather: 10 }] })])], TRANSPARENT_BACKGROUND)).out
  for (let y = 0; y < H; y += 3) for (let x = 0; x < W; x += 3) assert.ok(Math.abs(masked.raw(x, y)[3] - 0.5) < 2e-3, `(${x}, ${y}): ${masked.raw(x, y)[3]}`)
  assert.ok(difference(masked, plain) > 0.05, 'and the mask\'s inside was dimmed')
})

// -- costs nothing when it does nothing ------------------------------------------------------------

test('a layer with no look is skipped: nothing copied, nothing drawn, the frame identical', () => {
  const plain = draw(scene([track('v1', [lower()])]))
  for (const empty of [{}, { adjustments: { brightness: 1, invert: 0 } }, { grade: {} }] as Partial<Item>[]) {
    const idle = draw(scene([track('v1', [lower()]), track('v3', [layer(empty)])]))
    assert.equal(difference(plain.out, idle.out), 0)
    assert.equal(idle.stats.drawn, plain.stats.drawn, 'not counted as drawn')
    assert.equal(idle.ctx.sources.length, plain.ctx.sources.length, 'no copy of the frame was drawn back')
    assert.equal(adjustmentChangesPicture(layer(empty)), false)
  }
  // Control: with a look, the same scene does copy and draw.
  const busy = draw(scene([track('v1', [lower()]), track('v3', [layer(INVERT)])]))
  assert.equal(busy.stats.drawn, plain.stats.drawn + 1)
  assert.ok(busy.ctx.sources.length > plain.ctx.sources.length)
  assert.equal(adjustmentChangesPicture(layer(INVERT)), true)
  // A layer carrying effects is never skipped, whatever else it has — the effect stack's seam.
  assert.equal(adjustmentChangesPicture({ ...layer(), effects: [{ kind: 'blur' }] } as unknown as Item), true)
})

// -- when it cannot be applied ---------------------------------------------------------------------

test('a layer that cannot be applied leaves the frame as it was and says so on the frame', () => {
  const plain = draw(scene([track('v1', [lower()])]))
  const broken = draw(scene([track('v1', [lower()]), track('v3', [layer({ ...INVERT, masks: [{ kind: 'star' } as unknown as Mask] })])]))
  assert.equal(difference(plain.out, broken.out), 0, 'the picture under it is untouched — not half-erased')
  assert.equal(broken.stats.gradeIssues?.length, 1)
  assert.match(broken.stats.gradeIssues![0]!, /adjustment layer adj was not applied: masks\[0\]\.kind must be/)
  // Control: the same layer with a mask this build reads is applied without a word.
  const fine = draw(scene([track('v1', [lower()]), track('v3', [layer({ ...INVERT, masks: [{ kind: 'rect', x: 0.5, y: 0.5, width: 0.5, height: 0.5 }] })])]))
  assert.equal(fine.stats.gradeIssues, undefined)
  assert.ok(difference(plain.out, fine.out) > 0.2)
})

// -- the plan --------------------------------------------------------------------------------------

test('planAdjustment: the frame\'s rectangle on the canvas, at the output\'s scale, drawn whole and upright', () => {
  const moved = layer({ layout: { left: 10, top: 5, width: 20, height: 9, opacity: 0.4, rotation: 30, scale: 2 }, crop: { left: 0.1, top: 0, right: 0, bottom: 0 }, blendMode: 'multiply' })
  const plan = planAdjustment(moved, { width: 1920, height: 1080 }, { a: 0.5, b: 0, c: 0, d: 0.5, e: 0, f: 0 })!
  assert.deepEqual({ sx: plan.sx, sy: plan.sy, sw: plan.sw, sh: plan.sh, width: plan.width, height: plan.height }, { sx: 0, sy: 0, sw: 960, sh: 540, width: 960, height: 540 })
  // Its own box, rotation, zoom, crop and blend mode are not read; its opacity is.
  assert.deepEqual(plan.item.layout, { left: 0, top: 0, width: 1920, height: 1080, opacity: 0.4, rotation: 0 })
  assert.equal('crop' in plan.item, false)
  assert.equal(plan.item.blendMode as string, 'lighter')
  assert.equal(moved.blendMode, 'multiply', 'the stored item is not changed')
  // A transition's offset moves the rectangle; a rotated transform has none.
  assert.equal(planAdjustment(moved, { width: 1920, height: 1080 }, { a: 1, b: 0, c: 0, d: 1, e: -300, f: 40 })!.sx, -300)
  assert.equal(planAdjustment(moved, { width: 1920, height: 1080 }, { a: 0.7, b: 0.7, c: -0.7, d: 0.7, e: 0, f: 0 }), null)
})
