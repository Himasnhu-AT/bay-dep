/**
 * Slip, slide and roll.
 *
 * Assertions are written against **what the viewer sees at a frame** — which source, at which
 * microsecond — rather than against `from` and `sourceStartUs`, because those are how the
 * requirement happens to be implemented and the picture is the requirement. Each operation
 * has a sentence that says what must stay still, and the tests check exactly that sentence.
 *
 * Every refusal is paired with the nearest legal call, which must succeed: a planner that
 * refused everything would pass every refusal test on its own.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyTrimPlan, planTrim, sourceRoom, transitionsAfterTrim, type TrimPlan } from './trim'
import {
  framesToUs,
  itemEnd,
  resolveTransition,
  type Asset,
  type Item,
  type Project,
  type Timeline,
  type Track
} from './project'

const FPS = 30

function asset(id: string, seconds: number, kind: Asset['kind'] = 'video'): Asset {
  return {
    id,
    kind,
    name: `${id}.mp4`,
    path: seconds > 0 ? `/m/${id}.mp4` : null,
    durationUs: Math.round(seconds * 1_000_000),
    width: 1920,
    height: 1080,
    fps: seconds > 0 ? FPS : null,
    hasAudio: false,
    hasVideo: seconds > 0,
    posterPath: null,
    waveformPath: null,
    createdAt: 0
  }
}

function item(
  partial: Partial<Item> & Pick<Item, 'id' | 'from' | 'durationInFrames'>
): Item {
  return {
    assetId: 'long',
    trackId: 'v1',
    sourceStartUs: 0,
    layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
    volume: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    speed: 1,
    ...partial
  }
}

/** Source offset of `frames` timeline frames in, as the model stores it. */
const at = (frames: number): number => framesToUs(frames, FPS)

function world(items: Item[], opts: { locked?: boolean; assets?: Asset[] } = {}): {
  project: Project
  timeline: Timeline
} {
  const track: Track = {
    id: 'v1',
    kind: 'video',
    name: 'V1',
    locked: opts.locked ?? false,
    muted: false,
    hidden: false,
    items: items.map((i) => ({ ...i, trackId: 'v1' }))
  }
  const timeline: Timeline = {
    id: 'tl',
    name: 'Timeline',
    fps: FPS,
    width: 1920,
    height: 1080,
    background: '#000000',
    tracks: [track],
    transitions: []
  }
  const project: Project = {
    id: 'p',
    name: 'p',
    version: 1,
    // `long` has two minutes of footage (3600 frames), `short` exactly 60 frames, and `still`
    // has no duration at all.
    assets: opts.assets ?? [asset('long', 120), asset('short', 2), asset('still', 0, 'image')],
    timelines: [timeline],
    activeTimelineId: 'tl',
    createdAt: 0,
    updatedAt: 0
  }
  return { project, timeline }
}

/** What is on screen at a frame: the only thing the viewer can perceive. */
function playingAt(tl: Timeline, frame: number): { id: string; sourceUs: number } | null {
  for (const i of tl.tracks[0]!.items) {
    if (frame >= i.from && frame < itemEnd(i)) {
      return { id: i.id, sourceUs: i.sourceStartUs + Math.round(framesToUs(frame - i.from, FPS) * i.speed) }
    }
  }
  return null
}

function trackEnd(tl: Timeline): number {
  return Math.max(0, ...tl.tracks[0]!.items.map(itemEnd))
}

function mustPlan(result: ReturnType<typeof planTrim>): TrimPlan {
  if (!result.ok) assert.fail(`expected the trim to be accepted, but it was refused: ${result.error}`)
  return result
}

function apply(w: { project: Project; timeline: Timeline }, spec: Parameters<typeof planTrim>[2]): TrimPlan {
  const plan = mustPlan(planTrim(w.project, w.timeline, spec))
  applyTrimPlan(w.timeline, plan)
  return plan
}

function assertNoOverlaps(tl: Timeline): void {
  const items = [...tl.tracks[0]!.items].sort((a, b) => a.from - b.from)
  for (let i = 1; i < items.length; i += 1) {
    assert.ok(itemEnd(items[i - 1]!) <= items[i]!.from, `${items[i - 1]!.id} overlaps ${items[i]!.id}`)
  }
  for (const i of items) assert.ok(i.durationInFrames >= 1, `${i.id} has no length`)
}

// ---------------------------------------------------------------------------
// slip
// ---------------------------------------------------------------------------

test('slip keeps the clip where it is and shows later footage by exactly the delta', () => {
  const w = world([item({ id: 'a', from: 100, durationInFrames: 60, sourceStartUs: at(300) })])
  const expected = [100, 130, 159].map((f) => playingAt(w.timeline, f + 45)?.sourceUs ?? at(300 + f - 100 + 45))

  apply(w, { itemId: 'a', mode: 'slip', deltaFrames: 45 })

  const a = w.timeline.tracks[0]!.items[0]!
  assert.equal(a.from, 100, 'a slip must not move the clip on the timeline')
  assert.equal(a.durationInFrames, 60, 'nor change its length')
  ;[100, 130, 159].forEach((f, index) => {
    assert.equal(playingAt(w.timeline, f)!.sourceUs, expected[index], `frame ${f}`)
  })
})

test('a slip past the end of the source is refused with the range that would work, and the maximum works', () => {
  // `short` is 60 frames; the clip reads frames 10..40, so 10 before and 20 after.
  const spec = { id: 'a', from: 0, durationInFrames: 30, assetId: 'short', sourceStartUs: at(10) }
  const w = world([item(spec)])

  const refused = planTrim(w.project, w.timeline, { itemId: 'a', mode: 'slip', deltaFrames: 21 })
  assert.equal(refused.ok, false)
  if (refused.ok) return
  assert.deepEqual(refused.range, { min: -10, max: 20 })
  assert.match(refused.error, /-10 to \+20/, 'the refusal must name the legal range')
  assert.match(refused.error, /20 frames of short\.mp4 come after/, 'and which side ran out')
  // The inspector's toast: the clip by name and the footage in frames, never the item id or
  // `deltaFrames`, which the agent needs and a person cannot act on.
  assert.ok(refused.userMessage, 'a person gets their own sentence')
  assert.match(refused.userMessage, /short\.mp4 has 10 frames of footage before this clip and 20 frames after it/)
  assert.doesNotMatch(refused.userMessage, /deltaFrames|\ba\b is|item /)
  assert.match(refused.error, /Slipping a by/, 'the agent still gets the id')

  apply(w, { itemId: 'a', mode: 'slip', deltaFrames: 20 })
  const a = w.timeline.tracks[0]!.items[0]!
  assert.ok(
    a.sourceStartUs + framesToUs(a.durationInFrames, FPS) <= w.project.assets[1]!.durationUs,
    'the legal maximum must end inside the source'
  )
})

test('a slip back to the very first frame is legal, and lands on exactly zero', () => {
  // at(10) is 333,333µs, which divides back to 9.99999 frames. A plain floor would call the
  // room before the in-point nine frames and refuse the slip back to where the clip started.
  const w = world([item({ id: 'a', from: 0, durationInFrames: 30, sourceStartUs: at(10) })])
  assert.equal(at(10) / (1_000_000 / FPS) < 10, true, 'the specimen must not divide back evenly')

  apply(w, { itemId: 'a', mode: 'slip', deltaFrames: -10 })
  assert.equal(w.timeline.tracks[0]!.items[0]!.sourceStartUs, 0)

  const refused = planTrim(w.project, w.timeline, { itemId: 'a', mode: 'slip', deltaFrames: -1 })
  assert.equal(refused.ok, false, 'and not one frame further')
  if (!refused.ok) assert.match(refused.error, /only 0 frames of long\.mp4 come before/)
})

test('a read point a microsecond off a frame boundary still keeps the window inside the source', () => {
  // Both specimens pass the whole-frame room check by less than the epsilon, so the move lands
  // a microsecond outside the source unless the result is held inside it.
  const low = world([item({ id: 'a', from: 0, durationInFrames: 30, sourceStartUs: at(10) - 1 })])
  assert.equal(sourceRoom(low.project.assets[0], low.timeline.tracks[0]!.items[0]!, FPS).before, 10)
  apply(low, { itemId: 'a', mode: 'slip', deltaFrames: -10 })
  assert.equal(low.timeline.tracks[0]!.items[0]!.sourceStartUs, 0, 'never a negative read point')

  const high = world([
    item({ id: 'a', from: 0, durationInFrames: 30, assetId: 'short', sourceStartUs: at(10) + 1 })
  ])
  assert.equal(sourceRoom(high.project.assets[1], high.timeline.tracks[0]!.items[0]!, FPS).after, 20)
  apply(high, { itemId: 'a', mode: 'slip', deltaFrames: 20 })
  const a = high.timeline.tracks[0]!.items[0]!
  assert.ok(
    a.sourceStartUs + framesToUs(a.durationInFrames, FPS) <= high.project.assets[1]!.durationUs,
    'the window must end inside the source, not a microsecond past it'
  )
})

test('slip honours speed: a clip at 2x spends two source frames per timeline frame', () => {
  const w = world([item({ id: 'a', from: 0, durationInFrames: 30, sourceStartUs: at(100), speed: 2 })])
  const room = sourceRoom(w.project.assets[0], w.timeline.tracks[0]!.items[0]!, FPS)
  assert.equal(room.before, 50, 'a hundred source frames before is fifty timeline frames at 2x')

  const before = playingAt(w.timeline, 0)!.sourceUs
  apply(w, { itemId: 'a', mode: 'slip', deltaFrames: 5 })
  // Within a microsecond: `at(10)` and `2 × at(5)` are two separate roundings of the same time.
  assert.ok(Math.abs(playingAt(w.timeline, 0)!.sourceUs - before - at(10)) <= 1)
})

test('slipping a still is refused, because every read point shows the same picture', () => {
  const w = world([
    item({ id: 's', from: 0, durationInFrames: 30, assetId: 'still' }),
    item({ id: 'v', from: 40, durationInFrames: 30, sourceStartUs: at(50) })
  ])
  const refused = planTrim(w.project, w.timeline, { itemId: 's', mode: 'slip', deltaFrames: 5 })
  assert.equal(refused.ok, false)
  if (!refused.ok) assert.match(refused.error, /no source duration/)

  // The nearest legal call: the same slip on a clip that has a source window.
  apply(w, { itemId: 'v', mode: 'slip', deltaFrames: 5 })
})

// ---------------------------------------------------------------------------
// slide
// ---------------------------------------------------------------------------

function threeInARow(): ReturnType<typeof world> {
  // L reads 100..160, X reads 1000..1030, R reads 2000..2060 — all of `long`, handles on every side.
  return world([
    item({ id: 'L', from: 0, durationInFrames: 60, sourceStartUs: at(100) }),
    item({ id: 'X', from: 60, durationInFrames: 30, sourceStartUs: at(1000) }),
    item({ id: 'R', from: 90, durationInFrames: 60, sourceStartUs: at(2000) })
  ])
}

test('slide moves the clip and its content together while the neighbours absorb it, and the track keeps its length', () => {
  const w = threeInARow()
  const endBefore = trackEnd(w.timeline)
  const xContent = playingAt(w.timeline, 60)!.sourceUs
  const lHead = playingAt(w.timeline, 10)!
  const rTail = playingAt(w.timeline, 149)!

  apply(w, { itemId: 'X', mode: 'slide', deltaFrames: 12 })

  assert.equal(trackEnd(w.timeline), endBefore, 'a slide must not change the track length')
  assert.deepEqual(playingAt(w.timeline, 72), { id: 'X', sourceUs: xContent }, 'X plays the same footage, 12 frames later')
  assert.deepEqual(playingAt(w.timeline, 10), lHead, 'L before its out-point is untouched')
  assert.deepEqual(playingAt(w.timeline, 149), rTail, "R's out-point is untouched")
  // The frames X vacated are now L continuing — its own footage, not a freeze or a gap.
  assert.deepEqual(playingAt(w.timeline, 65), { id: 'L', sourceUs: at(165) })
  assertNoOverlaps(w.timeline)
})

test('sliding left is the mirror: L gives up frames and R reveals footage from before its in-point', () => {
  const w = threeInARow()
  apply(w, { itemId: 'X', mode: 'slide', deltaFrames: -20 })

  assert.deepEqual(playingAt(w.timeline, 40), { id: 'X', sourceUs: at(1000) })
  assert.deepEqual(playingAt(w.timeline, 70), { id: 'R', sourceUs: at(1980) })
  assert.equal(trackEnd(w.timeline), 150)
  assertNoOverlaps(w.timeline)
})

test('a slide that would shrink a neighbour to nothing is refused naming both limits, and the limit itself works', () => {
  const w = threeInARow()
  const refused = planTrim(w.project, w.timeline, { itemId: 'X', mode: 'slide', deltaFrames: 60 })
  assert.equal(refused.ok, false)
  if (refused.ok) return
  assert.deepEqual(refused.range, { min: -59, max: 59 })
  assert.match(refused.error, /-59 to \+59/)
  assert.match(refused.error, /R after it is 60 frames long and must keep at least 1/)

  apply(w, { itemId: 'X', mode: 'slide', deltaFrames: 59 })
  const r = w.timeline.tracks[0]!.items.find((i) => i.id === 'R')!
  assert.equal(r.durationInFrames, 1)
})

test('a slide that would run the left neighbour out of footage is refused naming it', () => {
  // L ends exactly at the end of `short`, so it has no footage past its out-point to extend into.
  const w = world([
    item({ id: 'L', from: 0, durationInFrames: 30, assetId: 'short', sourceStartUs: at(30) }),
    item({ id: 'X', from: 30, durationInFrames: 30, sourceStartUs: at(500) }),
    item({ id: 'R', from: 60, durationInFrames: 60, sourceStartUs: at(2000) })
  ])
  const refused = planTrim(w.project, w.timeline, { itemId: 'X', mode: 'slide', deltaFrames: 1 })
  assert.equal(refused.ok, false)
  if (refused.ok) return
  assert.equal(refused.range?.max, 0)
  assert.match(refused.error, /L before it has only 0 frames of source after its out-point/)

  // The other direction still has room, and must still work.
  apply(w, { itemId: 'X', mode: 'slide', deltaFrames: -5 })
})

test('sliding left is limited by the footage the right neighbour has before its in-point', () => {
  const w = world([
    item({ id: 'L', from: 0, durationInFrames: 60, sourceStartUs: at(100) }),
    item({ id: 'X', from: 60, durationInFrames: 30, sourceStartUs: at(1000) }),
    item({ id: 'R', from: 90, durationInFrames: 60, sourceStartUs: at(7) })
  ])
  const refused = planTrim(w.project, w.timeline, { itemId: 'X', mode: 'slide', deltaFrames: -8 })
  assert.equal(refused.ok, false)
  if (!refused.ok) assert.match(refused.error, /R after it has only 7 frames of source before its in-point/)
  apply(w, { itemId: 'X', mode: 'slide', deltaFrames: -7 })
  assert.equal(w.timeline.tracks[0]!.items.find((i) => i.id === 'R')!.sourceStartUs, 0)
})

test('a gap on one side absorbs a slide up to its own size', () => {
  const w = world([
    item({ id: 'L', from: 0, durationInFrames: 60, sourceStartUs: at(100) }),
    item({ id: 'X', from: 60, durationInFrames: 30, sourceStartUs: at(1000) }),
    item({ id: 'R', from: 100, durationInFrames: 60, sourceStartUs: at(2000) })
  ])
  const refused = planTrim(w.project, w.timeline, { itemId: 'X', mode: 'slide', deltaFrames: 11 })
  assert.equal(refused.ok, false)
  if (!refused.ok) assert.match(refused.error, /only 10 free frames after it/)

  apply(w, { itemId: 'X', mode: 'slide', deltaFrames: 10 })
  const r = w.timeline.tracks[0]!.items.find((i) => i.id === 'R')!
  assert.equal(r.from, 100, 'a gap absorbed the move, so R did not change')
  assert.equal(r.sourceStartUs, at(2000))
  assertNoOverlaps(w.timeline)
})

test('a slide with no neighbour on either side is refused as a move, and one with a neighbour is not', () => {
  const alone = world([item({ id: 'X', from: 60, durationInFrames: 30 })])
  const refused = planTrim(alone.project, alone.timeline, { itemId: 'X', mode: 'slide', deltaFrames: 5 })
  assert.equal(refused.ok, false)
  if (!refused.ok) assert.match(refused.error, /edit_item/, 'the refusal must name the tool that does a move')

  apply(threeInARow(), { itemId: 'X', mode: 'slide', deltaFrames: 5 })
})

test('a neighbour shortened below its fades has its fades clamped to its new length', () => {
  const w = world([
    item({ id: 'X', from: 0, durationInFrames: 30, sourceStartUs: at(1000) }),
    item({ id: 'R', from: 30, durationInFrames: 60, sourceStartUs: at(2000), fadeInFrames: 20, fadeOutFrames: 20 })
  ])
  apply(w, { itemId: 'X', mode: 'slide', deltaFrames: 50 })
  const r = w.timeline.tracks[0]!.items.find((i) => i.id === 'R')!
  assert.equal(r.durationInFrames, 10)
  assert.ok(r.fadeInFrames <= 10 && r.fadeOutFrames <= 10)
})

// ---------------------------------------------------------------------------
// roll
// ---------------------------------------------------------------------------

test('roll moves the cut and nothing else: both far edges stay, both clips keep their footage', () => {
  const w = world([
    item({ id: 'A', from: 0, durationInFrames: 60, sourceStartUs: at(100) }),
    item({ id: 'B', from: 60, durationInFrames: 60, sourceStartUs: at(2000) })
  ])
  const aHead = playingAt(w.timeline, 0)
  const bTail = playingAt(w.timeline, 119)

  apply(w, { itemId: 'A', mode: 'roll', deltaFrames: 15 })

  assert.deepEqual(playingAt(w.timeline, 0), aHead)
  assert.deepEqual(playingAt(w.timeline, 119), bTail)
  assert.deepEqual(playingAt(w.timeline, 74), { id: 'A', sourceUs: at(174) }, 'A plays on into its handle')
  assert.deepEqual(playingAt(w.timeline, 75), { id: 'B', sourceUs: at(2015) }, 'B picks up where it always would have at that frame')
  assert.equal(trackEnd(w.timeline), 120)
})

test('a roll past the handle is refused naming which side ran out, and the most it allows works', () => {
  const w = world([
    item({ id: 'A', from: 0, durationInFrames: 30, assetId: 'short', sourceStartUs: at(22) }),
    item({ id: 'B', from: 30, durationInFrames: 60, sourceStartUs: at(2000) })
  ])
  const refused = planTrim(w.project, w.timeline, { itemId: 'A', mode: 'roll', deltaFrames: 9 })
  assert.equal(refused.ok, false)
  if (refused.ok) return
  assert.equal(refused.range?.max, 8)
  assert.match(refused.error, /A before the cut has only 8 frames of source after its out-point/)

  apply(w, { itemId: 'A', mode: 'roll', deltaFrames: 8 })
})

test('roll with edge "start" rolls the cut before the clip, with the clip that ends there', () => {
  const w = world([
    item({ id: 'A', from: 0, durationInFrames: 60, sourceStartUs: at(100) }),
    item({ id: 'B', from: 60, durationInFrames: 60, sourceStartUs: at(2000) })
  ])
  apply(w, { itemId: 'B', mode: 'roll', deltaFrames: -10, edge: 'start' })
  const [a, b] = w.timeline.tracks[0]!.items
  assert.equal(itemEnd(a!), 50)
  assert.equal(b!.from, 50)
  // Within a microsecond, for the same reason as the speed test: two roundings of one time.
  assert.ok(Math.abs(b!.sourceStartUs - at(1990)) <= 1)
})

test('a roll where there is no cut is refused naming the gap, and a roll at a real cut is not', () => {
  const w = world([
    item({ id: 'A', from: 0, durationInFrames: 60, sourceStartUs: at(100) }),
    item({ id: 'B', from: 70, durationInFrames: 60, sourceStartUs: at(2000) })
  ])
  const refused = planTrim(w.project, w.timeline, { itemId: 'A', mode: 'roll', deltaFrames: 5 })
  assert.equal(refused.ok, false)
  if (!refused.ok) assert.match(refused.error, /10 free frames there/)

  const abutting = world([
    item({ id: 'A', from: 0, durationInFrames: 60, sourceStartUs: at(100) }),
    item({ id: 'B', from: 60, durationInFrames: 60, sourceStartUs: at(2000) })
  ])
  apply(abutting, { itemId: 'A', mode: 'roll', deltaFrames: 5 })
})

// ---------------------------------------------------------------------------
// shared refusals
// ---------------------------------------------------------------------------

test('a zero delta is refused, and the refusal says how far this trim could go', () => {
  const w = threeInARow()
  const refused = planTrim(w.project, w.timeline, { itemId: 'X', mode: 'slide', deltaFrames: 0 })
  assert.equal(refused.ok, false)
  if (!refused.ok) {
    assert.deepEqual(refused.range, { min: -59, max: 59 })
    assert.match(refused.error, /-59 to \+59/)
  }
})

test('edge is refused outside roll rather than silently ignored', () => {
  const w = threeInARow()
  const refused = planTrim(w.project, w.timeline, { itemId: 'X', mode: 'slip', deltaFrames: 3, edge: 'end' })
  assert.equal(refused.ok, false)
  if (!refused.ok) assert.match(refused.error, /omit edge/)
  apply(w, { itemId: 'X', mode: 'slip', deltaFrames: 3 })
})

test('a locked track refuses every mode, and the same trim on an unlocked one is accepted', () => {
  const items = threeInARow().timeline.tracks[0]!.items
  const locked = world(items, { locked: true })
  for (const mode of ['slip', 'slide', 'roll'] as const) {
    const refused = planTrim(locked.project, locked.timeline, { itemId: 'X', mode, deltaFrames: 3 })
    assert.equal(refused.ok, false, mode)
    if (!refused.ok) assert.match(refused.error, /V1 is locked/)
  }
  const unlocked = world(items)
  for (const mode of ['slip', 'slide', 'roll'] as const) {
    mustPlan(planTrim(unlocked.project, unlocked.timeline, { itemId: 'X', mode, deltaFrames: 3 }))
  }
})

test('planning never mutates: a refused and an accepted plan both leave the timeline as it was', () => {
  const w = threeInARow()
  const before = JSON.stringify(w.timeline)
  planTrim(w.project, w.timeline, { itemId: 'X', mode: 'slide', deltaFrames: 999 })
  mustPlan(planTrim(w.project, w.timeline, { itemId: 'X', mode: 'slide', deltaFrames: 5 }))
  assert.equal(JSON.stringify(w.timeline), before)
})

// ---------------------------------------------------------------------------
// transitions
// ---------------------------------------------------------------------------

test('every junction that had a transition still abuts after each mode, and the transition is kept', () => {
  for (const [mode, delta] of [['slip', 5], ['slide', 7], ['slide', -7], ['roll', 6], ['roll', -6]] as const) {
    const w = threeInARow()
    w.timeline.transitions = [
      { id: 't1', kind: 'cross-dissolve', fromItemId: 'L', toItemId: 'X', durationInFrames: 10 },
      { id: 't2', kind: 'cross-dissolve', fromItemId: 'X', toItemId: 'R', durationInFrames: 10 }
    ]
    apply(w, { itemId: 'X', mode, deltaFrames: delta })
    assert.equal(w.timeline.transitions.length, 2, `${mode} ${delta} must not drop a transition`)
    for (const t of w.timeline.transitions) {
      assert.ok(resolveTransition(w.project, w.timeline, t), `${mode} ${delta}: ${t.id} no longer resolves`)
    }
  }
})

test('a roll that eats a transition\'s handle reports the shorter window rather than hiding it', () => {
  // A has 12 frames of footage past its out-point; a 20-frame dissolve wants 10 of them.
  const w = world([
    item({ id: 'A', from: 0, durationInFrames: 30, assetId: 'short', sourceStartUs: at(18) }),
    item({ id: 'B', from: 30, durationInFrames: 60, sourceStartUs: at(2000) })
  ])
  w.timeline.transitions = [
    { id: 't', kind: 'cross-dissolve', fromItemId: 'A', toItemId: 'B', durationInFrames: 20 }
  ]
  assert.equal(resolveTransition(w.project, w.timeline, w.timeline.transitions[0]!)?.durationInFrames, 20)

  const plan = apply(w, { itemId: 'A', mode: 'roll', deltaFrames: 8 })
  const [report] = transitionsAfterTrim(w.project, w.timeline, plan)
  assert.equal(report?.transitionId, 't')
  assert.equal(report?.requestedDurationInFrames, 20)
  assert.equal(report?.effectiveDurationInFrames, 8, 'four frames of handle left, so four each side')
  assert.match(report?.clampedBecause ?? '', /outgoing clip has only 4 frames/)
})
