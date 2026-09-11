/**
 * Tests for the playback clock.
 *
 * These exist because everything the clock gets wrong is invisible from inside the app.
 * Playback driven by a frame counter looks perfect on the machine it was written on and
 * runs at double speed on a 120Hz display. A probe that counts rAF callbacks reports a
 * healthy 120/s while the picture updates four times a second. Neither is something you
 * notice by using the editor; both are one line to reintroduce.
 *
 * The clock takes its `now` and its frame scheduler as constructor options precisely so
 * this file can drive it from a fake clock, which is why none of it needs a window.
 *
 * Mutation-tested before it was trusted: nine deliberate regressions — counter-driven
 * frames, every tick counted as a picture, `seek` re-anchoring on an unchanged frame,
 * skipped frames uncounted, no stop at the end, no yield to a scrub, no re-anchor on
 * release, an unbounded sample buffer, an unclamped seek. Eight were caught first time.
 * The ninth was not, and it was this file's fault rather than the clock's: the scrub test
 * drove the drag with ticks arriving throughout, and a drag that receives ticks re-anchors
 * either way, so it passed against the bug it existed to guard. The case that separates
 * them is a drag with *no* ticks — an occluded window stops `requestAnimationFrame` — and
 * it is now its own test. Reintroducing any of the nine fails this suite.
 *
 * Run with `pnpm test`, which covers every test file under `src`. Node strips the types natively,
 * so this needs no test framework and no new dependency; the `--import ./src/test-hooks.mjs`
 * in that script only teaches Node this project's extensionless import style — the same one
 * every other module in `engine/` is written in.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PlaybackClock } from './clock'

/**
 * A clock wired to a fake display. `now` is computed from the tick index rather than
 * accumulated, because accumulating `1000/120` 240 times lands just short of 2000ms and
 * every assertion here would then be off by one for reasons that have nothing to do with
 * the code under test.
 */
function harness(displayHz: number, options: { fps?: number; duration?: number } = {}): {
  clock: PlaybackClock
  frames: number[]
  ends: number
  advance: (ticks: number) => void
  idle: (ms: number) => void
} {
  let now = 0
  let index = 0
  const queue: Array<(time: number) => void> = []
  const clock = new PlaybackClock({
    now: () => now,
    requestFrame: (callback) => queue.push(callback),
    cancelFrame: () => {}
  })
  clock.setFps(options.fps ?? 30)
  clock.setDuration(options.duration ?? 100_000)

  const frames: number[] = []
  let ends = 0
  clock.onFrame((frame) => frames.push(frame))
  clock.onEnd(() => {
    ends += 1
  })

  let base = 0
  return {
    clock,
    frames,
    get ends() {
      return ends
    },
    advance(ticks: number) {
      for (let i = 0; i < ticks; i += 1) {
        index += 1
        now = base + (index * 1000) / displayHz
        queue.shift()?.(now)
      }
    },
    /**
     * Time passes with no frame callbacks at all — what happens when the window is
     * occluded or backgrounded, because the browser stops `requestAnimationFrame`.
     */
    idle(ms: number) {
      base += ms
      now += ms
    }
  }
}

test('a 120Hz display shows a 30fps project at 30 pictures a second', () => {
  const h = harness(120)
  h.clock.start()
  h.advance(240)

  const stats = h.clock.stats()
  assert.equal(stats.ticks, 240, 'every display refresh is a tick')
  assert.equal(stats.pictures, 60, 'but only 60 of them are a new picture')
  assert.equal(h.clock.frame, 60, 'two seconds of a 30fps timeline is 60 frames')
  assert.equal(stats.skippedFrames, 0)
})

test('playback speed comes from the wall clock, not the refresh rate', () => {
  // The same two seconds of timeline, on three different displays. A counter-driven clock
  // would return 120, 60 and 60 here.
  for (const hz of [120, 60, 30]) {
    const h = harness(hz)
    h.clock.start()
    h.advance(hz * 2)
    assert.equal(h.clock.frame, 60, `${hz}Hz display`)
  }
})

test('a display too slow for the project steps over frames and says so', () => {
  const h = harness(30, { fps: 60 })
  h.clock.start()
  h.advance(60)

  const stats = h.clock.stats()
  assert.equal(h.clock.frame, 120, 'two seconds of 60fps is still 120 frames of real time')
  assert.equal(stats.pictures, 60, 'a 30Hz display can only show 60 of them')
  assert.equal(stats.skippedFrames, 60, 'the other 60 are reported, not hidden')
})

test('playback stops at the end of the timeline exactly once', () => {
  const h = harness(60, { duration: 10 })
  h.clock.start()
  h.advance(60)

  assert.equal(h.frames.at(-1), 10)
  assert.equal(h.ends, 1, 'the end fires once, not once per tick after it')
  assert.equal(h.clock.running, false)
})

test('starting from the end replays rather than doing nothing', () => {
  const h = harness(60, { duration: 10 })
  h.clock.seek(10)
  h.clock.start()
  h.advance(6)
  assert.ok(h.clock.frame < 10, 'a play button that does nothing looks broken')
})

test('scrubbing yields the playhead while the drag lasts', () => {
  const h = harness(60)
  h.clock.start()
  h.advance(30)
  const before = h.clock.frame

  h.clock.setYielding(true)
  h.advance(600)
  assert.equal(h.clock.frame, before, 'ten seconds of ticks advance the playhead by zero')

  h.clock.setYielding(false)
  h.advance(60)
  assert.equal(h.clock.frame, before + 30, 'and it picks up again on release')
})

test('a drag that outlives the frame callbacks still resumes where it left off', () => {
  // The case the previous test cannot see. While ticks keep arriving, each yielded tick
  // re-anchors, so the anchor is fresh by the time the drag ends whether or not releasing
  // re-anchors too. But `requestAnimationFrame` stops for an occluded or backgrounded
  // window, and then nothing re-anchors for the whole drag — so releasing has to, or the
  // first tick afterwards computes its elapsed time from before the drag began and the
  // playhead jumps forward by however long the user was holding the mouse down.
  const h = harness(60)
  h.clock.start()
  h.advance(30)
  const before = h.clock.frame

  h.clock.setYielding(true)
  h.idle(5000)
  h.clock.setYielding(false)
  h.advance(60)

  assert.equal(
    h.clock.frame,
    before + 30,
    'one second of ticks after the drag is one second of timeline, not five'
  )
})

test('a long drag banks no time even while ticks keep arriving', () => {
  // The other half of the pair above: ticks throughout, rather than none at all.
  const h = harness(60)
  h.clock.start()
  h.advance(30)
  const before = h.clock.frame

  h.clock.setYielding(true)
  h.advance(600)
  h.advance(1)
  assert.equal(h.clock.frame, before, 'ten seconds of yielded ticks bank nothing')
})

test('the store echoing the playhead back does not slow playback', () => {
  // Exactly what the engine does: every dispatched frame is written to the store, which
  // notifies, which calls seek() with the frame we just produced. If seek re-anchored on
  // that, each frame would take a full 1/fps measured from the echo and playback would
  // drift slow — by an amount that depends on how fast React happens to be.
  const h = harness(120)
  h.clock.onFrame((frame) => h.clock.seek(frame))
  h.clock.start()
  h.advance(240)
  assert.equal(h.clock.frame, 60)
})

test('seek draws only when the frame actually changes', () => {
  const h = harness(60)
  h.clock.seek(12)
  h.clock.seek(12)
  h.clock.seek(12)
  assert.deepEqual(h.frames, [12], 'three seeks to the same frame are one picture')
  assert.equal(h.clock.stats().pictures, 1)
})

test('seek clamps to the timeline rather than running off it', () => {
  const h = harness(60, { duration: 10 })
  h.clock.seek(500)
  assert.equal(h.clock.frame, 10)
  h.clock.seek(-500)
  assert.equal(h.clock.frame, 0)
  h.clock.seek(Number.NaN)
  assert.equal(h.clock.frame, 0, 'a NaN playhead must not poison the clock')
})

test('composite percentiles come from a bounded rolling window', () => {
  const clock = new PlaybackClock({ sampleWindow: 100 })
  for (let ms = 1; ms <= 100; ms += 1) clock.recordComposite(ms)
  const stats = clock.stats()
  assert.equal(stats.compositeP50Ms, 50)
  assert.equal(stats.compositeP99Ms, 99)
  assert.equal(stats.samples, 100)

  const small = new PlaybackClock({ sampleWindow: 4 })
  for (let ms = 1; ms <= 10; ms += 1) small.recordComposite(ms)
  const rolled = small.stats()
  assert.equal(rolled.samples, 4, 'the window is a ring, not a growing array')
  assert.equal(rolled.compositeP50Ms, 8, 'and it holds the most recent samples')
  assert.equal(rolled.compositeP99Ms, 10)
})

test('percentiles of nothing are zero, not NaN', () => {
  const stats = new PlaybackClock().stats()
  assert.equal(stats.compositeP50Ms, 0)
  assert.equal(stats.compositeP99Ms, 0)
  assert.equal(stats.samples, 0)
  new PlaybackClock().recordComposite(Number.NaN)
})

test('an empty timeline never starts', () => {
  const h = harness(60, { duration: 0 })
  h.clock.start()
  h.advance(60)
  assert.equal(h.clock.running, false)
  assert.deepEqual(h.frames, [])
})

test('changing the project frame rate mid-playback does not jump the playhead', () => {
  const h = harness(60)
  h.clock.start()
  h.advance(30)
  const before = h.clock.frame
  h.clock.setFps(60)
  h.advance(1)
  assert.ok(
    h.clock.frame >= before && h.clock.frame <= before + 2,
    `re-anchoring on an fps change must not reinterpret elapsed time at the new rate (got ${h.clock.frame} from ${before})`
  )
})
