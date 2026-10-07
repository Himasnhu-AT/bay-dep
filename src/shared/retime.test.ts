/**
 * Reverse and speed ramps through the edits a clip lives through: the retime plan, splits, trims,
 * ripples, links, and the readers that map source time back onto the timeline.
 *
 * The standard throughout is **what plays**: an edit that is not meant to change the picture is
 * checked by reading the source time of every frame before and after, not by reading fields.
 * Each refusal is paired with the nearest call that must succeed.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { itemAudioGainAt } from './audio-gain'
import { timelineFrameAt, beatFramesForItem, type BeatGrid } from './beats'
import { joinPair } from './heal'
import { insertTime } from './insert-edit'
import { animationStateAt, animationWindows, isAtRest } from './animation'
import { KEYFRAME_REGISTRY, WRITABLE_KEYFRAME_PROPERTIES, keyframeInfo } from './keyframe-registry'
import { animatedItemAt, DRAWN_KEYFRAME_PROPERTIES, mergeKeyframes, volumeMayBeAudible } from './keyframes'
import { detachAudio, linkedPartners, soundAlignedWithPicture } from './links'
import {
  findItem,
  itemEnd,
  KEYFRAME_PROPERTIES,
  plainTime,
  sameSourceTiming,
  sourceEdgeAt,
  sourceSpanOf,
  sourceTimeAt,
  type Asset,
  type Item,
  type Keyframe,
  type Project,
  type Timeline,
  type Track
} from './project'
import { retimeSound } from './retime-sound'
import { rippleDelete } from './ripple'
import { applySpeedPlan, footageLength, planRetime, planSpeed, speedNote, trimBounds } from './speed'
import { consumedFrames, speedKeysOf } from './speed-curve'
import { footageFramesOf, readSpeedRamp } from './speed-ramp'
import { splitItemAt } from './split'
import { segmentsToCues } from './transcribe'
import { applyTrimPlan, planTrim, sourceRoom } from './trim'

const FPS = 30

function asset(id: string, seconds: number, over: Partial<Asset> = {}): Asset {
  return {
    id, kind: 'video', name: `${id}.mp4`, path: `/m/${id}.mp4`, durationUs: seconds * 1_000_000, width: 1920, height: 1080,
    fps: FPS, hasAudio: true, hasVideo: true, posterPath: null, waveformPath: null, createdAt: 0, ...over
  }
}

function clip(id: string, assetId: string, trackId: string, from: number, duration: number, over: Partial<Item> = {}): Item {
  return {
    id, assetId, trackId, from, durationInFrames: duration, sourceStartUs: 0,
    layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
    volume: 1, fadeInFrames: 0, fadeOutFrames: 0, speed: 1, ...over
  }
}

function track(id: string, kind: Track['kind'], items: Item[]): Track {
  return { id, kind, name: id.toUpperCase(), locked: false, muted: false, hidden: false, items }
}

/** V1: A (2 s…5 s of a 10 s file) at 100, then B at 300. A1: empty. */
function fixture(over: Partial<Item> = {}): { project: Project; timeline: Timeline } {
  const timeline: Timeline = {
    id: 'tl', name: 'T', fps: FPS, width: 1920, height: 1080, background: '#000', transitions: [],
    tracks: [
      track('v1', 'video', [clip('a', 'A', 'v1', 100, 90, { sourceStartUs: 2_000_000, ...over }), clip('b', 'B', 'v1', 300, 60)]),
      track('a1', 'audio', [])
    ]
  }
  return {
    timeline,
    project: { id: 'p', name: 'P', version: 1, assets: [asset('A', 10), asset('B', 10)], timelines: [timeline], activeTimelineId: 'tl', createdAt: 0, updatedAt: 0 }
  }
}

const DIP: Keyframe[] = [
  { frame: 20, value: 1, ease: 'inOut' },
  { frame: 30, value: 0.25 },
  { frame: 60, value: 0.25, ease: 'inOut' },
  { frame: 70, value: 1 }
]

/** Where `item` reads `rel` frames in — the read point a head trim of `rel` frames leaves it with. */
const sourceTimeAtBoundary = (item: Item, rel: number): number => sourceEdgeAt(item, rel, FPS)

/** The source time every timeline frame of track `trackId` plays, by frame — "what plays". */
function plays(timeline: Timeline, trackId: string): Map<number, string> {
  const out = new Map<number, string>()
  for (const item of timeline.tracks.find((t) => t.id === trackId)!.items) {
    for (let frame = item.from; frame < itemEnd(item); frame += 1) out.set(frame, `${item.assetId}@${sourceTimeAt(item, frame, timeline.fps)}`)
  }
  return out
}

/** As `plays`, but allowing the microsecond a re-based sum may round differently. */
function assertSamePicture(before: Map<number, string>, after: Map<number, string>, shift: (frame: number) => number | null, what: string): void {
  let compared = 0
  for (const [frame, was] of before) {
    const to = shift(frame)
    if (to === null) continue
    const now = after.get(to)
    assert.ok(now, `${what}: frame ${frame} → ${to} still plays something`)
    const [wasAsset, wasUs] = was.split('@')
    const [nowAsset, nowUs] = now.split('@')
    assert.equal(nowAsset, wasAsset, `${what}: frame ${frame}`)
    assert.ok(Math.abs(Number(nowUs) - Number(wasUs)) <= 2, `${what}: frame ${frame} read ${wasUs}, now ${nowUs}`)
    compared += 1
  }
  assert.ok(compared > 0, `${what}: compared nothing`)
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

test('reverse keeps the clip’s place, length and footage, and reversing twice is exactly where it began', () => {
  const { project, timeline } = fixture()
  const before = structuredClone(findItem(timeline, 'a')!.item)
  const span = sourceSpanOf(before, FPS)
  const plan = planRetime(project, timeline, 'a', { reverse: true })!
  assert.equal(plan.length, 90)
  assert.equal(plan.clampedBy, null)
  applySpeedPlan(timeline, plan)
  const reversed = findItem(timeline, 'a')!.item
  assert.equal(reversed.reverse, true)
  assert.equal(reversed.from, 100)
  assert.equal(reversed.durationInFrames, 90)
  assert.equal(reversed.sourceStartUs, 5_000_000, 'it starts reading at the late edge of the same footage')
  assert.deepEqual(sourceSpanOf(reversed, FPS), span)
  assert.equal(sourceTimeAt(reversed, 189, FPS), 2_000_000, 'its last frame is the footage’s first')
  assert.equal(sourceTimeAt(reversed, 100, FPS), sourceTimeAt(before, 189, FPS), 'its first frame is the footage’s last')
  applySpeedPlan(timeline, planRetime(project, timeline, 'a', { reverse: false })!)
  assert.deepEqual(findItem(timeline, 'a')!.item, before, 'forwards again: the same item, field for field')
  // Asking for the direction it already has plans nothing.
  assert.equal(planRetime(project, timeline, 'a', { reverse: false })!.reverse, undefined)
})

test('a ramp keeps the footage, so the clip’s length is the curve’s — and a constant speed still plans as it always did', () => {
  const { project, timeline } = fixture()
  const footage = footageFramesOf(findItem(timeline, 'a')!.item)
  assert.equal(footage, 90)
  const plan = planRetime(project, timeline, 'a', { ramp: DIP })!
  // 90 frames of footage: 20 at 1×, then the dip. Longer than 90, and found from the curve.
  assert.ok(plan.wanted > 90, `wanted ${plan.wanted}`)
  assert.equal(plan.length, plan.wanted)
  applySpeedPlan(timeline, plan)
  const ramped = findItem(timeline, 'a')!.item
  assert.deepEqual(speedKeysOf(ramped), DIP)
  // It reads the footage it read before, to within the last frame's rounding.
  assert.ok(Math.abs(consumedFrames(ramped, ramped.durationInFrames) - footage) <= 0.5, `consumed ${consumedFrames(ramped, ramped.durationInFrames)}`)
  assert.equal(sourceTimeAt(ramped, 100, FPS), 2_000_000)
  // A constant speed on the ramped clip replaces the ramp, and the footage is still kept.
  const constant = planRetime(project, timeline, 'a', { speed: 2 })!
  assert.equal(constant.ramp, null)
  applySpeedPlan(timeline, constant)
  const fast = findItem(timeline, 'a')!.item
  assert.equal(fast.keyframes, undefined)
  assert.equal(fast.speed, 2)
  assert.ok(Math.abs(fast.durationInFrames * 2 - footage) <= 1)

  // The literal for the no-keys case: planSpeed on a plain clip is the arithmetic it had.
  const plain = fixture()
  const twice = planSpeed(plain.project, plain.timeline, 'a', 2)!
  assert.deepEqual(
    { speed: twice.speed, fromLength: twice.fromLength, wanted: twice.wanted, length: twice.length, clampedBy: twice.clampedBy, ramp: twice.ramp, reverse: twice.reverse },
    { speed: 2, fromLength: 90, wanted: 45, length: 45, clampedBy: null, ramp: undefined, reverse: undefined }
  )
  applySpeedPlan(plain.timeline, twice)
  assert.deepEqual(Object.keys(findItem(plain.timeline, 'a')!.item).sort(), Object.keys(clip('a', 'A', 'v1', 0, 1)).sort(), 'no new field on a plain clip')
})

test('a ramp that outgrows its gap stops at the next clip and says so; with ripple the next clip moves instead', () => {
  // 200 frames of footage ramped down needs far more than the 200 free frames before B at 300.
  const slow: Keyframe[] = [{ frame: 0, value: 0.25 }]
  const { project, timeline } = fixture({ durationInFrames: 200 })
  const plan = planRetime(project, timeline, 'a', { ramp: slow })!
  assert.equal(plan.wanted, 800)
  assert.equal(plan.length, 200)
  assert.deepEqual(plan.clampedBy, { kind: 'next-clip', itemId: 'b', trackId: 'v1', at: 300 })
  assert.match(speedNote(project, timeline, plan, String)!, /starts at 300/)
  // The twin: the same ramp with ripple fits, and names what moved.
  const rippled = planRetime(project, timeline, 'a', { ramp: slow }, { ripple: true })!
  assert.equal(rippled.length, 800)
  assert.equal(rippled.clampedBy, null)
  assert.deepEqual(rippled.shifts, [{ itemId: 'b', to: 900 }])
  applySpeedPlan(timeline, rippled)
  assert.equal(findItem(timeline, 'b')!.item.from, 900)
  assert.equal(itemEnd(findItem(timeline, 'a')!.item), 900)
})

test('a ramp cannot read past the end of the file, forwards or reversed', () => {
  // A plays 2 s…8 s of a 10 s file. At a constant 0.5× from 2 s there is 16 s of timeline in 8 s of file.
  const { project, timeline } = fixture({ durationInFrames: 180 })
  timeline.tracks[0]!.items = timeline.tracks[0]!.items.filter((item) => item.id === 'a')
  const item = findItem(timeline, 'a')!.item
  assert.equal(footageLength({ ...item, keyframes: { speed: [{ frame: 0, value: 0.5 }] } }, 10_000_000, FPS), 480)
  // Reversed, the clip reads down from 8 s: at 0.5× there are 16 s of timeline before it reaches 0.
  applySpeedPlan(timeline, planRetime(project, timeline, 'a', { reverse: true })!)
  const reversed = findItem(timeline, 'a')!.item
  assert.equal(reversed.sourceStartUs, 8_000_000)
  assert.equal(footageLength({ ...reversed, keyframes: { speed: [{ frame: 0, value: 0.5 }] } }, 10_000_000, FPS), 480)
  assert.equal(footageLength(reversed, 10_000_000, FPS), 240, 'at 1× it can run back to the start of the file')
  // Its head can be pulled earlier by the 2 s after its late edge, its tail later by the 2 s before its early one.
  assert.deepEqual(sourceRoom(project.assets[0], reversed, FPS), { before: 60, after: 60 })
  assert.deepEqual(trimBounds(reversed, 10_000_000, FPS), { earliestFrom: 40, latestEnd: 340 })
})

test('a clip that reads its whole file is not told it ran out when its ramped length rounds up', () => {
  // All 10 s (300 frames) of the file at 0.7×: 428.57 frames. 428 fit; 429 is the rounding.
  const { project, timeline } = fixture({ sourceStartUs: 0, durationInFrames: 300 })
  timeline.tracks[0]!.items = timeline.tracks[0]!.items.filter((item) => item.id === 'a')
  const plan = planRetime(project, timeline, 'a', { ramp: [{ frame: 0, value: 0.7 }] })!
  assert.equal(plan.length, 428)
  assert.equal(plan.clampedBy, null, 'a part frame at the end of the file is not a clamp')
  assert.equal(speedNote(project, timeline, plan, String), null)
  // The twin: the same clip asked for more footage than the file has IS told.
  const short = fixture({ sourceStartUs: 0, durationInFrames: 300 })
  short.timeline.tracks[0]!.items = short.timeline.tracks[0]!.items.filter((item) => item.id === 'a')
  short.project.assets[0]!.durationUs = 8_000_000
  const clamped = planRetime(short.project, short.timeline, 'a', { ramp: [{ frame: 0, value: 0.7 }] })!
  assert.deepEqual(clamped.clampedBy, { kind: 'footage', available: 342 })
  assert.match(speedNote(short.project, short.timeline, clamped, String)!, /footage runs out after 342 frames on this ramp/)
})

test('a curve that never finishes its footage (it ends on a hold) leaves the clip’s length alone', () => {
  // `readSpeedRamp` refuses this from a person or an agent; a project file can still hold one,
  // and Paste Attributes hands a source clip's keys straight to the plan.
  const { project, timeline } = fixture()
  const plan = planRetime(project, timeline, 'a', { ramp: [{ frame: 0, value: 1, ease: 'hold' }, { frame: 30, value: 0 }] })!
  assert.equal(plan.wanted, 90)
  assert.equal(plan.length, 90)
  applySpeedPlan(timeline, plan)
  assert.equal(findItem(timeline, 'a')!.item.durationInFrames, 90)
  // The twin: the same curve ending back at speed has a length of its own.
  const ends = fixture()
  const finite = planRetime(ends.project, ends.timeline, 'a', { ramp: [{ frame: 0, value: 1, ease: 'hold' }, { frame: 30, value: 0, ease: 'hold' }, { frame: 40, value: 1 }] })!
  assert.equal(finite.wanted, 100)
})

test('a still has no footage to reverse or ramp, so a pasted retime leaves it as it was', () => {
  const { project, timeline } = fixture()
  project.assets[0]!.durationUs = 0
  const before = structuredClone(findItem(timeline, 'a')!.item)
  const plan = planRetime(project, timeline, 'a', { reverse: true, ramp: DIP, speed: 1 })!
  assert.equal(plan.reverse, undefined)
  assert.equal(plan.ramp, undefined)
  applySpeedPlan(timeline, plan)
  assert.deepEqual(findItem(timeline, 'a')!.item, before)
})

// ---------------------------------------------------------------------------
// Edits: what plays must not change
// ---------------------------------------------------------------------------

for (const [name, over] of [
  ['reversed', { reverse: true, sourceStartUs: 5_000_000 }],
  ['ramped', { keyframes: { speed: DIP, scale: [{ frame: 0, value: 1 }, { frame: 90, value: 1.2 }] } }],
  ['reversed and ramped', { reverse: true, sourceStartUs: 6_000_000, keyframes: { speed: DIP } }]
] as const) {
  test(`splitting a ${name} clip leaves every frame playing what it played, with its keys`, () => {
    const { timeline } = fixture(structuredClone(over) as Partial<Item>)
    const before = plays(timeline, 'v1')
    const item = findItem(timeline, 'a')!.item
    for (const at of [101, 125, 145, 189]) {
      const copy = structuredClone(timeline)
      const left = findItem(copy, 'a')!.item
      const right = splitItemAt(left, at, FPS, 'r')!
      copy.tracks[0]!.items.push(right)
      assert.equal(itemEnd(left), at)
      assert.equal(right.from, at)
      assert.equal(Boolean(right.reverse), Boolean(item.reverse), 'both halves play the same way')
      assert.equal(Boolean(speedKeysOf(right)), Boolean(speedKeysOf(item)), 'both halves keep the ramp')
      assertSamePicture(before, plays(copy, 'v1'), (frame) => frame, `split at ${at}`)
    }
    // The control: a split that did not move the right half's read point is caught by this check.
    const broken = structuredClone(timeline)
    const left = findItem(broken, 'a')!.item
    const right = splitItemAt(left, 145, FPS, 'r')!
    right.sourceStartUs = left.sourceStartUs
    broken.tracks[0]!.items.push(right)
    assert.throws(() => assertSamePicture(before, plays(broken, 'v1'), (frame) => frame, 'broken split'))
  })

  test(`removing the middle of a ${name} clip keeps what is either side of it`, () => {
    const { timeline } = fixture(structuredClone(over) as Partial<Item>)
    const before = plays(timeline, 'v1')
    let n = 0
    const result = rippleDelete(timeline, 130, 150, () => `new${(n += 1)}`)
    assert.equal(result.removedFrames, 20)
    assert.equal(result.createdItemIds.length, 1)
    assertSamePicture(before, plays(timeline, 'v1'), (frame) => (frame < 130 ? frame : frame < 150 ? null : frame - 20), 'remove 130–150')
  })

  test(`removing the head of a ${name} clip keeps its tail on its footage, keys and all`, () => {
    const { timeline } = fixture(structuredClone(over) as Partial<Item>)
    const before = plays(timeline, 'v1')
    rippleDelete(timeline, 90, 125, () => 'x')
    assertSamePicture(before, plays(timeline, 'v1'), (frame) => (frame < 125 ? null : frame - 35), 'remove 90–125')
    const kept = findItem(timeline, 'a')!.item
    assert.equal(kept.from, 90)
    assert.equal(kept.durationInFrames, 65)
  })

  test(`opening a gap inside a ${name} clip keeps both sides`, () => {
    const { timeline } = fixture(structuredClone(over) as Partial<Item>)
    const before = plays(timeline, 'v1')
    insertTime(timeline, 140, 30, () => 'tail')
    assertSamePicture(before, plays(timeline, 'v1'), (frame) => (frame < 140 ? frame : frame + 30), 'open 30 at 140')
  })
}

test('rolling a cut into a reversed, ramped clip moves its in-point through the one mapping', () => {
  // L (plain) abuts A (reversed and ramped) at 100. Roll the cut 12 later: A loses its first 12 frames.
  const { project, timeline } = fixture({ reverse: true, sourceStartUs: 6_000_000, keyframes: { speed: DIP } })
  timeline.tracks[0]!.items.unshift(clip('l', 'B', 'v1', 40, 60))
  const before = plays(timeline, 'v1')
  const plan = planTrim(project, timeline, { itemId: 'l', mode: 'roll', deltaFrames: 12, edge: 'end' })
  assert.ok(plan.ok, plan.ok ? '' : plan.error)
  applyTrimPlan(timeline, plan)
  const a = findItem(timeline, 'a')!.item
  assert.equal(a.from, 112)
  assert.equal(a.durationInFrames, 78)
  // Every frame A still plays is the frame it played: frames 112…189, unmoved.
  const after = plays(timeline, 'v1')
  for (let frame = 112; frame < 190; frame += 1) {
    const [, was] = before.get(frame)!.split('@')
    const [nowAsset, now] = after.get(frame)!.split('@')
    assert.equal(nowAsset, 'A')
    assert.ok(Math.abs(Number(now) - Number(was)) <= 2, `frame ${frame}: ${was} → ${now}`)
  }
})

test('slip moves the footage under a reversed clip by its room earlier and later in the file, and refuses past it', () => {
  const { project, timeline } = fixture({ reverse: true, sourceStartUs: 5_000_000 })
  // It reads 2 s…5 s of a 10 s file: 60 frames of room earlier, 150 later.
  const later = planTrim(project, timeline, { itemId: 'a', mode: 'slip', deltaFrames: 150 })
  assert.ok(later.ok, later.ok ? '' : later.error)
  assert.deepEqual(later.range, { min: -60, max: 150 })
  applyTrimPlan(timeline, later)
  assert.deepEqual(sourceSpanOf(findItem(timeline, 'a')!.item, FPS), { startUs: 7_000_000, endUs: 10_000_000 })
  assert.equal(findItem(timeline, 'a')!.item.reverse, true)
  // The refusal, and what it says: one more frame is past the end, and the range is named.
  const fresh = fixture({ reverse: true, sourceStartUs: 5_000_000 })
  const tooFar = planTrim(fresh.project, fresh.timeline, { itemId: 'a', mode: 'slip', deltaFrames: 151 })
  assert.equal(tooFar.ok, false)
  assert.match(tooFar.ok ? '' : tooFar.error, /150/)
})

// ---------------------------------------------------------------------------
// With the other keyable properties and the animation presets
// ---------------------------------------------------------------------------

test('speed is a row of the registry that no general control writes: not in the picker’s list, refused by name', () => {
  assert.ok(KEYFRAME_REGISTRY.speed.planned, 'the row says where speed is written instead')
  assert.match(KEYFRAME_REGISTRY.speed.planned!, /speedRamp/)
  assert.equal(WRITABLE_KEYFRAME_PROPERTIES.includes('speed'), false)
  assert.deepEqual(DRAWN_KEYFRAME_PROPERTIES, WRITABLE_KEYFRAME_PROPERTIES, 'one list, two names')
  // The control: every other row is offered, the new ones included.
  for (const property of ['opacity', 'scale', 'volume', 'cropLeft', 'brightness', 'fontSize'] as const) {
    assert.ok(WRITABLE_KEYFRAME_PROPERTIES.includes(property), property)
    assert.equal(KEYFRAME_REGISTRY[property].planned, undefined, property)
  }
  assert.equal(WRITABLE_KEYFRAME_PROPERTIES.length, KEYFRAME_PROPERTIES.length - 1)
  // And a refusal that lists what is animatable does not offer it.
  const unknown = keyframeInfo(clip('x', 'A', 'v1', 0, 10), 'wobble')
  assert.ok('error' in unknown && !/\bspeed\b/.test(unknown.error) && /cropLeft/.test(unknown.error))
})

for (const [name, over] of [
  ['reversed', { reverse: true, sourceStartUs: 5_000_000 }],
  ['ramped', { keyframes: { speed: DIP } }],
  ['reversed and ramped', { reverse: true, sourceStartUs: 6_000_000, keyframes: { speed: DIP } }]
] as const) {
  test(`crop, adjustment and transform keys on a ${name} clip stay on their frames through a split, a cut-out middle and a lost head`, () => {
    const drawn = { cropLeft: [{ frame: 0, value: 0 }, { frame: 90, value: 0.4 }], brightness: [{ frame: 10, value: 1 }, { frame: 80, value: 2, ease: 'inOut' as const }], scale: [{ frame: 0, value: 1 }, { frame: 90, value: 1.5 }] }
    const make = (): Timeline => {
      const { timeline } = fixture(structuredClone(over) as Partial<Item>)
      const item = findItem(timeline, 'a')!.item
      item.keyframes = { ...(item.keyframes ?? {}), ...structuredClone(drawn) }
      return timeline
    }
    /** What every frame of V1 draws with: crop edge, brightness and scale, sampled as the compositor does. */
    const looks = (timeline: Timeline): Map<number, string> => {
      const out = new Map<number, string>()
      for (const item of timeline.tracks[0]!.items) {
        if (item.assetId !== 'A') continue
        for (let frame = item.from; frame < itemEnd(item); frame += 1) {
          const at = animatedItemAt(item, frame)
          out.set(frame, [at.crop?.left ?? 0, at.adjustments?.brightness ?? 1, at.layout.scale ?? 1].map((v) => v.toFixed(6)).join('/'))
        }
      }
      return out
    }
    const before = looks(make())
    assert.notEqual(before.get(100), before.get(189), 'the specimen animates: its first and last frames differ')

    const split = make()
    split.tracks[0]!.items.push(splitItemAt(findItem(split, 'a')!.item, 140, FPS, 'r')!)
    assert.deepEqual(looks(split), before, 'split at 140')

    const cut = make()
    rippleDelete(cut, 130, 150, () => 'tail')
    const afterCut = looks(cut)
    for (const [frame, look] of before) {
      if (frame >= 130 && frame < 150) continue
      assert.equal(afterCut.get(frame < 130 ? frame : frame - 20), look, `frame ${frame} after removing 130–150`)
    }

    const headless = make()
    rippleDelete(headless, 90, 125, () => 'x')
    const afterHead = looks(headless)
    for (const [frame, look] of before) if (frame >= 125) assert.equal(afterHead.get(frame - 35), look, `frame ${frame} after losing its head`)
    // And the footage under those keys is still the footage it was (the ramp or direction moved with them).
    assertSamePicture(plays(make(), 'v1'), plays(headless, 'v1'), (frame) => (frame < 125 ? null : frame - 35), 'lost head')
  })
}

test('an In and an Out preset stay glued to a ramped clip’s first and last frames when the ramp lengthens it', () => {
  const { project, timeline } = fixture()
  const item = findItem(timeline, 'a')!.item
  item.animation = { in: { kind: 'fade', frames: 12 }, out: { kind: 'fade', frames: 18 } }
  const animation = structuredClone(item.animation)
  assert.equal(item.durationInFrames, 90)

  const plan = planRetime(project, timeline, 'a', { ramp: DIP })!
  applySpeedPlan(timeline, plan)
  const ramped = findItem(timeline, 'a')!.item
  const length = ramped.durationInFrames
  assert.ok(length > 90 + 18, `the ramp must lengthen the clip past its old Out window for this to test anything: ${length}`)

  // The presets themselves are untouched — a retime is not an edit of the animation…
  assert.deepEqual(ramped.animation, animation)
  assert.deepEqual(animationWindows(ramped.animation, length), { inFrames: 12, outFrames: 18, shortened: false })
  // …and their windows are the clip's first 12 and last 18 frames, as the sampler draws them.
  const opacity = (local: number): number => animatedItemAt(ramped, ramped.from + local).layout.opacity
  assert.ok(opacity(0) < 0.2, `the In starts on the first frame (opacity ${opacity(0)})`)
  assert.ok(opacity(11) < 1, 'and is still running on its last')
  assert.equal(opacity(12), 1, 'and is over on the frame after')
  assert.equal(opacity(length - 19), 1, 'the Out has not begun the frame before its window')
  assert.ok(opacity(length - 18) <= 1 && opacity(length - 9) < 1, 'it runs over the last 18 frames')
  assert.ok(opacity(length - 1) < 0.2, `and ends on the clip's new last frame (opacity ${opacity(length - 1)})`)
  // Where the Out used to be — the old last frames, now mid-clip — the clip is at rest.
  for (let local = 72; local < 90; local += 1) assert.equal(opacity(local), 1, `old Out frame ${local} is at rest`)
  assert.ok(isAtRest(animationStateAt(ramped.animation, 80, length)))
  assert.equal(isAtRest(animationStateAt(ramped.animation, length - 1, length)), false)

  // Reversing it as well moves neither: In is still the head, Out the tail.
  applySpeedPlan(timeline, planRetime(project, timeline, 'a', { reverse: true })!)
  const reversed = findItem(timeline, 'a')!.item
  assert.deepEqual(reversed.animation, animation)
  assert.ok(animatedItemAt(reversed, reversed.from).layout.opacity < 0.2)
  assert.ok(animatedItemAt(reversed, itemEnd(reversed) - 1).layout.opacity < 0.2)

  // And a split of the ramped, reversed clip gives the In to the left half and the Out to the right.
  const right = splitItemAt(reversed, reversed.from + 50, FPS, 'r')!
  assert.deepEqual([reversed.animation, right.animation], [{ in: animation.in }, { out: animation.out }])
  assert.ok(speedKeysOf(right) && right.reverse, 'the right half is still ramped and reversed')
})

for (const [name, over] of [
  ['reversed', { reverse: true, sourceStartUs: 5_000_000 }],
  ['ramped', { keyframes: { speed: DIP } }],
  ['reversed and ramped', { reverse: true, sourceStartUs: 6_000_000, keyframes: { speed: DIP } }]
] as const) {
  test(`a split ${name} clip is a through-edit: joining it gives back the clip that was split`, () => {
    const { project, timeline } = fixture(structuredClone(over) as Partial<Item>)
    const original = structuredClone(findItem(timeline, 'a')!.item)
    const before = plays(timeline, 'v1')
    for (const at of [112, 145, 171]) {
      const copy = structuredClone(timeline)
      copy.tracks[0]!.items.push(splitItemAt(findItem(copy, 'a')!.item, at, FPS, 'r')!)
      copy.tracks[0]!.items.sort((x, y) => x.from - y.from)
      const joined = joinPair(copy, project.assets, 'a', 'r')
      assert.ok('joined' in joined, 'joined' in joined ? '' : `split at ${at}: ${joined.reason}`)
      assert.deepEqual(findItem(copy, 'a')!.item, original, `split at ${at}, joined: the clip it was`)
      assert.ok(!findItem(copy, 'r'), 'the second half is gone')
      assertSamePicture(before, plays(copy, 'v1'), (frame) => frame, `joined at ${at}`)
    }

    // The refusal beside it: the same pair with a frame trimmed off the second half is a real cut,
    // and is told which way — in the order the clips play, not the order of the file.
    const cut = structuredClone(timeline)
    const right = splitItemAt(findItem(cut, 'a')!.item, 145, FPS, 'r')!
    right.sourceStartUs = sourceTimeAtBoundary(right, 6)
    cut.tracks[0]!.items.push(right)
    const refused = joinPair(cut, project.assets, 'a', 'r')
    assert.ok('reason' in refused)
    assert.match('reason' in refused ? refused.reason : '', /starts 0\.\d\ds later in the source than the first one ends: footage was removed/)
  })
}

test('a forward half and a reversed half are not one take, and the join says what differs', () => {
  const { project, timeline } = fixture()
  const right = splitItemAt(findItem(timeline, 'a')!.item, 145, FPS, 'r')!
  right.reverse = true
  timeline.tracks[0]!.items.push(right)
  const refused = joinPair(timeline, project.assets, 'a', 'r')
  assert.ok('reason' in refused)
  assert.match('reason' in refused ? refused.reason : '', /differ in reverse/)
  // The twin: without the flag the same pair joins.
  delete right.reverse
  assert.ok('joined' in joinPair(timeline, project.assets, 'a', 'r'))
})

// ---------------------------------------------------------------------------
// Links
// ---------------------------------------------------------------------------

test('a reversed, ramped picture’s detached sound is reversed and ramped with it, and the pair retimes together', () => {
  const { project, timeline } = fixture({ reverse: true, sourceStartUs: 5_000_000, keyframes: { speed: DIP } })
  let n = 0
  const result = detachAudio(project, timeline, ['a'], {
    trackId: 'a1',
    makeId: (prefix) => `${prefix}${(n += 1)}`,
    makeAudioTrack: () => track('a2', 'audio', [])
  })
  assert.equal(result.detached.length, 1, JSON.stringify(result.refused))
  const picture = findItem(timeline, 'a')!.item
  const sound = linkedPartners(timeline, 'a')[0]!
  assert.equal(sound.reverse, true)
  assert.deepEqual(speedKeysOf(sound), DIP)
  assert.ok(sameSourceTiming(sound, picture), 'the sound reads the footage the picture does')
  for (let frame = picture.from; frame < itemEnd(picture); frame += 7) {
    assert.equal(sourceTimeAt(sound, frame, FPS), sourceTimeAt(picture, frame, FPS), `frame ${frame}`)
  }
  // Never through the picture's element: that element is stepped, not played.
  assert.equal(soundAlignedWithPicture(sound, picture), false)

  // Forwards again and off the ramp, through the picture: the sound follows, and now shares the element.
  applySpeedPlan(timeline, planRetime(project, timeline, 'a', { reverse: false, ramp: null })!)
  const after = linkedPartners(timeline, 'a')[0]!
  assert.equal(after.reverse, undefined)
  assert.equal(speedKeysOf(after), undefined)
  assert.equal(after.durationInFrames, findItem(timeline, 'a')!.item.durationInFrames)
  assert.equal(after.sourceStartUs, findItem(timeline, 'a')!.item.sourceStartUs)
  assert.equal(soundAlignedWithPicture(after, findItem(timeline, 'a')!.item), true)
})

test('a linked sound that starts elsewhere gets the curve at the same timeline frames', () => {
  const { project, timeline } = fixture()
  // The sound starts 10 frames before the picture (an early in-point), reading 10 frames earlier.
  const sound = clip('s', 'A', 'a1', 90, 100, { sourceStartUs: 2_000_000 - 333_333, linkId: 'L' })
  timeline.tracks[1]!.items.push(sound)
  findItem(timeline, 'a')!.item.linkId = 'L'
  applySpeedPlan(timeline, planRetime(project, timeline, 'a', { ramp: DIP })!)
  const keys = speedKeysOf(findItem(timeline, 's')!.item)!
  assert.deepEqual(keys.map((key) => key.frame), DIP.map((key) => key.frame + 10))
})

// ---------------------------------------------------------------------------
// Sound
// ---------------------------------------------------------------------------

test('what a retimed clip’s sound does is one answer: ramps are silent everywhere, reverse only in the preview', () => {
  assert.deepEqual(retimeSound(clip('x', 'A', 'v1', 0, 10)), { preview: 'plays', export: 'plays', mutedEverywhere: false, notice: null })
  const reversed = retimeSound(clip('x', 'A', 'v1', 0, 10, { reverse: true }))
  assert.equal(reversed.preview, 'silent')
  assert.equal(reversed.export, 'reversed')
  assert.equal(reversed.mutedEverywhere, false)
  assert.match(reversed.notice!, /silent in the preview/)
  assert.match(reversed.notice!, /backwards in the exported file/)
  const ramped = retimeSound(clip('x', 'A', 'v1', 0, 10, { keyframes: { speed: DIP }, reverse: true }))
  assert.deepEqual([ramped.preview, ramped.export, ramped.mutedEverywhere], ['silent', 'silent', true])
  assert.match(ramped.notice!, /preview and in the export/)

  // The shared gain — what the preview's nodes and export's envelope both read — is 0 under a ramp…
  const { project, timeline } = fixture({ keyframes: { speed: DIP } })
  const item = findItem(timeline, 'a')!.item
  assert.equal(itemAudioGainAt(project, timeline, item, 120), 0)
  assert.equal(volumeMayBeAudible(item), false)
  // …and untouched for the same clip reversed, or left alone.
  for (const over of [{ reverse: true, sourceStartUs: 5_000_000 }, {}]) {
    const other = fixture(over)
    const same = findItem(other.timeline, 'a')!.item
    assert.equal(itemAudioGainAt(other.project, other.timeline, same, 120), 1)
    assert.equal(volumeMayBeAudible(same), true)
  }
})

// ---------------------------------------------------------------------------
// The agent's surface
// ---------------------------------------------------------------------------

test('a speed ramp is read from a preset, a list or null, and each refusal says how to write it', () => {
  const ok = readSpeedRamp([{ frame: 30, speed: 0.25 }, { frame: 0, speed: 1, ease: 'inOut' }], 90, FPS)
  assert.deepEqual(ok, { ok: true, keys: [{ frame: 0, value: 1, ease: 'inOut' }, { frame: 30, value: 0.25 }] })
  assert.deepEqual(readSpeedRamp(null, 90, FPS), { ok: true, keys: null })
  assert.deepEqual(readSpeedRamp([], 90, FPS), { ok: true, keys: null })
  const preset = readSpeedRamp('ramp-down', 90, FPS)
  assert.ok(preset.ok && preset.preset === 'ramp-down' && preset.keys!.length === 3)
  // A key past the clip's present end is legal: the ramp is what changes the end.
  assert.ok(readSpeedRamp([{ frame: 0, speed: 1 }, { frame: 5000, speed: 0.5 }], 90, FPS).ok)

  const refusals: [unknown, RegExp][] = [
    ['slowmo', /no preset "slowmo".*ramp-down, ramp-up, montage, bullet, hold/],
    [{ frame: 0, speed: 1 }, /preset name .* a list of \{ frame, speed, ease\? \}, or null/],
    [[{ frame: 0, speed: 25 }], /speedRamp\[0\]\.speed .*0 to 16.*25% is 0\.25/],
    [[{ frame: 0, speed: -1 }], /speedRamp\[0\]\.speed .*0 a held frame/],
    [[{ frame: 1.5, speed: 1 }], /speedRamp\[0\]\.frame must be a whole number/],
    [[{ frame: -1, speed: 1 }], /speedRamp\[0\]\.frame .*0 or more/],
    [[{ frame: 0, value: 1 }], /speedRamp\[0\]\.speed/],
    [[{ frame: 0, speed: 1, value: 2 }], /no field "value".*\{ frame, speed, ease\? \}/],
    [[{ frame: 3, speed: 1 }, { frame: 3, speed: 2 }], /two keys on frame 3/],
    [[{ frame: 0, speed: 1 }, { frame: 30, speed: 0 }], /ends at speed 0 \(frame 30\).*\{ frame: 60, speed: 1 \}.*ease "hold"/],
    [[{ frame: 0, speed: 1, ease: 'bouncy' }], /speedRamp\[0\]/]
  ]
  for (const [given, pattern] of refusals) {
    const read = readSpeedRamp(given, 90, FPS)
    assert.equal(read.ok, false, JSON.stringify(given))
    assert.match(read.ok ? '' : read.error, pattern, JSON.stringify(given))
  }
  // The twin of "ends at 0": the hold the message describes is accepted.
  assert.ok(readSpeedRamp([{ frame: 0, speed: 1 }, { frame: 30, speed: 0, ease: 'hold' }, { frame: 60, speed: 1 }], 90, FPS).ok)
})

test('speed is not keyed through `keyframes`, and removing every key leaves a ramp to `speedRamp: null`', () => {
  const target = { itemId: 'a', from: 100, durationInFrames: 90, hasPicture: true, hasAudio: true }
  const refused = mergeKeyframes(undefined, { speed: [{ frame: 0, value: 0.5 }] }, target)
  assert.equal(refused.ok, false)
  assert.match(refused.ok ? '' : refused.error, /speedRamp/)
  // The twin: the property beside it is accepted.
  assert.ok(mergeKeyframes(undefined, { scale: [{ frame: 0, value: 0.5 }] }, target).ok)
  // `keyframes: null` removes drawn keys; the ramp, whose removal changes the clip's length, stays.
  const current = { speed: DIP, scale: [{ frame: 0, value: 1 }] }
  const cleared = mergeKeyframes(current, null, target)
  assert.ok(cleared.ok)
  assert.deepEqual(cleared.ok && cleared.keyframes, { speed: DIP })
  assert.deepEqual(cleared.ok && cleared.changed, ['scale'])
  // And an unknown property's refusal does not offer speed as something to key there.
  const unknown = mergeKeyframes(undefined, { zoom: [] }, target)
  assert.ok(!unknown.ok && !/\bspeed\b/.test(unknown.error.split('Animatable properties:')[1]!.split('—')[0]!), unknown.ok ? '' : unknown.error)
})

// ---------------------------------------------------------------------------
// Readers of source time
// ---------------------------------------------------------------------------

test('beats and transcript lines land where a reversed or ramped clip plays them', () => {
  // A reversed clip reading 2 s…5 s from timeline frame 100: source 4 s plays 1 s in, source 2.5 s 2.5 s in.
  const reversed = clip('a', 'A', 'v1', 100, 90, { reverse: true, sourceStartUs: 5_000_000 })
  for (const us of [2_100_000, 3_000_000, 4_000_000, 4_950_000]) {
    const frame = timelineFrameAt(reversed, us, FPS)!
    // The frame it names is one whose stretch of footage holds that moment.
    const shown = sourceTimeAt(reversed, frame, FPS)
    assert.ok(us >= shown - 1 && us < shown + 33_334, `${us} is in frame ${frame}, which shows from ${shown}`)
  }
  assert.equal(timelineFrameAt(reversed, 5_500_000, FPS), null, 'past its late edge it does not play')
  assert.equal(timelineFrameAt(reversed, 1_000_000, FPS), null, 'nor before its early one')
  // The forward twin, unchanged arithmetic.
  assert.equal(timelineFrameAt(clip('a', 'A', 'v1', 100, 90, { sourceStartUs: 2_000_000 }), 3_000_000, FPS), 130)

  const grid = { bpm: 120, confidence: 1, beatsUs: [2_500_000, 3_000_000, 3_500_000, 4_000_000], downbeatsUs: [3_000_000], dropouts: [{ startUs: 2_200_000, endUs: 2_700_000, kind: 'silence' }] } as unknown as BeatGrid
  const beats = beatFramesForItem(grid, reversed, FPS)
  assert.equal(beats.beats.length, 4)
  assert.deepEqual([...beats.beats].sort((a, b) => a - b).reverse(), beats.beats, 'later beats in the file come first on the timeline')
  assert.equal(beats.dropouts.length, 1)
  assert.ok(beats.dropouts[0]!.startFrame < beats.dropouts[0]!.endFrame)

  // Two lines, the second later in the file: reversed, it is the first on the timeline.
  const lines = [
    { startSeconds: 2.5, endSeconds: 3, text: 'first in the file' },
    { startSeconds: 4, endSeconds: 4.5, text: 'second in the file' }
  ]
  const cues = segmentsToCues(lines, reversed, FPS)
  assert.deepEqual(cues.map((cue) => cue.text), ['second in the file', 'first in the file'])
  assert.deepEqual([cues[0]!.fromFrame, cues[0]!.toFrame], [115, 130])
  assert.deepEqual([cues[1]!.fromFrame, cues[1]!.toFrame], [160, 175])
  // Forwards, as before: 2.5 s is 0.5 s in.
  assert.deepEqual(segmentsToCues(lines, clip('a', 'A', 'v1', 100, 90, { sourceStartUs: 2_000_000 }), FPS).map((c) => [c.fromFrame, c.toFrame]), [[115, 130], [160, 175]])

  // Under a ramp a line in the slow stretch is longer on the timeline than in the file.
  const ramped = clip('a', 'A', 'v1', 100, 200, { sourceStartUs: 2_000_000, keyframes: { speed: [{ frame: 0, value: 0.25 }] } })
  const slow = segmentsToCues([{ startSeconds: 2.5, endSeconds: 3, text: 'slow' }], ramped, FPS)
  assert.deepEqual([slow[0]!.fromFrame, slow[0]!.toFrame], [160, 220])
  assert.equal(plainTime(ramped), false)
})
