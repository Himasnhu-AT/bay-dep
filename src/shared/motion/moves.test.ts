import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as BM from './index'
import type { Point } from './core'

const near = (actual: number, expected: number, eps: number, what: string): void =>
  assert.ok(Math.abs(actual - expected) <= eps, `${what}: ${actual} is not within ${eps} of ${expected}`)

/** Times across a span, for scanning a move. */
const times = (t0: number, t1: number, n = 400): number[] => Array.from({ length: n + 1 }, (_, i) => t0 + ((t1 - t0) * i) / n)

/**
 * Two numbers the naive `a + (b - a) * 1` does not return to `b` for — so exact endpoints are a
 * real claim. Large to small, because that subtraction rounds away the small one's low bits.
 */
function awkwardPair(seed: number): [number, number] {
  const random = BM.rng(seed)
  for (let i = 0; i < 100000; i++) {
    const a = random() * 2000
    // Divided by 7 so it is not a short binary fraction, which `a`'s precision would hold exactly.
    const b = random() / 7
    if (a + (b - a) !== b) return [a, b]
  }
  throw new Error('no specimen found')
}

// ---------------------------------------------------------------------------
// enter
// ---------------------------------------------------------------------------

test('wordLand: nothing before its time, at rest after, and opaque long before the spring settles', () => {
  assert.deepEqual(BM.wordLand(0.99, 1), { op: 0, y: 36, s: 0.86 })
  const rest = BM.wordLand(6, 1)
  assert.equal(rest.op, 1)
  near(rest.y, 0, 1e-6, 'y at rest')
  near(rest.s, 1, 1e-6, 's at rest')
  // The moment it is fully opaque, it still has most of its landing to do: not a fade.
  const opaqueAt = times(1, 2, 2000).find((t) => BM.wordLand(t, 1).op === 1)!
  const landed = 1 - BM.wordLand(opaqueAt, 1).y / 36
  assert.ok(landed < 0.75, `opacity finished with the landing ${Math.round(landed * 100)}% done`)
  assert.ok(times(1, 2).some((t) => BM.wordLand(t, 1).y < 0), 'the landing never overshoots, so it reads as an ease')
})

test('letterFall: letters go in turn, squash as they land, and end at rest', () => {
  const early = 2 + 0.05
  assert.ok(BM.letterFall(early, 2, 0).op > 0)
  assert.equal(BM.letterFall(early, 2, 3).op, 0)
  assert.equal(BM.letterFall(early, 2, 3).y, -120)
  let flattest = 1
  let widest = 1
  let tallest = 1
  for (const t of times(2, 4, 4000)) {
    const m = BM.letterFall(t, 2, 0, { squash: 0.3 })
    flattest = Math.min(flattest, m.sy)
    tallest = Math.max(tallest, m.sy)
    widest = Math.max(widest, m.sx)
  }
  near(flattest, 0.7, 0.005, 'the deepest squash is `squash` of the height')
  assert.ok(widest > 1.3, 'it does not widen as it flattens')
  assert.ok(tallest > 1.02, 'it does not stretch while falling')
  const rest = BM.letterFall(9, 2, 5)
  near(rest.y, 0, 1e-6, 'y')
  near(rest.sx, 1, 1e-6, 'sx')
  near(rest.sy, 1, 1e-6, 'sy')
  assert.equal(rest.op, 1)
  // No step where the stretch hands over to the squash: a millisecond never changes sy by much.
  let jump = 0
  for (const t of times(2, 3, 5000)) jump = Math.max(jump, Math.abs(BM.letterFall(t + 0.0002, 2, 0).sy - BM.letterFall(t, 2, 0).sy))
  assert.ok(jump < 0.01, `sy steps by ${jump} in a fifth of a millisecond`)
})

test('cardPop arrives and rests; cardLift is at rest until its time and then gone', () => {
  assert.equal(BM.cardPop(0.5, 1).op, 0)
  const up = BM.cardPop(8, 1)
  assert.equal(up.op, 1)
  near(up.s, 1, 1e-6, 'pop scale')
  near(up.dy, 0, 1e-6, 'pop offset')
  assert.deepEqual(BM.cardLift(2.999, 3), { op: 1, s: 1, dy: 0, blur: 0 })
  const gone = BM.cardLift(3.5, 3)
  assert.equal(gone.op, 0)
  assert.equal(gone.dy, -40)
  near(gone.s, 1.04, 1e-12, 'lift scale')
  assert.equal(gone.blur, 8)
  const half = BM.cardLift(3.14, 3)
  assert.ok(half.op > 0 && half.op < 1 && half.dy < 0 && half.dy > -40)
})

test('lineReveal: each line waits below its mask for its turn, rises, and never fades', () => {
  assert.deepEqual(BM.lineReveal(0.9, 1, 0), { y: 110, visible: false })
  assert.deepEqual(BM.lineReveal(1.05, 1, 1), { y: 110, visible: false })
  assert.equal(BM.lineReveal(1.05, 1, 0).visible, true)
  assert.deepEqual(BM.lineReveal(5, 1, 2), { y: 0, visible: true })
  let last = Infinity
  for (const t of times(1, 2)) {
    const { y } = BM.lineReveal(t, 1, 0)
    assert.ok(y <= last + 1e-12, 'the line moved back down')
    last = y
  }
})

test('typeOn types at a steady rate, whole characters, with a caret that is solid while typing', () => {
  const text = 'make it move'
  for (let k = 0; k <= text.length; k++) {
    const typed = BM.typeOn(1 + k / 20, 1, text, { cps: 20 })
    assert.equal(typed.n, k, `after ${k} character-times`)
    assert.equal(typed.str, text.slice(0, k))
    assert.equal(typed.done, k === text.length)
  }
  assert.deepEqual(BM.typeOn(0, 1, text), { n: 0, str: '', done: false, caret: BM.typeOn(0, 1, text).caret })
  const end = 1 + text.length / 20
  for (const t of times(1, end - 0.001, 300)) assert.equal(BM.typeOn(t, 1, text, { cps: 20 }).caret, true, `caret off while typing at ${t}`)
  const after = times(end, end + 3, 600).map((t) => BM.typeOn(t, 1, text, { cps: 20 }).caret)
  assert.equal(after[0], true, 'the caret is on the moment typing stops')
  assert.ok(after.includes(false) && after.includes(true), 'the caret does not blink once typing is done')
  // An emoji is one character, not two halves.
  assert.equal(BM.typeOn(1 + 2 / 20, 1, 'a😀b', { cps: 20 }).str, 'a😀')
})

test('checkTick flips at its time and pops from its small scale to 1', () => {
  assert.deepEqual(BM.checkTick(0.99, 1), { on: false, s: 0.8 })
  assert.equal(BM.checkTick(1, 1).on, true)
  near(BM.checkTick(5, 1).s, 1, 1e-6, 'settled')
  assert.ok(times(1, 2).some((t) => BM.checkTick(t, 1).s > 1.005), 'the tick does not pop past 1')
})

// ---------------------------------------------------------------------------
// carry
// ---------------------------------------------------------------------------

test('rectMorph is exactly the first rect at the start and exactly the second at the end', () => {
  const [ax, bx] = awkwardPair(1)
  const [ay, by] = awkwardPair(2)
  const [aw, bw] = awkwardPair(3)
  const [ah, bh] = awkwardPair(4)
  const [ar, br] = awkwardPair(5)
  const A = { x: ax, y: ay, w: aw, h: ah, r: ar }
  const B = { x: bx, y: by, w: bw, h: bh, r: br }
  for (const t of [-1, 2]) {
    const m = BM.rectMorph(t, 2, 3, A, B)
    assert.deepEqual({ x: m.x, y: m.y, w: m.w, h: m.h, r: m.r }, A, `at t=${t}`)
    assert.equal(m.p, 0)
  }
  for (const t of [3, 40]) {
    const m = BM.rectMorph(t, 2, 3, A, B)
    assert.deepEqual({ x: m.x, y: m.y, w: m.w, h: m.h, r: m.r }, B, `at t=${t}`)
    assert.equal(m.cx, B.x + B.w / 2)
    assert.equal(m.cy, B.y + B.h / 2)
  }
  const mid = BM.rectMorph(2.5, 2, 3, A, B, { curve: 'linear' })
  near(mid.w, (aw + bw) / 2, 1e-9, 'halfway width')
  near(mid.r, (ar + br) / 2, 1e-9, 'halfway radius')
  // No radius given is square, on either side.
  assert.equal(BM.rectMorph(2.5, 2, 3, { x: 0, y: 0, w: 1, h: 1 }, { x: 0, y: 0, w: 9, h: 9, r: 10 }, { curve: 'linear' }).r, 5)
})

test('iris reports covered only when its circle really contains all four corners of the frame', () => {
  const frames = [undefined, { w: 1080, h: 1920 }]
  const centres: Point[] = [[300, 800], [960, 540], [1900, 20], [-50, 400]]
  for (const frame of frames) {
    const f = frame ?? BM.FRAME
    for (const [cx, cy] of centres) {
      let sawOpen = false
      for (const t of times(1, 2, 1000)) {
        const { r, covered } = BM.iris(t, 1, 2, cx, cy, { frame })
        const contains = [[0, 0], [f.w, 0], [0, f.h], [f.w, f.h]].every(([x, y]) => Math.hypot(x! - cx, y! - cy) <= r)
        assert.equal(covered, contains, `at t=${t} from (${cx}, ${cy}): r=${r}`)
        if (!covered) sawOpen = true
      }
      assert.ok(sawOpen, 'never reported uncovered, so the check above proved nothing')
      // The positive control: it does finish covered, and stays so.
      assert.equal(BM.iris(2, 1, 2, cx, cy, { frame }).covered, true)
      assert.equal(BM.iris(7, 1, 2, cx, cy, { frame }).covered, true)
    }
  }
  assert.equal(BM.iris(0, 1, 2, 300, 800, { from: 44 }).r, 44)
})

test('pushInto ends with the target filling the frame, and starts as nothing at all', () => {
  const target = { x: 1210, y: 640, w: 320, h: 180 }
  assert.deepEqual(BM.pushInto(1, 1, 2, target).matrix, [1, 0, 0, 1, 0, 0])
  const done = BM.pushInto(2, 1, 2, target)
  const corner = (x: number, y: number): Point => BM.matApply(done.matrix, x, y)
  const [x0, y0] = corner(target.x, target.y)
  const [x1, y1] = corner(target.x + target.w, target.y + target.h)
  near(x0, 0, 1e-6, 'left edge')
  near(y0, 0, 1e-6, 'top edge')
  near(x1, 1920, 1e-6, 'right edge')
  near(y1, 1080, 1e-6, 'bottom edge')
  near(done.s, 6, 1e-9, 'final scale')
})

test('pushInto: a target of another shape covers the frame, or with fit contain sits inside it, centred', () => {
  const tall = { x: 200, y: 100, w: 200, h: 600 }
  for (const fit of ['cover', 'contain'] as const) {
    const { matrix } = BM.pushInto(5, 1, 2, tall, { fit })
    const [x0, y0] = BM.matApply(matrix, tall.x, tall.y)
    const [x1, y1] = BM.matApply(matrix, tall.x + tall.w, tall.y + tall.h)
    near((x0 + x1) / 2, 960, 1e-6, `${fit}: centred across`)
    near((y0 + y1) / 2, 540, 1e-6, `${fit}: centred down`)
    if (fit === 'cover') assert.ok(x0 <= 1e-6 && y0 <= 1e-6 && x1 >= 1920 - 1e-6 && y1 >= 1080 - 1e-6, 'cover leaves a gap')
    else assert.ok(x0 >= -1e-6 && y0 >= -1e-6 && x1 <= 1920 + 1e-6 && y1 <= 1080 + 1e-6, 'contain spills out of the frame')
  }
})

test('pushInto zooms in log space along straight lines from one vanishing point', () => {
  const target = { x: 1210, y: 640, w: 320, h: 180 }
  // On a linear curve, halfway in time is the geometric middle of the scale: sqrt(1 × 6), not 3.5.
  near(BM.pushInto(1.5, 1, 2, target, { curve: 'linear' }).s, Math.sqrt(6), 1e-9, 'scale halfway')
  const at = (t: number): Point => BM.matApply(BM.pushInto(t, 1, 2, target).matrix, 400, 300)
  const [ax, ay] = at(1)
  const [bx, by] = at(1.6)
  const [cx, cy] = at(2)
  near((bx - ax) * (cy - ay) - (by - ay) * (cx - ax), 0, 1e-3, 'a point left its straight line')
  // A target the size of the frame is a slide, not a zoom.
  const slide = BM.pushInto(2, 1, 2, { x: 500, y: -200, w: 1920, h: 1080 })
  near(slide.s, 1, 1e-12, 'slide scale')
  assert.deepEqual([slide.tx, slide.ty], [-500, 200])
})

test('arcHop leaves from one slot, lands on the other, and peaks its height above the midpoint', () => {
  const from: Point = [200, 800]
  const to: Point = [900, 760]
  assert.deepEqual(BM.arcHop(0, 1, 1.4, from, to), { x: 200, y: 800, p: 0 })
  assert.deepEqual(BM.arcHop(1.4, 1, 1.4, from, to), { x: 900, y: 760, p: 1 })
  const top = BM.arcHop(1.2, 1, 1.4, from, to, { height: 150 })
  near(top.x, 550, 1e-9, 'apex x')
  near(top.y, 780 - 150, 1e-9, 'apex y')
})

test('converge: every item starts where it was, ends exactly in the cluster upright, on arcs that fan', () => {
  const n = 5
  const from = (i: number): Point => [200 + i * 300, 900]
  const to = (i: number): Point => [900 + i * 30, 300]
  const side: number[] = []
  for (let i = 0; i < n; i++) {
    const start = BM.converge(1, 1, 2, i, n, from(i), to(i))
    assert.deepEqual([start.x, start.y], from(i))
    const end = BM.converge(2, 1, 2, i, n, from(i), to(i))
    assert.deepEqual([end.x, end.y, end.rot, end.p], [...to(i), 0, 1])
    // Which side of its straight path the item is on, mid-journey.
    let off = 0
    for (const t of times(1, 2, 200)) {
      const m = BM.converge(t, 1, 2, i, n, from(i), to(i))
      const [fx, fy] = from(i)
      const [tx, ty] = to(i)
      const cross = (tx - fx) * (m.y - fy) - (ty - fy) * (m.x - fx)
      if (Math.abs(cross) > Math.abs(off)) off = cross
    }
    side.push(off)
  }
  assert.ok(side[0]! * side[n - 1]! < 0, 'the first and last items bow to the same side')
  assert.ok(Math.abs(side[2]!) < Math.abs(side[0]!) / 100, 'the middle item does not go straight')
  // Later items leave later.
  const t = 1.05
  assert.ok(BM.converge(t, 1, 2, 0, n, from(0), to(0)).p > 0)
  assert.equal(BM.converge(t, 1, 2, 4, n, from(4), to(4)).p, 0)
  // One item alone goes straight and still arrives.
  assert.deepEqual(BM.converge(2, 1, 2, 0, 1, [0, 0], [10, 10]), { x: 10, y: 10, rot: 0, p: 1 })
})

test('rail: each switch moves on one panel, rings out, and the words trail their panel', () => {
  const switches = [1, 2.2]
  assert.deepEqual(BM.rail(0.5, switches), { shift: 0, index: 0, wobble: 0, sx: 1, sy: 1, textShift: 0 })
  assert.equal(BM.rail(1.01, switches).index, 1)
  assert.equal(BM.rail(2.2, switches).index, 2)
  const settled = BM.rail(9, switches)
  near(settled.shift, 2, 1e-6, 'settled on the second panel')
  near(settled.wobble, 0, 1e-6, 'wobble at rest')
  near(settled.sx, 1, 1e-6, 'stretch at rest')
  near(settled.textShift, 0, 1e-6, 'text at rest')
  const scan = times(1, 2.2, 1200).map((t) => BM.rail(t, switches))
  assert.ok(scan.some((r) => r.wobble > 0.02), 'the rail never overshoots its panel')
  assert.ok(scan.some((r) => r.wobble < -0.02), 'the rail is never short of its panel')
  assert.ok(scan.some((r) => r.sx > 1.05 && r.sy < 1), 'the panels never stretch along the travel')
  // Just after a switch the rail is moving on and the words are behind it.
  assert.ok(BM.rail(1.06, switches).textShift < -0.05, 'the words do not lag')
})

test('wordCuts replaces the word outright at each cut', () => {
  const cuts = [
    { t: 13.25, word: 'MOTION' },
    { t: 13.5, word: 'IS' },
    { t: 13.75, word: 'THE' }
  ]
  assert.deepEqual(BM.wordCuts(13, cuts), { word: '', i: -1, tau: 0 })
  assert.deepEqual(BM.wordCuts(13.25, cuts), { word: 'MOTION', i: 0, tau: 0 })
  assert.equal(BM.wordCuts(13.4999, cuts).word, 'MOTION')
  assert.equal(BM.wordCuts(13.5, cuts).word, 'IS')
  const last = BM.wordCuts(20, cuts)
  assert.equal(last.word, 'THE')
  near(last.tau, 6.25, 1e-9, 'time since the last cut')
  // Never anything but one of the words.
  for (const t of times(13.25, 14, 500)) assert.ok(['MOTION', 'IS', 'THE'].includes(BM.wordCuts(t, cuts).word))
})

// ---------------------------------------------------------------------------
// contact
// ---------------------------------------------------------------------------

test('impact is at rest before the hit, flat and wide at it, and rings out to rest', () => {
  for (const t of [-3, 0, 1.999]) assert.deepEqual(BM.impact(t, 2), { ring: 0, sx: 1, sy: 1 })
  assert.deepEqual(BM.impact(2, 2, { squashX: 0.2, squashY: 0.3 }), { ring: 1, sx: 1.2, sy: 0.7 })
  const scan = times(2, 3, 2000).map((t) => BM.impact(t, 2))
  assert.ok(scan.some((m) => m.ring < -0.1 && m.sy > 1), 'it never swings back past its shape')
  const late = BM.impact(4, 2)
  near(late.ring, 0, 1e-6, 'ring after two seconds')
  near(late.sy, 1, 1e-6, 'height after two seconds')
})

test('press dips while held, flips its state at the release, and rings back to rest', () => {
  assert.deepEqual(BM.press(0.99, 1), { s: 1, down: false, active: false })
  const held = BM.press(1.05, 1)
  assert.ok(held.down && !held.active && held.s < 1)
  near(BM.press(1.0899, 1, { depth: 0.06, hold: 0.09 }).s, 0.94, 1e-3, 'the bottom of the dip')
  const released = BM.press(1.09, 1, { hold: 0.09 })
  assert.deepEqual([released.down, released.active], [false, true])
  near(released.s, 0.94, 1e-9, 'no jump at the release')
  assert.ok(times(1.09, 1.6, 600).some((t) => BM.press(t, 1).s > 1.005), 'the release does not ring past rest')
  const after = BM.press(6, 1)
  near(after.s, 1, 1e-6, 'settled')
  assert.equal(after.active, true)
})

test('pointer follows its path and is smallest at each click', () => {
  const knots = [
    { t: 0, x: 100, y: 900 },
    { t: 1, x: 800, y: 500 },
    { t: 2, x: 1400, y: 300 }
  ]
  for (const t of [0, 0.37, 1, 1.6, 2.5]) {
    const p = BM.pointer(t, knots, [1])
    assert.deepEqual([p.x, p.y], BM.spline(knots, t))
  }
  assert.equal(BM.pointer(1, knots, [1], { dip: 0.2 }).s, 0.8)
  assert.equal(BM.pointer(0.5, knots, [1]).s, 1)
  assert.equal(BM.pointer(1.5, knots, [1]).s, 1)
  let smallest = 1
  let when = 0
  for (const t of times(0.8, 1.3, 1000)) {
    const { s } = BM.pointer(t, knots, [1])
    if (s < smallest) {
      smallest = s
      when = t
    }
  }
  near(when, 1, 1e-9, 'the smallest moment is the click')
  assert.equal(BM.pointer(1.02, knots, [1]).down, true)
  assert.equal(BM.pointer(0.98, knots, [1]).down, false)
  assert.equal(BM.pointer(1.5, knots).s, 1)
})

test('stretch lengthens along the travel, thins across it, and is nothing at rest', () => {
  assert.deepEqual(BM.stretch(0, 0), { angle: 0, sx: 1, sy: 1 })
  const right = BM.stretch(500, 0)
  assert.equal(right.angle, 0)
  assert.ok(right.sx > 1 && right.sy < 1)
  near(right.sx * right.sy, 1, 1e-12, 'area is kept')
  assert.equal(BM.stretch(0, 500).angle, 90)
  assert.ok(BM.stretch(1000, 0).sx > right.sx, 'faster does not stretch more')
  assert.equal(BM.stretch(1e9, 0, { max: 0.35 }).sx, 1.35)
})

/** A target that sits still, crosses in a straight line between 1 s and 1.5 s, and stops. */
const mover = (t: number): Point => [200 + 800 * BM.progress(t, 1, 1.5), 400]

test('simFollower lags a moving target, overshoots when it stops, and settles on it', () => {
  const sim = BM.simFollower(mover, { duration: 5 })
  assert.deepEqual(sim.at(0), { x: 200, y: 400, vx: 0, vy: 0 })
  assert.deepEqual(sim.at(-3), sim.at(0))
  assert.ok(sim.at(1.3).x < mover(1.3)[0] - 20, 'it is not behind a moving target')
  assert.ok(times(1.5, 3, 600).some((t) => sim.at(t).x > 1000 + 5), 'it does not overshoot where the target stopped')
  const end = sim.at(5)
  near(end.x, 1000, 0.05, 'settled x')
  near(end.vx, 0, 0.5, 'settled speed')
  assert.deepEqual(sim.at(99), end)
})

test('a sim is the same recording on every build, and reading it does not change it', () => {
  const a = BM.simFollower(mover, { duration: 3 })
  const b = BM.simFollower(mover, { duration: 3 })
  const ts = times(0, 3, 311)
  const forward = ts.map((t) => a.at(t))
  const backward = [...ts].reverse().map((t) => b.at(t)).reverse()
  assert.deepEqual(forward, backward)
  assert.deepEqual(a.at(1.2345), a.at(1.2345))

  const anchor = (t: number): Point => [600 + 300 * Math.sin(t * 3), 100]
  const s1 = BM.simString(anchor, { duration: 2, gust: 900, seed: 5 })
  const s2 = BM.simString(anchor, { duration: 2, gust: 900, seed: 5 })
  const s3 = BM.simString(anchor, { duration: 2, gust: 900, seed: 6 })
  assert.deepEqual(ts.map((t) => s1.at(t)), [...ts].reverse().map((t) => s2.at(t)).reverse())
  assert.notDeepEqual(s1.at(1.5), s3.at(1.5), 'another seed blew the same wind')
  // With no gust there is nothing random to seed.
  assert.deepEqual(
    BM.simString(anchor, { duration: 1, seed: 1 }).at(0.8),
    BM.simString(anchor, { duration: 1, seed: 2 }).at(0.8)
  )
})

test('simString hangs from its anchor, keeps its length, and swings when the anchor moves', () => {
  const anchor = (t: number): Point => [600 + 400 * BM.smooth(BM.progress(t, 0.5, 0.9)), 100]
  const sim = BM.simString(anchor, { duration: 3, points: 9, length: 240 })
  const start = sim.at(0)
  assert.equal(start.length, 9)
  assert.deepEqual(start[0], [600, 100])
  assert.deepEqual(start[8], [600, 340])
  let swung = 0
  for (const t of times(0, 3, 300)) {
    const points = sim.at(t)
    const [ax, ay] = anchor(t)
    near(points[0]![0], ax, 0.5, `pinned x at ${t}`)
    near(points[0]![1], ay, 0.5, `pinned y at ${t}`)
    for (let i = 1; i < points.length; i++) {
      const length = Math.hypot(points[i]![0] - points[i - 1]![0], points[i]![1] - points[i - 1]![1])
      near(length, 30, 1.5, `segment ${i} at ${t}`)
    }
    swung = Math.max(swung, Math.abs(points[8]![0] - ax))
  }
  assert.ok(swung > 40, `the end of the string never trailed its anchor (${swung} px)`)
})

test('simMagnet stays home while the pointer is far and leans toward it when it is near', () => {
  const home: Point = [960, 540]
  const far = BM.simMagnet(() => [100, 100], home, { duration: 1 }).at(1)
  assert.deepEqual([far.x, far.y, far.k], [960, 540, 0])
  const near1 = BM.simMagnet(() => [1020, 540], home, { duration: 3 }).at(3)
  assert.ok(near1.k > 0 && near1.k <= 1)
  assert.ok(near1.x > 965 && near1.x < 1020, `leaned to ${near1.x}`)
  near(near1.y, 540, 1e-6, 'no sideways pull')
})

test('a sim without a duration is refused, saying what it needs', () => {
  assert.throws(() => BM.simFollower(mover, {} as never), /duration.*seconds/)
  assert.throws(() => BM.simString(mover, { duration: 0 }), /duration.*seconds/)
  assert.equal(BM.simFollower(mover, { duration: 1 }).step, 1 / 240)
})

// ---------------------------------------------------------------------------
// camera
// ---------------------------------------------------------------------------

test('cameraAt holds its ends, is exact at its keys, and a key keeps what it does not name', () => {
  const keys = [
    { t: 1, x: 400, y: 300, zoom: 2 },
    { t: 2, x: 1200 },
    { t: 3, zoom: 8, rot: 10, curve: 'linear' as const }
  ]
  assert.deepEqual(BM.cameraAt(0, keys), { x: 400, y: 300, zoom: 2, rot: 0 })
  assert.deepEqual(BM.cameraAt(1, keys), { x: 400, y: 300, zoom: 2, rot: 0 })
  assert.deepEqual(BM.cameraAt(2, keys), { x: 1200, y: 300, zoom: 2, rot: 0 })
  assert.deepEqual(BM.cameraAt(3, keys), { x: 1200, y: 300, zoom: 8, rot: 10 })
  assert.deepEqual(BM.cameraAt(30, keys), { x: 1200, y: 300, zoom: 8, rot: 10 })
  assert.deepEqual(BM.cameraAt(5, []), { x: 960, y: 540, zoom: 1, rot: 0 })
  assert.deepEqual(BM.cameraAt(5, [], { frame: { w: 1080, h: 1920 } }), { x: 540, y: 960, zoom: 1, rot: 0 })
  assert.throws(() => BM.cameraAt(0, [{ t: 0, zoom: 0 }]), /zoom must be above 0/)
})

test('cameraAt interpolates zoom in log space, on the curve of the key it is arriving at', () => {
  const keys = [
    { t: 1, x: 400, y: 300, zoom: 2 },
    { t: 3, x: 800, zoom: 8, rot: 10, curve: 'linear' as const }
  ]
  const mid = BM.cameraAt(2, keys)
  near(mid.zoom, 4, 1e-9, 'halfway between 2x and 8x is 4x, not 5x')
  near(mid.x, 600, 1e-9, 'x halfway')
  near(mid.rot, 5, 1e-9, 'roll halfway')
  // The arriving key's curve, not the departing one's.
  const snap = [{ t: 0, x: 0, curve: 'linear' as const }, { t: 1, x: 100, curve: 'expoOut' as const }]
  near(BM.cameraAt(0.5, snap).x, 100 * BM.EASES.expoOut(0.5), 1e-9, 'the curve used')
  const gentle = [{ t: 0, x: 0 }, { t: 1, x: 100 }]
  near(BM.cameraAt(0.25, gentle).x, 100 * BM.EASES.sineInOut(0.25), 1e-9, 'the default curve')
})

test('the home camera draws every layer as authored, at every depth', () => {
  for (const depth of [0, 1.2, -0.5]) {
    const m = BM.layerMatrix(BM.homeCamera(), { depth })
    m.forEach((v, i) => near(v, [1, 0, 0, 1, 0, 0][i]!, 1e-12, `depth ${depth}, entry ${i}`))
  }
  const tall = { w: 1080, h: 1920 }
  BM.layerMatrix(BM.homeCamera(tall), { frame: tall, depth: 2 }).forEach((v, i) => near(v, [1, 0, 0, 1, 0, 0][i]!, 1e-12, `entry ${i}`))
})

test('the camera puts the point it looks at in the centre of the frame, scaled and rolled about it', () => {
  const camera = { x: 300, y: 700, zoom: 2.5, rot: 0 }
  const m = BM.layerMatrix(camera)
  assert.deepEqual(BM.toScreen(m, 300, 700), [960, 540])
  const [x, y] = BM.toScreen(m, 340, 690)
  near(x, 960 + 100, 1e-9, 'a point 40 right of the look-at is 100 px right at 2.5x')
  near(y, 540 - 25, 1e-9, 'and 10 up is 25 px up')
  // A camera rolled 90° clockwise sees the world turned 90° the other way.
  const rolled = BM.layerMatrix({ ...camera, zoom: 1, rot: 90 })
  const [rx, ry] = BM.toScreen(rolled, 310, 700)
  near(rx, 960, 1e-9, 'rolled x')
  near(ry, 540 - 10, 1e-9, 'a point to the right of the look-at appears above it')
})

test('depth is parallax from one camera: far layers move less, near ones more', () => {
  const still = BM.homeCamera()
  const panned = { ...still, x: still.x + 200 }
  const moved = (depth: number): number =>
    BM.toScreen(BM.layerMatrix(still, { depth }), 500, 500)[0] - BM.toScreen(BM.layerMatrix(panned, { depth }), 500, 500)[0]
  near(moved(0), 200, 1e-9, 'the focus plane moves with the camera')
  near(moved(1), 100, 1e-9, 'a layer one unit back moves half as far')
  near(moved(-0.5), 400, 1e-9, 'a layer half-way to the camera moves twice as far')
  // A push-in grows a far layer less than the focus plane, and a near one more.
  const pushed = { ...still, zoom: 3 }
  near(BM.layerScale(pushed, 0), 3, 1e-12, 'focus plane')
  assert.ok(BM.layerScale(pushed, 1.2) < 3 && BM.layerScale(pushed, 1.2) > 1)
  assert.ok(BM.layerScale(pushed, -0.2) > 3)
  assert.equal(BM.layerScale({ ...still, zoom: 4 }, -0.5), 1000)
  assert.throws(() => BM.layerScale(still, -1), /depth must be above -1/)
})

test('toWorld undoes toScreen, through zoom, roll and depth', () => {
  const cameras = [
    { x: 300, y: 700, zoom: 2.5, rot: 0 },
    { x: -4000, y: 12, zoom: 0.2, rot: 37 },
    { x: 960, y: 540, zoom: 300, rot: -170 }
  ]
  for (const camera of cameras) {
    for (const depth of [0, 1.2, -0.3]) {
      if (1 + depth * camera.zoom <= 0) continue
      const m = BM.layerMatrix(camera, { depth })
      for (const [x, y] of [[0, 0], [123.4, -987.6], [5000, 5000]] as const) {
        const [bx, by] = BM.toWorld(m, ...BM.toScreen(m, x, y))
        near(bx, x, 1e-6, `x through ${JSON.stringify(camera)} depth ${depth}`)
        near(by, y, 1e-6, `y through ${JSON.stringify(camera)} depth ${depth}`)
      }
    }
  }
})

test('boxToScreen is the box a viewer sees, with its other fields carried across', () => {
  const m = BM.layerMatrix({ x: 300, y: 700, zoom: 2, rot: 0 })
  assert.deepEqual(BM.boxToScreen(m, { x: 280, y: 690, w: 40, h: 20, op: 0.5 }), { x: 920, y: 520, w: 80, h: 40, op: 0.5 })
  // Under a quarter-turn roll the box that bounds it is as wide as the original was tall.
  const rolled = BM.boxToScreen(BM.layerMatrix({ x: 300, y: 700, zoom: 1, rot: 90 }), { x: 280, y: 690, w: 40, h: 20 })
  near(rolled.w, 20, 1e-9, 'width')
  near(rolled.h, 40, 1e-9, 'height')
  near(rolled.x + rolled.w / 2, 960, 1e-9, 'still centred')
  // At an angle that is not a quarter turn all four corners decide the bounds, not three.
  const tilted = BM.boxToScreen(BM.layerMatrix({ x: 300, y: 700, zoom: 1, rot: 30 }), { x: 280, y: 690, w: 40, h: 20 })
  const rad = Math.PI / 6
  near(tilted.w, 40 * Math.cos(rad) + 20 * Math.sin(rad), 1e-9, 'width at 30 degrees')
  near(tilted.h, 40 * Math.sin(rad) + 20 * Math.cos(rad), 1e-9, 'height at 30 degrees')
  near(tilted.x + tilted.w / 2, 960, 1e-9, 'centred at 30 degrees')
  assert.equal(BM.inFrame({ x: -10, y: 5, w: 30, h: 30 }), true)
  assert.equal(BM.inFrame({ x: -10, y: 5, w: 30, h: 30 }, { whole: true }), false)
  assert.equal(BM.inFrame({ x: 10, y: 5, w: 30, h: 30 }, { whole: true }), true)
  assert.equal(BM.inFrame({ x: -40, y: 5, w: 30, h: 30 }), false)
  assert.equal(BM.inFrame({ x: 1100, y: 5, w: 30, h: 30 }, { frame: { w: 1080, h: 1920 } }), false)
})

test('shake is exactly zero before the hit, loud after it, dies away, and repeats from its seed', () => {
  for (const t of [-10, 0, 2.9, 2.999999]) assert.deepEqual(BM.shake(t, 3), { x: 0, y: 0, rot: 0 })
  const scan = times(3, 3.5, 500).map((t) => BM.shake(t, 3, { amp: 14 }))
  const loudest = Math.max(...scan.map((s) => Math.hypot(s.x, s.y)))
  assert.ok(loudest > 4, `the shake barely moves (${loudest} px)`)
  assert.ok(scan.every((s) => Math.abs(s.x) <= 14 && Math.abs(s.y) <= 14), 'it went past its amplitude')
  const late = BM.shake(6, 3)
  assert.ok(Math.hypot(late.x, late.y) < 0.001 && Math.abs(late.rot) < 0.001, 'still shaking three seconds on')
  assert.deepEqual(BM.shake(3.1, 3, { seed: 9 }), BM.shake(3.1, 3, { seed: 9 }))
  assert.notDeepEqual(BM.shake(3.1, 3, { seed: 9 }), BM.shake(3.1, 3, { seed: 10 }))
})

test('handheld stays within its amplitude and is the same float every time', () => {
  for (const t of times(0, 30, 300)) {
    const h = BM.handheld(t, { amp: 4 })
    assert.ok(Math.abs(h.x) <= 4 && Math.abs(h.y) <= 4)
    assert.deepEqual(h, BM.handheld(t, { amp: 4 }))
  }
  assert.notDeepEqual(BM.handheld(3, { seed: 1 }), BM.handheld(3, { seed: 2 }))
})

test('farGrid covers the frame with grid points, and its dots are a constant size on screen', () => {
  for (const camera of [BM.homeCamera(), { x: 2400, y: -300, zoom: 3.3, rot: 25 }, { x: 100, y: 100, zoom: 0.4, rot: 0 }]) {
    const grid = BM.farGrid(camera, { spacing: 120, dot: 2 })
    assert.deepEqual(grid.matrix, BM.layerMatrix(camera, { depth: 1.2 }))
    for (const [sx, sy] of [[0, 0], [1920, 0], [0, 1080], [1920, 1080], [960, 540]] as const) {
      const [x, y] = BM.toWorld(grid.matrix, sx, sy)
      assert.ok(x >= grid.x0 && x <= grid.x1 && y >= grid.y0 && y <= grid.y1, `screen (${sx}, ${sy}) is off the grid`)
    }
    for (const edge of [grid.x0, grid.x1, grid.y0, grid.y1]) near(edge / 120, Math.round(edge / 120), 1e-9, 'an edge off the grid')
    near(grid.r * BM.layerScale(camera, 1.2), 2, 1e-12, 'dot radius on screen')
    // Not wastefully large: within one cell of what the frame needs.
    const xs = [[0, 0], [1920, 0], [0, 1080], [1920, 1080]].map(([sx, sy]) => BM.toWorld(grid.matrix, sx!, sy!)[0])
    assert.ok(grid.x0 > Math.min(...xs) - 120 && grid.x1 < Math.max(...xs) + 120)
  }
})

test('frameTravel is how far the camera moves the edge of the picture', () => {
  const a = { x: 500, y: 500, zoom: 2, rot: 0 }
  assert.equal(BM.frameTravel(a, a), 0)
  near(BM.frameTravel(a, { ...a, x: 530 }), 60, 1e-9, 'a 30 px pan at 2x')
  near(BM.frameTravel(a, { ...a, x: 530 }, { depth: 1 }), BM.layerScale(a, 1) * 15, 1e-9, 'the same pan, one unit back')
  // Doubling the zoom about the centre throws each corner out by its own distance from the centre.
  near(BM.frameTravel(BM.homeCamera(), { ...BM.homeCamera(), zoom: 2 }), Math.hypot(960, 540), 1e-9, 'a push from 1x to 2x')
  // There and back: the ends match, so only the middle shows the picture moved.
  assert.equal(BM.frameTravel(a, a, { mid: a }), 0)
  near(BM.frameTravel(a, a, { mid: { ...a, x: 530 } }), 120, 1e-9, 'out and back')
  const tall = { w: 1080, h: 1920 }
  near(BM.frameTravel(BM.homeCamera(tall), { ...BM.homeCamera(tall), zoom: 2 }, { frame: tall }), Math.hypot(540, 960), 1e-9, 'portrait')
})

test('boxTravel and blurSamples size a shutter from what moved', () => {
  assert.equal(BM.boxTravel({ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 0, w: 10, h: 10 }), 0)
  assert.equal(BM.boxTravel({ x: 0, y: 0, w: 10, h: 10 }, { x: 30, y: 40, w: 10, h: 10 }), 50)
  // A box that grows in place: its far corner is what travels.
  assert.equal(BM.boxTravel({ x: 0, y: 0, w: 10, h: 10 }, { x: 0, y: 0, w: 310, h: 410 }), 500)
  assert.equal(BM.blurSamples(0), 1)
  assert.equal(BM.blurSamples(7.9), 1)
  assert.equal(BM.blurSamples(80), 10)
  assert.equal(BM.blurSamples(80, { gap: 4 }), 20)
  assert.equal(BM.blurSamples(100000), 32)
  assert.equal(BM.blurSamples(100000, { max: 12 }), 12)
})

// ---------------------------------------------------------------------------
// purity
// ---------------------------------------------------------------------------

test('every move is a pure function of time: any order, any number of times, the same numbers', () => {
  const knots = [{ t: 0, x: 0, y: 0 }, { t: 1, x: 500, y: 300 }, { t: 2, x: 900, y: 100 }]
  const keys = [{ t: 0, x: 400, y: 300, zoom: 1 }, { t: 2, x: 1200, zoom: 6, rot: 4, curve: 'expoInOut' as const }]
  const card = { x: 1210, y: 640, w: 320, h: 180, r: 24 }
  const frame = (t: number): unknown => [
    BM.wordLand(t, 0.2),
    BM.letterFall(t, 0.3, 2),
    BM.cardPop(t, 0.4),
    BM.cardLift(t, 1.2),
    BM.lineReveal(t, 0.1, 1),
    BM.typeOn(t, 0.2, 'one take'),
    BM.checkTick(t, 0.9),
    BM.rectMorph(t, 0.5, 1.1, card, { x: 0, y: 0, w: 1920, h: 1080 }),
    BM.iris(t, 0.4, 1.3, 700, 400),
    BM.pushInto(t, 0.3, 1.3, card),
    BM.arcHop(t, 0.2, 0.7, [100, 800], [600, 700]),
    BM.converge(t, 0.2, 1.4, 2, 5, [100, 100], [900, 500]),
    BM.rail(t, [0.4, 1.1]),
    BM.wordCuts(t, [{ t: 0.5, word: 'a' }, { t: 0.9, word: 'b' }]),
    BM.impact(t, 0.7),
    BM.press(t, 0.6),
    BM.pointer(t, knots, [0.6, 1.4]),
    BM.shake(t, 0.7),
    BM.handheld(t),
    BM.cameraAt(t, keys),
    BM.layerMatrix(BM.cameraAt(t, keys), { depth: 1.2 }),
    BM.farGrid(BM.cameraAt(t, keys)),
    BM.frameTravel(BM.cameraAt(t, keys), BM.cameraAt(t + 1 / 30, keys))
  ]
  const ts = times(-0.2, 2.4, 131)
  const forward = ts.map(frame)
  const shuffled = ts.map((t, i) => ({ t, i, key: (i * 7919) % 131 })).sort((a, b) => a.key - b.key)
  const again: unknown[] = []
  for (const { t, i } of shuffled) again[i] = frame(t)
  assert.deepEqual(again, forward)
  assert.ok(JSON.stringify(forward).length > 10000 && !JSON.stringify(forward).includes('null'), 'a move returned NaN or Infinity')
})
