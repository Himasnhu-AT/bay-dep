import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  EASES,
  EASE_T80,
  bezier,
  clamp,
  easeOf,
  easeTime,
  lerp,
  progress,
  rng,
  smooth,
  smoother,
  spline,
  spring,
  springOvershoot,
  springSpeed,
  springTimed,
  velocity,
  type EaseName
} from './core'
import { matApply, matCanvas, matCss, matIdentity, matInvert, matMultiply, matRotate, matScale, matTranslate } from './matrix'

const near = (actual: number, expected: number, eps: number, what: string): void =>
  assert.ok(Math.abs(actual - expected) <= eps, `${what}: ${actual} is not within ${eps} of ${expected}`)

test('progress runs 0 to 1 across a span and a span of no length is a step', () => {
  assert.equal(progress(0.9, 1, 3), 0)
  assert.equal(progress(2, 1, 3), 0.5)
  assert.equal(progress(9, 1, 3), 1)
  assert.equal(progress(0.99, 1, 1), 0)
  assert.equal(progress(1, 1, 1), 1)
  assert.equal(clamp(7, 2, 5), 5)
  assert.equal(clamp(-1), 0)
})

test('lerp is exactly its ends, which the one-multiply form is not', () => {
  // A pair for which a + (b - a) * 1 misses b, so this cannot pass by the two forms agreeing.
  // (Going from a large number to a small one: the subtraction rounds away the small one's low bits.)
  const random = rng(7)
  let a = 0
  let b = 0
  for (let i = 0; i < 10000 && a + (b - a) === b; i++) {
    a = random() * 1000
    // Divided by 3 so it is not a short binary fraction, which `a`'s precision would hold exactly.
    b = random() / 3
  }
  assert.notEqual(a + (b - a), b, 'no specimen found that defeats the naive form')
  assert.equal(lerp(a, b, 1), b)
  assert.equal(lerp(a, b, 0), a)
})

test('the smooth steps start and end flat', () => {
  for (const f of [smooth, smoother]) {
    assert.equal(f(0), 0)
    assert.equal(f(1), 1)
    assert.equal(f(-3), 0)
    assert.equal(f(3), 1)
    near(f(0.5), 0.5, 1e-12, 'midpoint')
    assert.ok(f(0.001) < 0.001 && 1 - f(0.999) < 0.001, 'slope at the ends is not below linear')
  }
})

test('rng: the same seed is the same sequence, another seed is another', () => {
  const a = rng(42)
  const b = rng(42)
  const c = rng(43)
  const as = Array.from({ length: 50 }, () => a())
  const bs = Array.from({ length: 50 }, () => b())
  const cs = Array.from({ length: 50 }, () => c())
  assert.deepEqual(as, bs)
  assert.notDeepEqual(as, cs)
  assert.ok(as.every((v) => v >= 0 && v < 1))
  assert.ok(new Set(as).size === 50, 'the sequence repeats')
})

test('every ease is exact at both ends, and its t80 is what the curve measures', () => {
  const names = Object.keys(EASES) as EaseName[]
  assert.deepEqual(Object.keys(EASE_T80).sort(), [...names].sort(), 'EASE_T80 and EASES name different curves')
  for (const name of names) {
    const f = EASES[name]
    assert.equal(f(0), 0, `${name}(0)`)
    assert.equal(f(1), 1, `${name}(1)`)
    // Measured here, by a scan of its own, rather than with the library's `easeTime`.
    const steps = 200000
    let crossed = 1
    for (let i = 0; i <= steps; i++) {
      if (f(i / steps) >= 0.8) {
        crossed = i / steps
        break
      }
    }
    near(EASE_T80[name], crossed, 5e-4, `EASE_T80.${name}`)
    near(easeTime(name), crossed, 5e-4, `easeTime(${name})`)
  }
})

test('the table has snappy curves and says which they are', () => {
  for (const name of ['expoOut', 'quintOut'] as const) assert.ok(EASE_T80[name] < 0.3, `${name} is not snappy`)
  for (const name of ['expoInOut', 'quintInOut', 'sineInOut'] as const) assert.ok(name in EASES)
  assert.ok(EASE_T80.expoInOut < EASE_T80.quintInOut && EASE_T80.quintInOut < EASE_T80.sineInOut, 'the in-outs are not ordered by snap')
  assert.equal(EASE_T80.linear, 0.8)
})

test('easeOf takes a name, four bezier numbers or a function, and an unknown name lists the real ones', () => {
  assert.equal(easeOf('expoOut'), EASES.expoOut)
  const own = (p: number): number => p * p
  assert.equal(easeOf(own), own)
  near(easeOf([0, 0, 1, 1])(0.37), 0.37, 1e-6, 'a linear bezier')
  near(bezier(0.42, 0, 0.58, 1)(0.5), 0.5, 1e-6, 'ease-in-out at its middle')
  assert.equal(bezier(0.2, 0.8, 0.2, 1)(0), 0)
  assert.equal(bezier(0.2, 0.8, 0.2, 1)(1), 1)
  assert.throws(() => easeOf('snappy' as never), (error: Error) => error.message.includes('expoOut') && error.message.includes('"snappy"'))
})

const REGIMES = [0.25, 0.6, 0.999999, 1, 1.000001, 1.6]

test('a spring is 0 at and before its start and settles at 1, in every damping regime', () => {
  for (const damping of REGIMES) {
    for (const tau of [-5, -0.001, 0]) assert.equal(spring(tau, { damping, frequency: 14 }), 0, `ζ=${damping} at tau=${tau}`)
    near(spring(10, { damping, frequency: 14 }), 1, 1e-6, `ζ=${damping} settled`)
  }
})

test('a spring obeys the spring equation: x″ + 2ζω x′ + ω² x = ω²', () => {
  const h = 1e-4
  for (const damping of REGIMES) {
    const o = { damping, frequency: 11 }
    for (const tau of [0.05, 0.2, 0.5, 1.1]) {
      const x = spring(tau, o)
      const x1 = (spring(tau + h, o) - spring(tau - h, o)) / (2 * h)
      const x2 = (spring(tau + h, o) - 2 * x + spring(tau - h, o)) / (h * h)
      near(x2 + 2 * damping * 11 * x1 + 121 * x, 121, 0.02, `ζ=${damping} at tau=${tau}`)
      near(springSpeed(tau, o), x1, 1e-4, `springSpeed ζ=${damping} at tau=${tau}`)
    }
  }
})

test('the three damping regimes meet: just under, at and just over ζ = 1 are the same curve', () => {
  for (const tau of [0.03, 0.1, 0.3, 0.8]) {
    const at = spring(tau, { damping: 1, frequency: 14 })
    near(spring(tau, { damping: 0.999999, frequency: 14 }), at, 1e-4, `under at ${tau}`)
    near(spring(tau, { damping: 1.000001, frequency: 14 }), at, 1e-4, `over at ${tau}`)
  }
})

test('below ζ = 1 a spring overshoots by springOvershoot; from 1 up it never passes 1', () => {
  const peak = (damping: number): number => {
    let top = 0
    for (let i = 0; i <= 20000; i++) top = Math.max(top, spring(i / 5000, { damping, frequency: 14 }))
    return top
  }
  for (const damping of [0.25, 0.5, 0.7]) {
    assert.ok(peak(damping) > 1.001, `ζ=${damping} did not overshoot`)
    near(springOvershoot(damping), peak(damping) - 1, 1e-4, `overshoot at ζ=${damping}`)
  }
  for (const damping of [1, 1.6]) {
    assert.ok(peak(damping) <= 1, `ζ=${damping} overshot`)
    assert.equal(springOvershoot(damping), 0)
  }
})

test('springTimed: bounce 0 does not overshoot, bounce does, and half the duration is twice as fast', () => {
  const reach = (o: { duration: number; bounce: number }): number => {
    for (let i = 0; i <= 40000; i++) if (springTimed(i / 10000, o) >= 0.9) return i / 10000
    return Infinity
  }
  let top = 0
  let bouncy = 0
  for (let i = 0; i <= 20000; i++) {
    top = Math.max(top, springTimed(i / 5000, { duration: 0.5, bounce: 0 }))
    bouncy = Math.max(bouncy, springTimed(i / 5000, { duration: 0.5, bounce: 0.3 }))
  }
  assert.ok(top <= 1)
  assert.ok(bouncy > 1.01)
  assert.equal(springTimed(0), 0)
  near(reach({ duration: 0.25, bounce: 0 }), reach({ duration: 0.5, bounce: 0 }) / 2, 2e-4, 'time to 90%')
})

test('a spline passes through each knot at its time and holds its ends', () => {
  const knots = [
    { t: 0, x: 100, y: 100 },
    { t: 0.4, x: 600, y: 180 },
    { t: 1.9, x: 640, y: 700 },
    { t: 2.0, x: 1200, y: 500 }
  ]
  for (const k of knots) assert.deepEqual(spline(knots, k.t), [k.x, k.y])
  assert.deepEqual(spline(knots, -1), [100, 100])
  assert.deepEqual(spline(knots, 9), [1200, 500])
  // Smooth: a millisecond moves it a little, everywhere, including across a knot.
  for (let t = 0; t < 2; t += 0.0137) {
    const a = spline(knots, t)
    const b = spline(knots, t + 0.001)
    assert.ok(Number.isFinite(a[0]) && Number.isFinite(a[1]))
    assert.ok(Math.hypot(b[0] - a[0], b[1] - a[1]) < 30, `a jump of ${Math.hypot(b[0] - a[0], b[1] - a[1])} px at ${t}`)
  }
  assert.deepEqual(spline([{ t: 1, x: 5, y: 6 }], 3), [5, 6])
  assert.throws(() => spline([], 0), /at least one knot/)
})

test('a spline between two knots on a line stays on the line', () => {
  const knots = [
    { t: 0, x: 0, y: 0 },
    { t: 1, x: 100, y: 50 },
    { t: 2, x: 200, y: 100 }
  ]
  for (let t = 0; t <= 2; t += 0.05) {
    const [x, y] = spline(knots, t)
    near(y, x / 2, 1e-9, `off the line at ${t}`)
  }
})

test('velocity is the speed of a moving point', () => {
  const [vx, vy] = velocity((t) => [300 * t, 40 - 120 * t], 2)
  near(vx, 300, 1e-6, 'vx')
  near(vy, -120, 1e-6, 'vy')
})

test('matrices: order of multiplication, inverse, and the two ways out', () => {
  // Scale then translate is not translate then scale; matMultiply(A, B) applies B first.
  assert.deepEqual(matApply(matMultiply(matTranslate(10, 0), matScale(2)), 3, 4), [16, 8])
  assert.deepEqual(matApply(matMultiply(matScale(2), matTranslate(10, 0)), 3, 4), [26, 8])
  assert.deepEqual(matApply(matMultiply(matTranslate(1, 1), matScale(2), matTranslate(10, 0)), 3, 4), [27, 9])
  const [rx, ry] = matApply(matRotate(90), 1, 0)
  near(rx, 0, 1e-12, 'rotate x')
  near(ry, 1, 1e-12, 'a quarter turn takes +x to +y (clockwise on a y-down screen)')
  const m = matMultiply(matTranslate(40, -7), matRotate(33), matScale(1.7, 0.6))
  const [x, y] = matApply(matInvert(m), ...matApply(m, 12, 34))
  near(x, 12, 1e-9, 'inverse x')
  near(y, 34, 1e-9, 'inverse y')
  assert.deepEqual(matMultiply(m, matIdentity()), m)
  assert.equal(matCss([1, 0, 0, 1, 5, 6]), 'matrix(1,0,0,1,5,6)')
  assert.deepEqual(matCanvas([1, 0, 0, 2, 5, 6], 2), [2, 0, 0, 4, 10, 12])
  assert.deepEqual(matCanvas([1, 0, 0, 2, 5, 6]), [1, 0, 0, 2, 5, 6])
  assert.throws(() => matInvert(matScale(0)), /no inverse/)
})
