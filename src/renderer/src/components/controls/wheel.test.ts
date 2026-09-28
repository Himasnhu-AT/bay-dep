import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  balanceOf,
  clampWheel,
  describeWheel,
  puckPixels,
  wheelFromBalance,
  withBalance,
  withMaster,
  WHEEL_AXES_DEG,
  type WheelRgb
} from './wheel'

const close = (a: number, b: number, tolerance = 1e-12): boolean => Math.abs(a - b) <= tolerance
const sameWheel = (a: WheelRgb, b: WheelRgb, tolerance = 1e-12): boolean =>
  close(a.r, b.r, tolerance) && close(a.g, b.g, tolerance) && close(a.b, b.b, tolerance)

/**
 * The averaged slider this wheel's strip replaces, copied from `GradeSection.setWheel` as it was at
 * ab78d03 — a literal, so a change to `withMaster` cannot move it along.
 */
function oldSetWheel(w: WheelRgb | undefined, value: number, min: number, max: number): WheelRgb {
  const mean = w ? (w.r + w.g + w.b) / 3 : 0
  const delta = value - mean
  const current = w ?? { r: 0, g: 0, b: 0 }
  const clamp = (v: number): number => Math.min(max, Math.max(min, v))
  return { r: clamp(current.r + delta), g: clamp(current.g + delta), b: clamp(current.b + delta) }
}

/** A deterministic spread of wheel values, casts and levels both. */
function specimens(): WheelRgb[] {
  const out: WheelRgb[] = [
    { r: 0, g: 0, b: 0 },
    { r: 0.1, g: 0.1, b: 0.1 },
    { r: 0.05, g: -0.02, b: 0.3 },
    { r: -0.9, g: 0.4, b: 1.2 },
    { r: 3.5, g: 3.9, b: -0.7 }
  ]
  let seed = 7
  const rand = (): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
  for (let i = 0; i < 200; i += 1) out.push({ r: rand() * 4 - 1, g: rand() * 4 - 1, b: rand() * 4 - 1 })
  return out
}

test('the master is the mean of r, g and b — the value the averaged slider showed', () => {
  assert.equal(balanceOf({ r: 0.3, g: 0, b: -0.3 }).master, 0)
  assert.ok(close(balanceOf({ r: 0.1, g: 0.2, b: 0.6 }).master, 0.3))
  assert.deepEqual(balanceOf(undefined), { master: 0, x: 0, y: 0 })
  // Equal channels are a level, not a cast: the puck stays in the centre.
  const level = balanceOf({ r: 0.2, g: 0.2, b: 0.2 })
  assert.ok(close(level.x, 0) && close(level.y, 0))
})

test('round trip: every stored wheel comes back exactly from its master and puck', () => {
  // This is what keeps an existing project's grade meaning the same: reading a wheel and writing
  // back what was read changes nothing.
  for (const w of specimens()) {
    const back = wheelFromBalance(balanceOf(w))
    assert.ok(sameWheel(back, w, 1e-12), `${JSON.stringify(w)} came back ${JSON.stringify(back)}`)
  }
})

test('the strip moves the level exactly as the averaged slider did, keeping the cast', () => {
  const ranges = [
    { min: -1, max: 1 },
    { min: -0.9, max: 4 },
    { min: -1, max: 4 }
  ]
  for (const w of [undefined, ...specimens()]) {
    for (const { min, max } of ranges) {
      for (const value of [-0.5, 0, 0.037, 0.8]) {
        assert.deepEqual(withMaster(w, value, min, max), oldSetWheel(w, value, min, max))
      }
    }
  }
  // …and inside the range, the cast is untouched.
  const cast = { r: 0.1, g: -0.05, b: -0.05 }
  const moved = balanceOf(withMaster(cast, 0.2, -1, 1))
  const before = balanceOf(cast)
  assert.ok(close(moved.x, before.x) && close(moved.y, before.y))
  assert.ok(close(moved.master, 0.2))
})

test('the puck moves the cast, keeping the level', () => {
  const w = { r: 0.2, g: 0.1, b: 0.3 }
  const next = balanceOf(withBalance(w, 0.05, -0.02, -1, 4))
  assert.ok(close(next.master, balanceOf(w).master))
  assert.ok(close(next.x, 0.05) && close(next.y, -0.02))
  // Centring the puck leaves a pure level: all three channels at the old mean.
  const centred = withBalance(w, 0, 0, -1, 4)
  assert.ok(sameWheel(centred, { r: 0.2, g: 0.2, b: 0.2 }))
})

test('a red cast points the puck toward the red axis, blue toward blue', () => {
  const toward = (w: WheelRgb): number => {
    const { x, y } = balanceOf(w)
    return ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360
  }
  assert.ok(close(toward({ r: 0.2, g: 0, b: 0 }), WHEEL_AXES_DEG.r, 1e-9))
  assert.ok(close(toward({ r: 0, g: 0, b: 0.2 }), WHEEL_AXES_DEG.b, 1e-9))
  assert.ok(close(toward({ r: 0, g: 0.2, b: 0 }), WHEEL_AXES_DEG.g, 1e-9))
})

test('channels are held to the range, one by one', () => {
  assert.deepEqual(clampWheel({ r: 5, g: -2, b: 0.5 }, -1, 4), { r: 4, g: -1, b: 0.5 })
})

test('the puck stops at the rim however strong the cast', () => {
  const inside = puckPixels({ x: 0.1, y: 0 }, 30, 0.25)
  assert.ok(close(inside.left, 42) && close(inside.top, 30))
  const far = puckPixels({ x: 0, y: 10 }, 30, 0.25)
  assert.ok(close(far.left, 30) && close(far.top, 0))
})

test('a wheel is spoken channel by channel, signed', () => {
  assert.equal(describeWheel({ r: 0.02, g: -0.01, b: 0 }), 'red +0.020, green −0.010, blue 0.000')
})
