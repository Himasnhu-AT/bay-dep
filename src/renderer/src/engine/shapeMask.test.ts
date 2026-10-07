/**
 * Shape masks through the compositor, on pixels: a software canvas stands in for the 2D context
 * (`softCanvas.testkit`), so what is checked is the colour that ends up at each position.
 *
 * The scene is one clip — solid red — over a green background, 64 × 36. Where the mask keeps the
 * clip the pixel is red, where it removes it the pixel is green, and on a soft edge it is the
 * mix the coverage function says: `@shared/shape-mask`'s numbers, measured on the picture.
 *
 * The real thing — a real canvas, `preview_frame` against an exported frame — is the unrun probe
 * `test/app/shape-mask.mjs`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Asset, Item, Project, Timeline, Track } from '@shared/project'
import { masksCoverage, rasterMasks, type ShapeMask } from '@shared/shape-mask'
import type { Mask, SubjectMatte, SubjectMatteIndex } from '@shared/matte'
import { FakePool, installCanvasGlobals, makeSoft, SoftCanvas } from './softCanvas.testkit'

installCanvasGlobals()
const { Compositor } = await import('./compositor')
const { subjectMattes } = await import('./subjectMatte')
const { ShapeMaskCache, shapeView } = await import('./shapeMask')

const W = 64
const H = 36
const CLIP = [200, 40, 40, 255] as const
const BG = [0, 200, 0, 255] as const
const BG_HEX = '#00c800'
const FPS = 30
const MATTE: SubjectMatte = { key: 'b'.repeat(32), fromUs: 0, toUs: 20_000_000, engine: 'apple-vision-person-balanced', frames: 600, width: 4, height: 3 }

const asset: Asset = {
  id: 'ast_clip', kind: 'video', name: 'talk.mp4', path: '/m/talk.mp4', durationUs: 20_000_000, width: W, height: H, fps: 30,
  hasAudio: true, hasVideo: true, posterPath: null, waveformPath: null, createdAt: 0, subjectMattes: [MATTE]
}

function item(id: string, trackId: string, extra: Partial<Item> = {}): Item {
  return {
    id, assetId: 'ast_clip', trackId, from: 0, durationInFrames: 300, sourceStartUs: 0,
    layout: { left: 0, top: 0, width: W, height: H, opacity: 1, rotation: 0 },
    volume: 1, fadeInFrames: 0, fadeOutFrames: 0, speed: 1, ...extra
  }
}
const track = (id: string, items: Item[]): Track => ({ id, kind: 'video', name: id, locked: false, muted: false, hidden: false, items })

function scene(tracks: Track[]): { project: Project; timeline: Timeline } {
  const timeline: Timeline = { id: 'tl', name: 'tl', fps: FPS, width: W, height: H, background: BG_HEX, tracks, transitions: [] }
  return { project: { id: 'p', name: 'p', version: 1, assets: [asset], timelines: [timeline], activeTimelineId: 'tl', createdAt: 0, updatedAt: 0 }, timeline }
}
const masked = (masks: Mask[], extra: Partial<Item> = {}): { project: Project; timeline: Timeline } => scene([track('v1', [item('clip', 'v1', { masks, ...extra })])])

const pool = (): FakePool => new FakePool(() => SoftCanvas.solid(W, H, () => [...CLIP]))

/** Draws one frame at `scale` output pixels per timeline pixel — 1 is an export at project size, 0.5 a half-size preview. */
async function draw(s: { project: Project; timeline: Timeline }, scale = 1, compositor = new Compositor(pool() as never)): Promise<{ out: SoftCanvas; stats: ReturnType<InstanceType<typeof Compositor>['drawFrame']> }> {
  for (let attempt = 0; ; attempt += 1) {
    const out = new SoftCanvas(Math.round(W * scale), Math.round(H * scale))
    const ctx = out.getContext()
    ctx.scale(scale, scale)
    const stats = compositor.drawFrame(ctx as never, s.project, s.timeline, 45)
    if (stats.pending === 0 || attempt >= 3) return { out, stats }
    await subjectMattes.settle(1000)
  }
}

/** How much of the clip a pixel shows, 0..1, read back from its colour: red is 1, green is 0. */
function kept(out: SoftCanvas, x: number, y: number): number {
  const [r, g] = out.raw(x, y)
  const fromRed = (r - BG[0] / 255) / (CLIP[0] / 255 - BG[0] / 255)
  const fromGreen = (g - BG[1] / 255) / (CLIP[1] / 255 - BG[1] / 255)
  assert.ok(Math.abs(fromRed - fromGreen) < 1e-4, `(${x}, ${y}) is not a mix of the clip and the background: ${out.raw(x, y)}`)
  // The canvas is 32-bit float: a millionth is its rounding, far below a byte of alpha.
  return Math.round(fromRed * 1e6) / 1e6
}

const FRAME = { width: W, height: H }
const ellipse: ShapeMask = { kind: 'ellipse', x: 0.5, y: 0.5, width: 0.6, height: 0.7, feather: 8 }

// -- the picture is the coverage function ----------------------------------------------------------

test('control: with no mask the clip covers the frame; the measurement reads 1 everywhere', async () => {
  const { out, stats } = await draw(scene([track('v1', [item('clip', 'v1')])]))
  assert.equal(stats.placeholders, 0)
  for (const [x, y] of [[0, 0], [32, 18], [63, 35]] as const) assert.ok(Math.abs(kept(out, x, y) - 1) < 1e-6)
})

test('every pixel of a masked clip shows as much of the clip as masksCoverage says', async () => {
  const masks: ShapeMask[] = [ellipse, { kind: 'rect', x: 0.2, y: 0.3, width: 0.25, height: 0.4, radius: 0.5, feather: 3, combine: 'subtract' }]
  const { out, stats } = await draw(masked(masks))
  assert.equal(stats.placeholders, 0, stats.placeholderNames.join(', '))
  let soft = 0
  let full = 0
  let none = 0
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const want = masksCoverage(masks, x + 0.5, y + 0.5, FRAME, 1)
      const got = kept(out, x, y)
      // Half a byte: the coverage reaches the canvas as 8-bit alpha.
      assert.ok(Math.abs(got - want) <= 0.5 / 255 + 1e-4, `(${x}, ${y}): drew ${got}, coverage ${want}`)
      if (want > 0.02 && want < 0.98) soft += 1
      else if (want >= 0.98) full += 1
      else none += 1
    }
  }
  assert.ok(soft > 50 && full > 50 && none > 50, `the specimen must have kept, removed and soft pixels: ${full}/${none}/${soft}`)
})

test('inside is the clip and outside is what is under it, for each shape', async () => {
  const shapes: { mask: ShapeMask; inside: [number, number]; outside: [number, number] }[] = [
    { mask: { kind: 'rect', x: 0.25, y: 0.5, width: 0.25, height: 0.5 }, inside: [16, 18], outside: [40, 18] },
    { mask: { kind: 'ellipse', x: 0.75, y: 0.5, width: 0.25, height: 0.6 }, inside: [48, 18], outside: [41, 9] },
    { mask: { kind: 'path', x: 0.5, y: 0.5, width: 0.5, height: 0.8, points: [{ x: 0, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }] }, inside: [20, 28], outside: [44, 8] }
  ]
  for (const { mask, inside, outside } of shapes) {
    const { out } = await draw(masked([mask]))
    assert.equal(kept(out, ...inside), 1, `${mask.kind}: inside`)
    assert.equal(kept(out, ...outside), 0, `${mask.kind}: outside`)
    const inverted = await draw(masked([{ ...mask, invert: true }]))
    assert.equal(kept(inverted.out, ...inside), 0, `${mask.kind} inverted: inside`)
    assert.equal(kept(inverted.out, ...outside), 1, `${mask.kind} inverted: outside`)
  }
})

test('the feather on the picture is the stated width, measured along a row', async () => {
  // A rectangle running off the left, top and bottom of the clip, with a 12 px feather: the only
  // edge in the picture is its right one, at x = 32.
  const { out } = await draw(masked([{ kind: 'rect', x: 0, y: 0.5, width: 1, height: 4, feather: 12 }]))
  const row = Array.from({ length: W }, (_, x) => kept(out, x, 18))
  const firstSoft = row.findIndex((v) => v < 1 - 1e-3)
  const firstGone = row.findIndex((v) => v < 1e-3)
  // Fully kept until 6 px inside the edge, gone 6 px outside it: pixels 26..37 are the ramp.
  assert.ok(Math.abs(firstGone - firstSoft - 12) <= 1, `ramp measured ${firstGone - firstSoft} px wide: ${row.map((v) => v.toFixed(2)).join(' ')}`)
  assert.ok(Math.abs((firstSoft + firstGone) / 2 - 32) <= 1, 'centred on the edge')
  for (let x = 1; x < W; x += 1) assert.ok(row[x]! <= row[x - 1]! + 1e-6, `rises at ${x}`)
  // Control: with no feather the row steps in one pixel.
  const hard = await draw(masked([{ kind: 'rect', x: 0, y: 0.5, width: 1, height: 4 }]))
  assert.equal(kept(hard.out, 31, 18), 1)
  assert.equal(kept(hard.out, 32, 18), 0)
})

// -- the mask is in the clip's own space ----------------------------------------------------------

test('a crop removes picture and leaves the mask where it was on the picture', async () => {
  const mask: ShapeMask = { kind: 'rect', x: 0.5, y: 0.5, width: 0.5, height: 0.5 }
  const whole = await draw(masked([mask]))
  // A crop that lands on whole pixels (24 of 64), so the two pictures can be compared exactly.
  const cropped = await draw(masked([mask], { crop: { left: 0.375, top: 0, right: 0, bottom: 0 } }))
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const want = x < 24 ? 0 : kept(whole.out, x, y)
      assert.equal(kept(cropped.out, x, y), want, `(${x}, ${y})`)
    }
  }
  // The crop took part of the masked area, so the two pictures do differ: the test can fail.
  assert.equal(kept(whole.out, 20, 18), 1)
  assert.equal(kept(cropped.out, 20, 18), 0)
})

test('moving and resizing the clip carries the mask: it stays the same part of the clip', async () => {
  const mask: ShapeMask = { kind: 'ellipse', x: 0.5, y: 0.5, width: 0.5, height: 0.5 }
  // The clip at half size in the right-hand bottom quarter: its centre is (48, 27), the ellipse 16 × 9 about it.
  const moved = await draw(masked([mask], { layout: { left: 32, top: 18, width: 32, height: 18, opacity: 1, rotation: 0 } }))
  assert.equal(kept(moved.out, 48, 27), 1)
  assert.equal(kept(moved.out, 32, 18), 0, 'the frame centre is now outside the mask')
  assert.equal(kept(moved.out, 58, 27), 0, 'inside the clip, outside its mask')
  // A zoom about the clip's centre (layout.scale) scales the mask with the picture.
  const zoomed = await draw(masked([mask], { layout: { left: 0, top: 0, width: W, height: H, opacity: 1, rotation: 0, scale: 2 } }))
  const plain = await draw(masked([mask]))
  // Unzoomed the ellipse is 32 px wide (x 16..48); zoomed ×2 it spans the frame's width.
  assert.equal(kept(plain.out, 8, 18), 0)
  assert.equal(kept(zoomed.out, 8, 18), 1)
  // A keyframed zoom is the same transform, sampled: at the key's value it draws as the static one.
  const keyed = await draw(masked([mask], { keyframes: { scale: [{ frame: 0, value: 2 }, { frame: 300, value: 2 }] } }))
  for (const [x, y] of [[8, 18], [32, 2], [60, 18], [2, 2]] as const) assert.equal(kept(keyed.out, x, y), kept(zoomed.out, x, y))
})

test('a half-size preview and a full-size export show the same part of the clip through the mask', async () => {
  const masks: ShapeMask[] = [{ kind: 'ellipse', x: 0.4, y: 0.5, width: 0.5, height: 0.6, feather: 6 }]
  const full = await draw(masked(masks), 1)
  const half = await draw(masked(masks), 0.5)
  assert.equal(half.out.width, 32)
  let compared = 0
  for (let y = 0; y < H / 2; y += 1) {
    for (let x = 0; x < W / 2; x += 1) {
      // A half-size pixel covers four full-size ones; its coverage is the function at its own centre.
      const want = masksCoverage(masks, (x + 0.5) * 2, (y + 0.5) * 2, FRAME, 2)
      assert.ok(Math.abs(kept(half.out, x, y) - want) <= 0.5 / 255 + 1e-4, `(${x}, ${y})`)
      const four = (kept(full.out, 2 * x, 2 * y) + kept(full.out, 2 * x + 1, 2 * y) + kept(full.out, 2 * x, 2 * y + 1) + kept(full.out, 2 * x + 1, 2 * y + 1)) / 4
      // And the two sizes agree about the picture, to within the antialiasing of an edge pixel.
      assert.ok(Math.abs(kept(half.out, x, y) - four) < 0.2, `(${x}, ${y}): half ${kept(half.out, x, y)}, full ${four}`)
      compared += 1
    }
  }
  assert.equal(compared, 32 * 18)
})

// -- with the subject cut-out ---------------------------------------------------------------------

/** A matte whose left half is the person. */
function matteLoader(): Parameters<typeof subjectMattes.useLoader>[0] {
  return {
    async index(key) {
      const n = 600
      const index: SubjectMatteIndex = {
        key, url: 'bay://media/x', width: 4, height: 3, fromUs: 0, toUs: 20_000_000,
        ptsUs: Array.from({ length: n }, (_, i) => Math.round((i * 1_000_000) / 30)),
        offsets: Array.from({ length: n }, () => 0), lengths: Array.from({ length: n }, () => 1)
      }
      return { ok: true, index }
    },
    async frame() {
      return { image: SoftCanvas.solid(4, 3, (x) => (x < 2 ? [255, 255, 255, 255] : [255, 255, 255, 0])) as unknown as CanvasImageSource, width: 4, height: 3 }
    }
  }
}

test('a subject mask and a shape together keep only what both keep', async () => {
  subjectMattes.useLoader(matteLoader())
  // The person is the left half; the shape is the top half.
  const top: ShapeMask = { kind: 'rect', x: 0.5, y: 0.25, width: 1, height: 0.5 }
  const { out, stats } = await draw(masked([{ kind: 'subject' }, top]))
  assert.equal(stats.pending, 0, stats.pendingNames.join(', '))
  assert.equal(stats.placeholders, 0, stats.placeholderNames.join(', '))
  assert.equal(kept(out, 10, 6), 1, 'person, inside the shape')
  assert.equal(kept(out, 10, 30), 0, 'person, outside the shape')
  assert.equal(kept(out, 50, 6), 0, 'not the person, inside the shape')
  // Control: the subject mask alone keeps the whole left half.
  const alone = await draw(masked([{ kind: 'subject' }]))
  assert.equal(kept(alone.out, 10, 30), 1)
})

test('a cut-out draws through its clip\'s shape masks: no person standing outside the clip\'s window', async () => {
  subjectMattes.useLoader(matteLoader())
  const top: ShapeMask = { kind: 'rect', x: 0.5, y: 0.25, width: 1, height: 0.5 }
  const clip = item('clip', 'v1', { linkId: 'lnk', masks: [top] })
  const cutout = item('cutout', 'v2', { linkId: 'lnk', audioDetached: true, masks: [{ kind: 'subject' }] })
  const { out, stats } = await draw(scene([track('v1', [clip]), track('v2', [cutout])]))
  assert.equal(stats.placeholders, 0, stats.placeholderNames.join(', '))
  assert.equal(kept(out, 10, 6), 1)
  assert.equal(kept(out, 10, 30), 0, 'below the clip\'s window the cut-out must not draw the person')
  // Control: unlinked, the copy is not that clip's cut-out and draws its own unshaped subject.
  const loose = await draw(scene([track('v1', [clip]), track('v2', [{ ...cutout, linkId: 'other' }])]))
  assert.equal(kept(loose.out, 10, 30), 1)
})

// -- a mask that cannot be drawn ------------------------------------------------------------------

test('a mask this build cannot read is a named placeholder, never the clip unmasked', async () => {
  const broken = masked([{ kind: 'star', x: 0.5, y: 0.5, width: 0.2, height: 0.2 } as unknown as Mask])
  const { out, stats } = await draw(broken)
  assert.equal(stats.placeholders, 1)
  assert.ok(stats.placeholderNames[0]!.includes('clip clip') && stats.placeholderNames[0]!.includes('kind'), stats.placeholderNames[0])
  assert.deepEqual(stats.unresolvedNames, stats.placeholderNames)
  // Not the clip's picture anywhere: unmasked it would be red from corner to corner.
  for (const [x, y] of [[2, 2], [32, 18], [60, 33]] as const) assert.notDeepEqual(out.at(x, y), [...CLIP])
  // Control: the same clip with a readable mask draws clean.
  const fine = await draw(masked([{ kind: 'rect', x: 0.5, y: 0.5, width: 0.2, height: 0.2 }]))
  assert.equal(fine.stats.placeholders, 0)
  assert.deepEqual(fine.out.at(32, 18), [...CLIP])
})

// -- the coverage canvas --------------------------------------------------------------------------

test('a still mask is rasterised once, and again only when what it was made from changes', () => {
  const cache = new ShapeMaskCache(makeSoft as never)
  const box = { left: 0, top: 0, width: W, height: H }
  const whole = shapeView(box, { dx: 0, dy: 0, dw: W, dh: H }, W, H)
  const a = cache.get([ellipse], whole.frame, whole.view)
  assert.ok(a)
  assert.equal(cache.rasterised, 1)
  // The same masks by value (a new list object, as an undo or a reload makes): no new raster.
  assert.equal(cache.get([{ ...ellipse }], whole.frame, whole.view), a)
  assert.equal(cache.rasterised, 1)
  // Another size, another mask, another window: each is its own grid.
  const half = shapeView(box, { dx: 0, dy: 0, dw: W, dh: H }, W / 2, H / 2)
  cache.get([ellipse], half.frame, half.view)
  cache.get([{ ...ellipse, feather: 2 }], whole.frame, whole.view)
  const crop = shapeView(box, { dx: 16, dy: 0, dw: W - 16, dh: H }, W - 16, H)
  cache.get([ellipse], crop.frame, crop.view)
  assert.equal(cache.rasterised, 4)
  // And the canvas holds the function's grid as alpha.
  const canvas = a as unknown as SoftCanvas
  const grid = rasterMasks([ellipse], FRAME, whole.view)
  for (const [x, y] of [[32, 18], [14, 18], [0, 0], [45, 8]] as const) assert.equal(canvas.at(x, y)[3], grid[y * W + x])
})

test('shapeView: an uncropped clip at its own size is the frame itself; a crop and a scale move the window', () => {
  const box = { left: 100, top: 50, width: 800, height: 450 }
  assert.deepEqual(shapeView(box, { dx: 100, dy: 50, dw: 800, dh: 450 }, 800, 450), {
    frame: { width: 800, height: 450 },
    view: { width: 800, height: 450, originX: 0, originY: 0, stepX: 1, stepY: 1 }
  })
  // A 25% left crop drawn at half size: the window starts 200 px into the frame, two frame pixels per output pixel.
  assert.deepEqual(shapeView(box, { dx: 300, dy: 50, dw: 600, dh: 450 }, 300, 225).view, { width: 300, height: 225, originX: 200, originY: 0, stepX: 2, stepY: 2 })
})
