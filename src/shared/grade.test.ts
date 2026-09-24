/**
 * The grade's CPU half: what the shader is given. Each test is written from what the grade is
 * *for* — an identity grade must cost nothing, a curve must pass through its points without
 * inverting tones, warming must warm without brightening, grain must be the same on every run.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  buildCurveTable,
  curveKnots,
  decodeLutData,
  encodeLutData,
  evalCurve,
  grainHash,
  grainSeed,
  grainValue,
  resolveGrade,
  whiteBalanceGains,
  CURVE_TABLE_SIZE
} from './grade'

// -- identity ---------------------------------------------------------------

test('no grade, an empty grade and an all-default grade all skip the pass', () => {
  assert.equal(resolveGrade(undefined), null)
  assert.equal(resolveGrade({}), null)
  assert.equal(
    resolveGrade({
      lift: { r: 0, g: 0, b: 0 },
      gamma: { r: 0, g: 0, b: 0 },
      gain: { r: 0, g: 0, b: 0 },
      temperature: 0,
      tint: 0,
      saturation: 1,
      grain: { amount: 0, size: 2 },
      halation: { amount: 0, threshold: 0.5, radius: 20 },
      vignette: { amount: 0 },
      lut: { assetId: 'a', intensity: 0 }
    }),
    null
  )
})

test('a value that rounds to the identity still skips the pass (the 1e-6 rule)', () => {
  // A slider landing on 1.0000001 must not put the clip on the GPU path for a picture nobody
  // can tell apart — the same rule `adjustmentFilter` holds for CSS filters.
  assert.equal(resolveGrade({ saturation: 1.0000001 }), null)
  assert.equal(resolveGrade({ lift: { r: 1e-9, g: 0, b: 0 } }), null)
})

test('a curve whose points lie on the diagonal is the identity', () => {
  assert.equal(resolveGrade({ curves: { master: [[0.25, 0.25], [0.75, 0.75]] } }), null)
  assert.equal(buildCurveTable({ r: [[0, 0], [1, 1]] }), null)
})

test('each effect on its own is enough to run the pass', () => {
  // The positive control for every identity test above: a refusal that fires for everything
  // would pass them all.
  const cases = [
    { saturation: 0.5 },
    { lift: { r: 0.05, g: 0, b: 0 } },
    { gamma: { r: 0, g: 0.1, b: 0 } },
    { gain: { r: 0, g: 0, b: -0.1 } },
    { temperature: 200 },
    { tint: 0.2 },
    { curves: { master: [[0.5, 0.6]] as [number, number][] } },
    { lut: { assetId: 'x', intensity: 0.5 } },
    { grain: { amount: 0.1, size: 1 } },
    { halation: { amount: 0.2, threshold: 0.8, radius: 8 } },
    { vignette: { amount: 0.3 } }
  ]
  for (const grade of cases) assert.notEqual(resolveGrade(grade), null, JSON.stringify(grade))
})

test('one non-finite field falls back to its identity and leaves the others working', () => {
  const resolved = resolveGrade({ saturation: Number.NaN, gain: { r: 0.2, g: 0, b: 0 } })
  assert.ok(resolved)
  assert.equal(resolved.saturation, 1)
  assert.deepEqual(resolved.gain, [1.2, 1, 1])
})

// -- curves -----------------------------------------------------------------

test('a curve passes exactly through its points', () => {
  const knots = curveKnots([[0, 0.036], [0.25, 0.25], [0.8, 0.795], [1, 0.965]])
  for (const [x, y] of knots) assert.ok(Math.abs(evalCurve(knots, x) - y) < 1e-9, `${x}`)
})

test('missing ends are pinned to (0,0) and (1,1), present ones are not overridden', () => {
  assert.deepEqual(curveKnots([[0.5, 0.6]]), [[0, 0], [0.5, 0.6], [1, 1]])
  assert.deepEqual(curveKnots([[0, 0.1], [1, 0.9]]), [[0, 0.1], [1, 0.9]])
  // Unsorted input is sorted, not trusted.
  assert.deepEqual(curveKnots([[0.8, 0.7], [0.2, 0.3]]), [[0, 0], [0.2, 0.3], [0.8, 0.7], [1, 1]])
})

test('a steep S-curve never overshoots or inverts tones (monotone, not natural spline)', () => {
  // A natural cubic spline through these points overshoots above 1 and dips below the previous
  // knot between 0.3 and 0.35 — an inverted tone band. Monotone cubic cannot.
  const knots = curveKnots([[0.3, 0.05], [0.35, 0.95]])
  let previous = -Infinity
  for (let i = 0; i <= 1000; i += 1) {
    const y = evalCurve(knots, i / 1000)
    assert.ok(y >= previous - 1e-12, `not monotone at ${i / 1000}: ${y} < ${previous}`)
    assert.ok(y >= -1e-12 && y <= 1 + 1e-12, `out of range at ${i / 1000}: ${y}`)
    previous = y
  }
})

test('curves compose channel first, then master — ffmpeg\'s order', () => {
  // r lifts 0.5 to 0.7; master maps 0.7 to 0.9 but 0.5 only to ~0.5. Channel-then-master gives
  // ~0.9 at 0.5; master-then-channel would give ~0.7.
  const table = buildCurveTable({ r: [[0.5, 0.7]], master: [[0.7, 0.9]] })
  assert.ok(table)
  const mid = Math.round(0.5 * (CURVE_TABLE_SIZE - 1))
  const r = table[mid * 4] as number
  assert.ok(Math.abs(r - evalCurve(curveKnots([[0.7, 0.9]]), evalCurve(curveKnots([[0.5, 0.7]]), mid / (CURVE_TABLE_SIZE - 1)))) < 1e-6)
  assert.ok(r > 0.85, `r at 0.5 is ${r}`)
  // g had no channel curve, so it is the master alone.
  const g = table[mid * 4 + 1] as number
  assert.ok(Math.abs(g - evalCurve(curveKnots([[0.7, 0.9]]), mid / (CURVE_TABLE_SIZE - 1))) < 1e-6)
})

// -- white balance ------------------------------------------------------------

test('positive temperature warms (R up, B down) without changing luminance', () => {
  const [r, g, b] = whiteBalanceGains(200, 0)
  assert.ok(r > 1 && b < 1, `gains ${r} ${g} ${b}`)
  assert.ok(Math.abs(0.2126 * r + 0.7152 * g + 0.0722 * b - 1) < 1e-9)
  const [cr, , cb] = whiteBalanceGains(-200, 0)
  assert.ok(cr < 1 && cb > 1, 'negative temperature cools')
})

test('temperature is continuous across the Planckian fit\'s 4000 K seam', () => {
  // The target is 6500 - shift, so a shift of 2500 lands on the seam of Kim et al.'s piecewise fit.
  const below = whiteBalanceGains(2500 - 1e-3, 0)
  const above = whiteBalanceGains(2500 + 1e-3, 0)
  for (let c = 0; c < 3; c += 1) assert.ok(Math.abs((below[c] as number) - (above[c] as number)) < 1e-3)
})

test('positive tint is magenta: green down against red and blue', () => {
  const [r, g, b] = whiteBalanceGains(0, 0.5)
  assert.ok(g < r && g < b)
})

// -- grain --------------------------------------------------------------------

test('grain is a pure function of cell, frame and seed', () => {
  // Determinism is what makes an export reproducible and preview_frame an oracle for it.
  for (let i = 0; i < 100; i += 1) {
    assert.equal(grainHash(i, i * 7, 42, 99), grainHash(i, i * 7, 42, 99))
  }
  // The literal pins the function itself, so an edit here that the GLSL copy does not get
  // fails the suite instead of silently diverging preview from a probe's prediction.
  assert.equal(grainHash(3, 5, 7, 11), 2967493665)
})

test('grain animates: consecutive frames differ, and so do two clips on one frame', () => {
  let sameFrame = 0
  let sameSeed = 0
  for (let x = 0; x < 256; x += 1) {
    if (grainValue(x, 0, 10, 1) === grainValue(x, 0, 11, 1)) sameFrame += 1
    if (grainValue(x, 0, 10, grainSeed('a')) === grainValue(x, 0, 10, grainSeed('b'))) sameSeed += 1
  }
  assert.ok(sameFrame < 4, `${sameFrame}/256 cells identical across frames`)
  assert.ok(sameSeed < 4, `${sameSeed}/256 cells identical across clips`)
})

test('grain is zero-mean and bounded', () => {
  let sum = 0
  let min = Infinity
  let max = -Infinity
  const n = 200_000
  for (let i = 0; i < n; i += 1) {
    const v = grainValue(i % 500, Math.floor(i / 500), 3, 17)
    sum += v
    min = Math.min(min, v)
    max = Math.max(max, v)
  }
  assert.ok(Math.abs(sum / n) < 0.005, `mean ${sum / n}`)
  assert.ok(min >= -0.5 && max <= 0.5)
})

// -- LUT payload ---------------------------------------------------------------

test('LUT data survives the 16-bit round trip to within one step', () => {
  const values = new Float32Array(2 ** 3 * 3).map((_, i) => (i * 0.037) % 1)
  const decoded = decodeLutData({ size: 2, title: null, domainMin: [0, 0, 0], domainMax: [1, 1, 1], data: encodeLutData(values) })
  assert.ok(decoded)
  for (let i = 0; i < values.length; i += 1) {
    assert.ok(Math.abs((decoded[i] as number) - (values[i] as number)) <= 1 / 65535 + 1e-7)
  }
})

test('a payload of the wrong length decodes to null rather than to a short table', () => {
  const data = encodeLutData(new Float32Array(2 ** 3 * 3))
  assert.equal(decodeLutData({ size: 3, title: null, domainMin: [0, 0, 0], domainMax: [1, 1, 1], data }), null)
  assert.equal(decodeLutData({ size: 2, title: null, domainMin: [0, 0, 0], domainMax: [1, 1, 1], data: '!!!' }), null)
})
