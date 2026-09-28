import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  angleDelta,
  faderDb,
  faderPosition,
  foldAngle,
  knobAngle,
  knobDragValue,
  pointerAngle,
  faderStep,
  parseDb,
  positionDragScale,
  FADER_UNITY
} from './dial'
import { committable } from './values'
import { balanceOf } from './wheel'

// The mixer's own range: −60 dB floor, +6.02 dB (gain 2) top — `VOLUME_DB_FLOOR`/`MAX_VOLUME_DB`.
const FLOOR = -60
const MAX = 20 * Math.log10(2)

test('unity sits three quarters up, the floor at the bottom (−∞) and the maximum at the top', () => {
  assert.equal(faderPosition(0, FLOOR, MAX), FADER_UNITY)
  assert.equal(FADER_UNITY, 0.75)
  assert.equal(faderPosition(FLOOR, FLOOR, MAX), 0)
  assert.equal(faderPosition(Number.NEGATIVE_INFINITY, FLOOR, MAX), 0)
  assert.equal(faderPosition(MAX, FLOOR, MAX), 1)
  assert.equal(faderDb(0, FLOOR, MAX), Number.NEGATIVE_INFINITY)
  assert.equal(faderDb(1, FLOOR, MAX), MAX)
})

test('the taper is logarithmic: more travel near unity than a fader linear in dB', () => {
  // Linear in dB, −6 would sit at 90% of the way from floor to unity; the taper puts it lower,
  // leaving the top of the travel for fine moves around 0 dB.
  const linearMinus6 = (FLOOR - -6) / FLOOR
  const taperedMinus6 = faderPosition(-6, FLOOR, MAX) / FADER_UNITY
  assert.ok(taperedMinus6 < linearMinus6, `${taperedMinus6} < ${linearMinus6}`)
  // The same travel buys fewer dB near unity than near the floor.
  const nearUnity = faderDb(0.7, FLOOR, MAX) - faderDb(0.65, FLOOR, MAX)
  const nearFloor = faderDb(0.1, FLOOR, MAX) - faderDb(0.05, FLOOR, MAX)
  assert.ok(nearUnity < nearFloor, `${nearUnity} < ${nearFloor}`)
  // And it is monotonic: every higher position is a louder level.
  let last = Number.NEGATIVE_INFINITY
  for (let p = 0.01; p <= 1; p += 0.01) {
    const db = faderDb(p, FLOOR, MAX)
    assert.ok(db > last, `position ${p}`)
    last = db
  }
})

test('taper round trip: dB → position → dB is exact across the range', () => {
  for (let db = FLOOR + 0.5; db <= MAX; db += 0.25) {
    const back = faderDb(faderPosition(db, FLOOR, MAX), FLOOR, MAX)
    assert.ok(Math.abs(back - db) < 1e-9, `${db} came back as ${back}`)
  }
  for (let p = 0.005; p < 1; p += 0.005) {
    const back = faderPosition(faderDb(p, FLOOR, MAX), FLOOR, MAX)
    assert.ok(Math.abs(back - p) < 1e-9, `${p} came back as ${back}`)
  }
})

test('store-sourced NaN: a fader, knob, dial or wheel step from NaN commits nothing', () => {
  const nan = Number.NaN
  // Fader (track.volume = NaN → dB NaN): a step down used to return the NaN itself.
  assert.equal(committable(faderStep(nan, -0.5, FLOOR, MAX), true), null)
  assert.equal(committable(faderStep(nan, 0.5, FLOOR, MAX), true), null)
  // Knob and AngleDial (pan / rotation NaN): their drag arithmetic keeps the NaN.
  assert.equal(committable(knobDragValue(nan, 10, -10, -1, 1, 160, 1)), null)
  assert.equal(committable(nan + angleDelta(10, 40)), null)
  // ColorWheel: a NaN channel makes a NaN master.
  assert.equal(committable(balanceOf({ r: nan, g: 0, b: 0 }).master), null)
  // Positive controls: finite values step and commit, and a fader's −∞ is a level it may write.
  assert.equal(committable(faderStep(-6, -0.5, FLOOR, MAX), true), -6.5)
  assert.equal(committable(faderStep(Number.NEGATIVE_INFINITY, -0.5, FLOOR, MAX), true), Number.NEGATIVE_INFINITY)
  assert.equal(faderStep(Number.NEGATIVE_INFINITY, 0.5, FLOOR, MAX), FLOOR + 0.5)
  assert.equal(faderStep(MAX, 0.5, FLOOR, MAX), MAX)
})

test('a typed level reads the ways a person writes one', () => {
  assert.equal(parseDb('-6'), -6)
  assert.equal(parseDb('−6'), -6)
  assert.equal(parseDb('+2.5'), 2.5)
  assert.equal(parseDb('-6 dB'), -6)
  assert.equal(parseDb('-inf'), Number.NEGATIVE_INFINITY)
  assert.equal(parseDb('−∞'), Number.NEGATIVE_INFINITY)
  assert.equal(parseDb('loud'), null)
  assert.equal(parseDb(''), null)
})

test('a position-mapped drag is fine with any modifier, Shift included', () => {
  assert.equal(positionDragScale({ shift: false, alt: false, meta: false }), 1)
  assert.equal(positionDragScale({ shift: true, alt: false, meta: false }), 0.1)
  assert.equal(positionDragScale({ shift: false, alt: true, meta: false }), 0.1)
  assert.equal(positionDragScale({ shift: false, alt: false, meta: true }), 0.1)
})

test('a knob sweeps 270°: min at −135°, centre straight up, max at +135°', () => {
  assert.equal(knobAngle(-1, -1, 1), -135)
  assert.equal(knobAngle(0, -1, 1), 0)
  assert.equal(knobAngle(1, -1, 1), 135)
  // Past the ends it stays at the ends.
  assert.equal(knobAngle(4, -1, 1), 135)
})

test('a knob drag: up and right increase, down and left decrease', () => {
  // 160px of travel is the whole range.
  assert.equal(knobDragValue(0, 0, -80, -1, 1, 160, 1), 1)
  assert.equal(knobDragValue(0, 80, 0, -1, 1, 160, 1), 1)
  assert.equal(knobDragValue(0, 0, 80, -1, 1, 160, 1), -1)
  assert.equal(knobDragValue(0, -40, 0, -1, 1, 160, 0.1), -0.05)
})

test('pointer angles read clockwise from straight up, with screen y downward', () => {
  assert.equal(pointerAngle(0, -10), 0)
  assert.equal(pointerAngle(10, 0), 90)
  assert.equal(pointerAngle(-10, 0), -90)
  assert.equal(Math.abs(pointerAngle(0, 10)), 180)
})

test('a circular drag across straight down keeps counting instead of jumping a turn', () => {
  assert.equal(angleDelta(170, -170), 20)
  assert.equal(angleDelta(-170, 170), -20)
  assert.equal(angleDelta(10, 30), 20)
  // Two full turns clockwise in 30° steps accumulate to 720.
  let turned = 0
  let at = 0
  for (let i = 0; i < 24; i += 1) {
    const next = foldAngle(at + 30)
    turned += angleDelta(at, next)
    at = next
  }
  assert.equal(turned, 720)
})

test('an angle folds into −180…180 for drawing and keeps its direction', () => {
  assert.equal(foldAngle(720), 0)
  assert.equal(foldAngle(450), 90)
  assert.equal(foldAngle(-450), -90)
  assert.equal(foldAngle(180), 180)
  assert.equal(foldAngle(-180), 180)
  assert.equal(foldAngle(Number.NaN), 0)
})
