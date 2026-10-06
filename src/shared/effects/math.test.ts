/**
 * The decisions inside the effect shaders, tested where they can run: as the plain functions the
 * GLSL is written from. What these cannot show is that the shader and the function agree on a
 * picture — `test/app/effects.mjs` is the check for that, in the running app.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hexToRgb } from '../grade'
import {
  blurPlan,
  chroma,
  despill,
  duotoneColour,
  GAUSS_MAX_DOWN,
  GAUSS_MAX_SIGMA,
  GAUSS_TAPS,
  gaussianWeights,
  glitchBand,
  keyMatte,
  luma,
  mirrorCoord,
  pixelCell,
  sharpenKernel,
  SOFT_KERNEL,
  tintColour,
  type Rgb
} from './math'

const near = (actual: number, expected: number, tolerance: number, message?: string): void =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message ?? ''} expected ${expected} ± ${tolerance}, got ${actual}`)

const nearRgb = (actual: readonly number[], expected: readonly number[], message?: string): void =>
  expected.forEach((value, i) => near(actual[i] as number, value, 1e-12, message))

const hex = (value: string): Rgb => hexToRgb(value) as Rgb

// The default key colour, and things that stand in front of a green screen.
const GREEN = hex('#00B140')
const SKIN: Rgb = [0.86, 0.66, 0.55]
const WHITE: Rgb = [1, 1, 1]
const BLACK: Rgb = [0, 0, 0]
const GREY: Rgb = [0.5, 0.5, 0.5]
const RED_SHIRT: Rgb = [0.75, 0.1, 0.12]
// The catalog's defaults for chroma-key.
const SIMILARITY = 0.2
const SMOOTHNESS = 0.08

test('the key removes the screen and keeps the subject', () => {
  assert.equal(keyMatte(GREEN, GREEN, SIMILARITY, SMOOTHNESS), 0, 'the key colour itself is fully removed')
  // A screen is never one colour: a little lighter, a little yellower.
  assert.equal(keyMatte([0.06, 0.72, 0.28], GREEN, SIMILARITY, SMOOTHNESS), 0)
  assert.equal(keyMatte([0.1, 0.62, 0.2], GREEN, SIMILARITY, SMOOTHNESS), 0)
  for (const [name, colour] of Object.entries({ SKIN, WHITE, BLACK, GREY, RED_SHIRT })) {
    assert.equal(keyMatte(colour, GREEN, SIMILARITY, SMOOTHNESS), 1, `${name} must be kept whole`)
  }
})

test('neutral colours are all the same distance from the key, whatever their brightness', () => {
  // The matte is decided in chroma: a white shirt, a grey wall and a black jacket key alike.
  const loose = 0.45
  const values = [WHITE, GREY, BLACK].map((c) => keyMatte(c, GREEN, loose, 0.2))
  assert.ok(values.every((v) => Math.abs(v - (values[0] as number)) < 1e-9), JSON.stringify(values))
  assert.deepEqual(chroma(GREY).map((v) => Math.abs(v) < 1e-9), [true, true])
})

test('similarity widens what is removed and smoothness softens the edge between', () => {
  const edge: Rgb = [0.3, 0.6, 0.35]
  const tight = keyMatte(edge, GREEN, 0.05, 0.02)
  const wide = keyMatte(edge, GREEN, 0.4, 0.02)
  assert.equal(tight, 1, 'outside a tight key')
  assert.equal(wide, 0, 'inside a wide one')
  // Monotonic: raising similarity never keeps more of a pixel.
  let last = 1
  for (let s = 0; s <= 1.0001; s += 0.01) {
    const m = keyMatte(edge, GREEN, s, 0.1)
    assert.ok(m <= last + 1e-12, `similarity ${s}`)
    last = m
  }
  // With smoothness the same pixel is partly kept; with none it is one or the other.
  const a = chroma(edge)
  const b = chroma(GREEN)
  const distance = Math.hypot(a[0] - b[0], a[1] - b[1])
  const soft = keyMatte(edge, GREEN, distance - 0.05, 0.1)
  assert.ok(soft > 0.1 && soft < 0.9, `a pixel half way across the soft edge is partly kept, got ${soft}`)
  const hardIn = keyMatte(edge, GREEN, distance + 0.001, 0)
  const hardOut = keyMatte(edge, GREEN, distance - 0.001, 0)
  assert.deepEqual([hardIn, hardOut], [0, 1], 'smoothness 0 is a hard edge, not a division by zero')
})

test('any key colour works, not only green', () => {
  const blue = hex('#0047BB')
  assert.equal(keyMatte(blue, blue, SIMILARITY, SMOOTHNESS), 0)
  assert.equal(keyMatte(SKIN, blue, SIMILARITY, SMOOTHNESS), 1)
  assert.equal(keyMatte(GREEN, blue, SIMILARITY, SMOOTHNESS), 1, 'green is not blue')
})

test('spill suppression takes the green cast off and leaves brightness and other colours alone', () => {
  // Skin lit by the screen: greener than it should be.
  const spilled: Rgb = [0.7, 0.78, 0.5]
  const cleaned = despill(spilled, GREEN, 1)
  assert.ok(cleaned[1] < spilled[1], 'less green')
  near(luma(cleaned), luma(spilled), 1e-6, 'brightness is kept')
  // At full strength nothing of the key's direction is left.
  const kc = chroma(GREEN)
  const kl = Math.hypot(kc[0], kc[1])
  const cc = chroma(cleaned)
  near((cc[0] * kc[0] + cc[1] * kc[1]) / kl, 0, 1e-6, 'chroma along the key')
  // Half strength removes half.
  const half = chroma(despill(spilled, GREEN, 0.5))
  const before = chroma(spilled)
  near((half[0] * kc[0] + half[1] * kc[1]) / kl, ((before[0] * kc[0] + before[1] * kc[1]) / kl) / 2, 1e-6)
  // Colours pointing away from the key have nothing to remove.
  for (const colour of [SKIN, RED_SHIRT, GREY, WHITE]) {
    const out = despill(colour, GREEN, 1)
    for (let i = 0; i < 3; i += 1) near(out[i] as number, colour[i] as number, 1e-9)
  }
  assert.deepEqual(despill(spilled, GREEN, 0), [...spilled], 'spill 0 is off')
  assert.deepEqual(despill(spilled, GREY, 1), [...spilled], 'a grey key has no cast to remove')
})

test('a Gaussian kernel sums to one, is widest at the centre, and stays within the taps the shader has', () => {
  for (const sigma of [0.5, 1, 2.5, 4, GAUSS_MAX_SIGMA]) {
    const weights = gaussianWeights(sigma)
    assert.ok(weights.length - 1 <= GAUSS_TAPS, `sigma ${sigma} uses ${weights.length - 1} taps a side`)
    const total = weights.reduce((sum, w, i) => sum + (i === 0 ? w : 2 * w), 0)
    near(total, 1, 1e-12, `sigma ${sigma} must not change the brightness of a flat area`)
    for (let i = 1; i < weights.length; i += 1) assert.ok((weights[i] as number) < (weights[i - 1] as number), 'falls away from the centre')
    // Three sigma is where it is cut: what is left out is under 1.2% of the centre weight.
    assert.ok((weights.at(-1) as number) / (weights[0] as number) < 0.02 || weights.length - 1 === GAUSS_TAPS)
  }
  // A wider sigma is a flatter kernel.
  assert.ok((gaussianWeights(4)[0] as number) < (gaussianWeights(1)[0] as number))
})

test('a blur is planned inside the tap budget, and is the blur asked for until the passes run out', () => {
  for (const sigmaDevice of [0.5, 3, 8, 8.01, 20, 33, 64]) {
    const { down, sigma } = blurPlan(sigmaDevice)
    assert.ok(Number.isInteger(down) && down >= 1 && down <= GAUSS_MAX_DOWN, `down ${down}`)
    assert.ok(sigma <= GAUSS_MAX_SIGMA + 1e-9, `sigma ${sigma} must fit ${GAUSS_TAPS} taps at three sigma`)
    near(down * sigma, sigmaDevice, 1e-9, `the blur asked for (${sigmaDevice})`)
  }
  assert.deepEqual(blurPlan(4), { down: 1, sigma: 4 }, 'a small blur is not shrunk first')
  // Past the largest blur the passes can make it stops growing rather than overrunning the loop.
  assert.deepEqual(blurPlan(1000), { down: GAUSS_MAX_DOWN, sigma: GAUSS_MAX_SIGMA })
  assert.equal(blurPlan(0.01).sigma, 0.5, 'never a zero sigma, which divides by zero')
})

test('sharpening leaves a flat area alone at every amount and none of it is the identity kernel', () => {
  near(SOFT_KERNEL.reduce((a, b) => a + b, 0), 1, 1e-12)
  for (const amount of [0, 0.6, 1.5, 3]) {
    const kernel = sharpenKernel(amount)
    near(kernel.reduce((a, b) => a + b, 0), 1, 1e-12, `amount ${amount}`)
  }
  sharpenKernel(0).forEach((w, i) => near(w, i === 4 ? 1 : 0, 0, 'amount 0 is the pixel itself'))
  // Across an edge it overshoots: darker on the dark side, brighter on the bright side.
  const kernel = sharpenKernel(1)
  const edge = [0, 0, 1, 0, 0, 1, 0, 0, 1]
  const flatDark = [0, 0, 0, 0, 0, 0, 0, 0, 0]
  const apply = (px: number[]): number => px.reduce((sum, v, i) => sum + v * (kernel[i] as number), 0)
  assert.ok(apply(edge) < 0, 'the dark pixel beside a bright edge goes darker')
  assert.equal(apply(flatDark), 0)
})

test('a glitch frame is a function of frame, hold and seed — the same every time it is drawn', () => {
  const sample = (frame: number, hold: number, seed: number, amount: number): string =>
    JSON.stringify(Array.from({ length: 40 }, (_, band) => glitchBand(band, frame, hold, seed, amount)))
  assert.equal(sample(120, 3, 7, 0.5), sample(120, 3, 7, 0.5), 'drawing frame 120 twice gives one picture')
  // The pattern holds for `hold` frames, then changes.
  assert.equal(sample(120, 3, 7, 0.5), sample(122, 3, 7, 0.5))
  assert.notEqual(sample(120, 3, 7, 0.5), sample(123, 3, 7, 0.5))
  assert.notEqual(sample(120, 1, 7, 0.5), sample(121, 1, 7, 0.5), 'hold 1 changes every frame')
  assert.notEqual(sample(120, 3, 7, 0.5), sample(120, 3, 8, 0.5), 'a different seed is a different pattern')
  // Frames before the clip (a transition's handle) are frame 0, not a crash.
  assert.equal(sample(-5, 3, 7, 0.5), sample(0, 3, 7, 0.5))
})

test('glitch amount is the share of bands that tear: none at 0, all at 1, about half at 0.5', () => {
  const bands = (amount: number): { active: boolean; shift: number }[] =>
    Array.from({ length: 2000 }, (_, band) => glitchBand(band, 30, 3, 0, amount))
  assert.equal(bands(0).filter((b) => b.active).length, 0)
  assert.equal(bands(1).filter((b) => b.active).length, 2000)
  const half = bands(0.5).filter((b) => b.active).length
  assert.ok(half > 900 && half < 1100, `about half of 2000 bands at 0.5, got ${half}`)
  // An untorn band does not move; torn ones go both ways, within the range.
  assert.ok(bands(0.5).every((b) => b.active || b.shift === 0))
  const shifts = bands(1).map((b) => b.shift)
  assert.ok(shifts.every((s) => s >= -1 && s < 1))
  assert.ok(shifts.some((s) => s < -0.5) && shifts.some((s) => s > 0.5), 'bands tear left and right')
  // A band that tears at a low amount still tears at a higher one: turning it up adds, never reshuffles.
  const low = bands(0.3)
  const high = bands(0.6)
  assert.ok(low.every((b, i) => !b.active || high[i]?.active))
})

test('mosaic blocks, mirror lines and the two colour maps', () => {
  // Every coordinate in a block reads the block's centre.
  near(pixelCell(0.0, 0.1), 0.05, 1e-12)
  near(pixelCell(0.099, 0.1), 0.05, 1e-12)
  near(pixelCell(0.1001, 0.1), 0.15, 1e-12)

  // Left kept, right reflected across the line.
  assert.equal(mirrorCoord(0.3, 0.5, false), 0.3)
  near(mirrorCoord(0.7, 0.5, false), 0.3, 1e-12)
  // Reversed: right kept, left reflected.
  assert.equal(mirrorCoord(0.7, 0.5, true), 0.7)
  near(mirrorCoord(0.3, 0.5, true), 0.7, 1e-12)
  // An off-centre line reflects past the picture's edge: it clamps there rather than reading outside.
  assert.equal(mirrorCoord(0.9, 0.2, false), 0)

  const navy = hex('#1B1464')
  const gold = hex('#F7C948')
  nearRgb(duotoneColour(0, navy, gold), navy, 'black becomes the shadow colour')
  nearRgb(duotoneColour(1, navy, gold), gold, 'white becomes the highlight colour')
  near(duotoneColour(0.5, navy, gold)[0], ((navy[0] as number) + (gold[0] as number)) / 2, 1e-12)

  const orange = hex('#FF9A3C')
  nearRgb(tintColour(0, orange), [0, 0, 0], 'black stays black')
  nearRgb(tintColour(1, orange), [1, 1, 1], 'white stays white')
  nearRgb(tintColour(0.5, orange), orange, 'the midtone is the colour')
})
