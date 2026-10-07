/**
 * The speed curve's integral and its inverse (`@shared/speed-curve`), and the mapping they feed
 * (`sourceEdgeAt` / `sourceTimeAt` in `@shared/project`).
 *
 * The requirements these are written from:
 * - a clip with no speed keys, forwards, reads exactly what it read before — a literal table;
 * - the integral is monotonic, exact at whole frames, and its inverse takes it back;
 * - a reversed clip shows the frames the forward clip shows, in the opposite order, with no
 *   frame gained or lost at either end;
 * - a 0% stretch holds one source frame, and the clip is that much longer.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  footageBeyond,
  itemFrameAtSource,
  sourceEdgeAt,
  sourceSpanOf,
  sourceTimeAt,
  type Item,
  type Keyframe
} from './project'
import {
  consumedFrames,
  frameAtConsumed,
  SPEED_RAMP_PRESETS,
  speedAtFrame,
  speedCurveLabel,
  speedRampKeys,
  speedRampOf
} from './speed-curve'

function clip(over: Partial<Item> = {}): Item {
  return {
    id: 'c',
    assetId: 'a',
    trackId: 't',
    from: 100,
    durationInFrames: 90,
    sourceStartUs: 2_000_000,
    layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
    volume: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    speed: 1,
    ...over
  }
}

const ramped = (keys: Keyframe[], over: Partial<Item> = {}): Item => clip({ keyframes: { speed: keys }, ...over })

/** 100% → 25% → 100%, eased: the ramp the feature is for. */
const DIP: Keyframe[] = [
  { frame: 20, value: 1, ease: 'inOut' },
  { frame: 30, value: 0.25 },
  { frame: 60, value: 0.25, ease: 'inOut' },
  { frame: 70, value: 1 }
]

test('a clip with no speed keys reads the source it always did — a literal table, not a round trip', () => {
  // [fps, sourceStartUs, speed, timeline frame − from] → microseconds, worked by hand from
  // `start + round(round(frames / fps × 1e6) × speed)`. If this table has to change, every saved
  // project plays different footage.
  const table: [number, number, number, number, number][] = [
    [30, 0, 1, 0, 0],
    [30, 0, 1, 1, 33_333],
    [30, 0, 1, 10, 333_333],
    [30, 2_000_000, 1, 89, 4_966_667],
    [30, 2_000_000, 2, 45, 5_000_000],
    [30, 2_000_000, 0.5, 7, 2_116_667],
    [24, 2_833_333, 1, 68, 5_666_666],
    [24, 2_833_333, 1.5, 5, 3_145_833],
    [60, 1_000, 0.25, 3, 13_500],
    [30, 5_000_000, 1, -12, 4_600_000],
    [30, 5_000_000, 4, -3, 4_600_000]
  ]
  for (const [fps, sourceStartUs, speed, rel, expected] of table) {
    const item = clip({ sourceStartUs, speed })
    assert.equal(sourceTimeAt(item, item.from + rel, fps), expected, `fps ${fps} start ${sourceStartUs} speed ${speed} rel ${rel}`)
    assert.equal(sourceEdgeAt(item, rel, fps), expected, 'forwards a frame reads the boundary it starts on')
  }
  // A speed the model should never hold still plays at 1×, as before.
  for (const speed of [0, -2, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(sourceTimeAt(clip({ speed }), 110, 30), 2_333_333, `speed ${speed}`)
  }
  // And keys on other properties do not touch time.
  const animated = clip({ keyframes: { scale: [{ frame: 0, value: 1 }, { frame: 90, value: 2 }] } })
  assert.equal(sourceTimeAt(animated, 145, 30), 3_500_000)
})

test('the integral is a sum over frames: exact at every whole frame, 0 at 0, linear inside a frame', () => {
  const item = ramped(DIP)
  assert.equal(consumedFrames(item, 0), 0)
  let sum = 0
  for (let frame = 0; frame < 200; frame += 1) {
    assert.ok(Math.abs(consumedFrames(item, frame) - sum) < 1e-9, `boundary ${frame}`)
    sum += speedAtFrame(item, frame)
  }
  // Before the first key the first speed holds; after the last, the last.
  assert.equal(consumedFrames(item, 20), 20)
  assert.ok(Math.abs(consumedFrames(item, 180) - consumedFrames(item, 70) - 110) < 1e-9)
  // The flat quarter-speed stretch is exactly a quarter frame a frame.
  assert.ok(Math.abs(consumedFrames(item, 60) - consumedFrames(item, 30) - 7.5) < 1e-9)
  // Half way through a frame is half that frame's speed.
  assert.ok(Math.abs(consumedFrames(item, 40.5) - consumedFrames(item, 40) - 0.125) < 1e-9)
  // Before the clip (a transition's handle) it is negative, at the first key's speed.
  assert.equal(consumedFrames(item, -12), -12)
})

test('the integral never decreases, and the inverse takes every boundary back to itself', () => {
  for (const keys of [DIP, speedRampKeys('montage', 300, 30), speedRampKeys('bullet', 240, 30), speedRampKeys('ramp-up', 90, 24)]) {
    const item = ramped(keys)
    let previous = Number.NEGATIVE_INFINITY
    for (let frame = -40; frame <= 400; frame += 1) {
      const consumed = consumedFrames(item, frame)
      assert.ok(consumed >= previous, `monotonic at ${frame}`)
      previous = consumed
      // No speed here is 0, so every boundary is the only one at its amount.
      assert.ok(Math.abs(frameAtConsumed(item, consumed) - frame) < 1e-6, `round trip at ${frame}: ${frameAtConsumed(item, consumed)}`)
    }
    // And between boundaries.
    for (const rel of [0.25, 33.5, 61.75, 123.4]) {
      assert.ok(Math.abs(frameAtConsumed(item, consumedFrames(item, rel)) - rel) < 1e-6, `fractional ${rel}`)
    }
  }
  // The constant case is the same function: rel × speed, and back.
  const constant = clip({ speed: 2 })
  assert.equal(consumedFrames(constant, 30), 60)
  assert.equal(frameAtConsumed(constant, 60), 30)
})

test('a 0% stretch holds one source frame for its length, and the inverse lands on where it starts', () => {
  // Play 30 frames, hold for 24, play on.
  const keys: Keyframe[] = [
    { frame: 0, value: 1, ease: 'hold' },
    { frame: 30, value: 0, ease: 'hold' },
    { frame: 54, value: 1 }
  ]
  const item = ramped(keys, { sourceStartUs: 0, from: 0, durationInFrames: 114 })
  const held = sourceTimeAt(item, 30, 30)
  assert.equal(held, 1_000_000, 'the held frame is the one the hold starts on')
  for (let frame = 30; frame <= 54; frame += 1) assert.equal(sourceTimeAt(item, frame, 30), held, `frame ${frame} is held`)
  // The nearest frames either side are not: the control that this can tell a hold from play.
  assert.equal(sourceTimeAt(item, 29, 30), 966_667)
  assert.equal(sourceTimeAt(item, 55, 30), 1_033_333)
  // 90 frames of footage now take 114: the hold is added, nothing is skipped.
  assert.equal(consumedFrames(item, 114), 90)
  assert.equal(frameAtConsumed(item, 30), 30, 'asked inside the hold, the answer is its first frame')
  // A curve that ends on a hold never reads further; one that starts on one always had.
  const stuck = ramped([{ frame: 0, value: 1, ease: 'hold' }, { frame: 10, value: 0 }])
  assert.equal(frameAtConsumed(stuck, 11), Number.POSITIVE_INFINITY)
  assert.equal(frameAtConsumed(stuck, 10), 10)
  const late = ramped([{ frame: 0, value: 0, ease: 'hold' }, { frame: 10, value: 1 }])
  assert.equal(frameAtConsumed(late, -1), Number.NEGATIVE_INFINITY)
})

test('a reversed clip shows the forward clip’s frames in the opposite order — exact at the head and the tail', () => {
  for (const [fps, speed] of [[30, 1], [24, 1], [30, 2], [60, 0.5]] as const) {
    const forward = clip({ sourceStartUs: 3_000_000, speed, durationInFrames: 48 })
    const late = sourceEdgeAt(forward, forward.durationInFrames, fps)
    const reversed = clip({ sourceStartUs: late, speed, durationInFrames: 48, reverse: true })
    const last = forward.from + forward.durationInFrames - 1
    // The source frame a media element shows for a time: the one at or before it, asked for half
    // a millisecond late (`FRAME_EDGE_SECONDS`), in a file at four times the timeline's rate so
    // that a half-speed clip's in-between times are frames too.
    const shown = (us: number): number => Math.floor(((us + 500) / 1_000_000) * fps * 4)
    // Tail: the reversed clip's last frame is the first frame of the footage, to the microsecond.
    assert.equal(sourceTimeAt(reversed, last, fps), forward.sourceStartUs, `tail, fps ${fps} speed ${speed}`)
    // Head, and every frame between: the forward clip's frames in the opposite order. The two
    // round the same footage from opposite ends, so they may differ by a microsecond — never by
    // a frame, which is what an off-by-one at either end would be.
    for (let k = 0; k < forward.durationInFrames; k += 1) {
      const a = sourceTimeAt(reversed, reversed.from + k, fps)
      const b = sourceTimeAt(forward, last - k, fps)
      assert.ok(Math.abs(a - b) <= 2, `frame ${k}: ${a} vs ${b}`)
      assert.equal(shown(a), shown(b), `frame ${k} shows the same source frame`)
    }
    // And the specimen can tell: one timeline frame out is a different source frame.
    assert.notEqual(shown(sourceTimeAt(reversed, reversed.from + 1, fps)), shown(sourceTimeAt(forward, last, fps)))
    assert.deepEqual(sourceSpanOf(reversed, fps), sourceSpanOf(forward, fps), 'the same footage either way')
  }
  // The literal: 10 frames of a 30 fps file from 0. Forwards 0…300000; backwards 300000…0.
  const ten = clip({ sourceStartUs: 333_333, durationInFrames: 10, reverse: true, from: 0 })
  assert.equal(sourceTimeAt(ten, 0, 30), 300_000)
  assert.equal(sourceTimeAt(ten, 1, 30), 266_666)
  assert.equal(sourceTimeAt(ten, 9, 30), 0)
})

test('the inverse of the mapping finds the frame for a source time, forwards, reversed and ramped', () => {
  const fps = 30
  for (const item of [clip({ speed: 2 }), ramped(DIP), clip({ reverse: true, sourceStartUs: 9_000_000 }), ramped(DIP, { reverse: true, sourceStartUs: 9_000_000 })]) {
    for (const rel of [0, 1, 17, 45, 89, 90]) {
      const back = itemFrameAtSource(item, sourceEdgeAt(item, rel, fps), fps)
      assert.ok(Math.abs(back - rel) < 1e-3, `${item.reverse ? 'reversed' : 'forward'} rel ${rel}: ${back}`)
    }
  }
})

test('footage beyond a clip: a reversed clip’s head runs into the end of its file, a forward one’s into the start', () => {
  const asset = { durationUs: 10_000_000 }
  // Forwards from 2 s for 3 s of a 10 s file: 60 frames before, 150 after.
  assert.deepEqual(footageBeyond(asset, clip({ sourceStartUs: 2_000_000 }), 30), { before: 60, after: 150 })
  // The same footage backwards: the clip starts reading at 5 s, so 150 before its head, 60 after its tail.
  const reversed = footageBeyond(asset, clip({ sourceStartUs: 5_000_000, reverse: true }), 30)
  assert.ok(Math.abs(reversed.before - 150) < 1e-6 && Math.abs(reversed.after - 60) < 1e-6, JSON.stringify(reversed))
  // At 2× there is half as much room in timeline frames.
  assert.deepEqual(footageBeyond(asset, clip({ sourceStartUs: 2_000_000, speed: 2 }), 30), { before: 30, after: 30 })
  // A still has no end of footage.
  assert.equal(footageBeyond({ durationUs: 0 }, clip(), 30).after, Number.POSITIVE_INFINITY)
})

test('every preset is a legal curve that reads its footage, slow where it says, and is recognised again', () => {
  for (const preset of SPEED_RAMP_PRESETS) {
    for (const footage of [45, 150, 900]) {
      const keys = speedRampKeys(preset, footage, 30)
      assert.ok(keys.length >= 2, preset)
      for (let i = 1; i < keys.length; i += 1) assert.ok(keys[i]!.frame > keys[i - 1]!.frame, `${preset}: keys in order, one a frame`)
      assert.ok(keys.every((key) => Number.isInteger(key.frame) && key.frame >= 0 && key.value >= 0 && key.value <= 16), preset)
      assert.ok(keys[keys.length - 1]!.value > 0, `${preset} ends above 0, so the clip finishes`)
      const item = ramped(keys)
      const length = frameAtConsumed(item, footage)
      assert.ok(Number.isFinite(length) && length > 0, `${preset} reaches the end of ${footage} frames of footage`)
      assert.equal(speedRampOf(keys, footage, 30), preset)
    }
  }
  // Ramp down ends slow and so runs long; montage averages faster than 1× at its ends.
  assert.ok(frameAtConsumed(ramped(speedRampKeys('ramp-down', 150, 30)), 150) > 150)
  assert.equal(speedAtFrame(ramped(speedRampKeys('ramp-down', 150, 30)), 0), 1)
  assert.equal(speedAtFrame(ramped(speedRampKeys('ramp-down', 150, 30)), 400), 0.25)
  // The hold preset freezes for one second of the timeline and adds exactly that.
  const hold = ramped(speedRampKeys('hold', 150, 30))
  assert.equal(frameAtConsumed(hold, 150), 180)
  assert.equal(speedRampOf(DIP, 150, 30), null, 'hand-set keys are no preset')
  assert.equal(speedCurveLabel({ ...ramped(DIP), durationInFrames: 90 }), '25–100%')
  assert.equal(speedCurveLabel(clip({ speed: 2 })), '200%')
})

test('a key list edited in place is not answered from the cache', () => {
  const keys: Keyframe[] = [{ frame: 0, value: 1 }, { frame: 10, value: 1 }]
  const item = ramped(keys)
  assert.equal(consumedFrames(item, 10), 10)
  keys[0]!.value = 3
  keys[1]!.value = 3
  assert.equal(consumedFrames(item, 10), 30)
})
