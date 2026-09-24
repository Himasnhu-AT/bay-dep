/**
 * The keyframe sampler and the edit rules, as pure functions.
 *
 * Every ease is checked against a reference computed a different way (dense parametric sampling
 * of the bezier, not Newton on x), and the split rule is checked by its requirement — each half
 * draws exactly what the whole did — over random curves rather than one hand-picked case.
 * The same rules driven through the real tools are in `renderer/src/mcp/keyframes.test.ts`; the
 * volume ride rendered through ffmpeg is in `main/export/audio-render.test.ts`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Item, ItemKeyframes, Keyframe, KeyframeEase, Project, Timeline } from './project'
import { retimeTimeline } from './project'
import {
  animatedItemAt,
  animatedLayoutAt,
  animatedVolumeAt,
  describeKeyframes,
  easeProgress,
  keyframeValueAt,
  mergeKeyframes,
  repairKeyframes,
  shiftKeyframes,
  sliceKeyframes,
  volumeMayBeAudible,
  withKeyframe,
  type KeyframeTarget
} from './keyframes'
import { itemAudioGainAt } from './audio-gain'

function item(over: Partial<Item> = {}): Item {
  return {
    id: 'itm',
    assetId: 'ast',
    trackId: 'trk',
    from: 100,
    durationInFrames: 150,
    sourceStartUs: 0,
    layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
    volume: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    speed: 1,
    ...over
  }
}

/** y at x for a CSS cubic-bezier, by sampling its parameter densely — not the code's method. */
function referenceBezier(x1: number, y1: number, x2: number, y2: number, x: number): number {
  const at = (p0: number, p1: number, t: number): number =>
    3 * (1 - t) * (1 - t) * t * p0 + 3 * (1 - t) * t * t * p1 + t * t * t
  let best = 0
  let bestError = Infinity
  const steps = 200_000
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps
    const error = Math.abs(at(x1, x2, t) - x)
    if (error < bestError) {
      bestError = error
      best = t
    }
  }
  return at(y1, y2, best)
}

/** The value by a linear scan over segments — not the code's binary search. */
function referenceValue(keys: Keyframe[], frame: number): number {
  if (frame <= keys[0]!.frame) return keys[0]!.value
  if (frame >= keys[keys.length - 1]!.frame) return keys[keys.length - 1]!.value
  for (let i = 0; i < keys.length - 1; i += 1) {
    const a = keys[i]!
    const b = keys[i + 1]!
    if (frame >= a.frame && frame < b.frame) {
      return a.value + (b.value - a.value) * easeProgress(a.ease, (frame - a.frame) / (b.frame - a.frame))
    }
  }
  throw new Error('unreachable')
}

// ---------------------------------------------------------------------------
// Sampling
// ---------------------------------------------------------------------------

test('linear keys interpolate, and the ends hold before the first and after the last', () => {
  const keys: Keyframe[] = [{ frame: 0, value: 0 }, { frame: 10, value: 100 }]
  assert.equal(keyframeValueAt(keys, 5), 50)
  assert.equal(keyframeValueAt(keys, 2.5), 25)
  assert.equal(keyframeValueAt(keys, 0), 0)
  assert.equal(keyframeValueAt(keys, 10), 100)
  assert.equal(keyframeValueAt(keys, -40), 0, 'before the first key, the first value')
  assert.equal(keyframeValueAt(keys, 400), 100, 'after the last key, the last value')
})

test('a single key holds its value everywhere; no keys is no answer', () => {
  const keys: Keyframe[] = [{ frame: 30, value: 0.4 }]
  for (const frame of [-10, 0, 30, 31, 1000]) assert.equal(keyframeValueAt(keys, frame), 0.4)
  assert.equal(keyframeValueAt([], 5), undefined)
  assert.equal(keyframeValueAt(undefined, 5), undefined)
})

test('hold keeps the value until the next key, then jumps', () => {
  const keys: Keyframe[] = [{ frame: 0, value: 1, ease: 'hold' }, { frame: 10, value: 5 }, { frame: 20, value: 9 }]
  assert.equal(keyframeValueAt(keys, 0), 1)
  assert.equal(keyframeValueAt(keys, 9.99), 1)
  assert.equal(keyframeValueAt(keys, 10), 5)
  assert.equal(keyframeValueAt(keys, 15), 7, 'the next segment is linear: the ease belongs to the key that starts it')
})

test('every named ease and a bezier tuple match the CSS curve they name', () => {
  const cases: Array<[KeyframeEase, [number, number, number, number]]> = [
    ['in', [0.42, 0, 1, 1]],
    ['out', [0, 0, 0.58, 1]],
    ['inOut', [0.42, 0, 0.58, 1]],
    [[0.25, 0.1, 0.25, 1], [0.25, 0.1, 0.25, 1]],
    // Overshoot: y may leave 0..1, which is how a key springs past its value.
    [[0.34, 1.56, 0.64, 1], [0.34, 1.56, 0.64, 1]]
  ]
  for (const [ease, curve] of cases) {
    for (const t of [0.05, 0.1, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 0.97]) {
      const want = referenceBezier(...curve, t)
      const got = easeProgress(ease, t)
      assert.ok(Math.abs(got - want) < 2e-4, `${JSON.stringify(ease)} at ${t}: ${got} vs reference ${want}`)
    }
  }
  // The shapes the names promise, stated independently of any curve constant.
  assert.ok(easeProgress('in', 0.5) < 0.4, 'ease-in starts slow')
  assert.ok(easeProgress('out', 0.5) > 0.6, 'ease-out starts fast')
  assert.ok(Math.abs(easeProgress('inOut', 0.5) - 0.5) < 1e-6, 'ease-in-out is symmetric')
  assert.equal(easeProgress('linear', 0.3), 0.3)
  assert.equal(easeProgress(undefined, 0.3), 0.3)
  // And an eased segment really is eased in the sampled value.
  const keys: Keyframe[] = [{ frame: 0, value: 0, ease: 'in' }, { frame: 100, value: 1 }]
  assert.ok(Math.abs(keyframeValueAt(keys, 50)! - referenceBezier(0.42, 0, 1, 1, 0.5)) < 2e-4)
})

test('many keys: the segment search agrees with a linear scan everywhere', () => {
  let seed = 7
  const random = (): number => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31
    return seed / 2 ** 31
  }
  const eases: Array<KeyframeEase | undefined> = [undefined, 'hold', 'in', 'out', 'inOut', [0.2, 0.8, 0.3, 1]]
  for (let trial = 0; trial < 50; trial += 1) {
    const frames = new Set<number>()
    while (frames.size < 2 + Math.floor(random() * 12)) frames.add(Math.floor(random() * 300))
    const keys = [...frames].sort((a, b) => a - b).map((frame) => ({
      frame,
      value: random() * 10 - 5,
      ease: eases[Math.floor(random() * eases.length)]
    }))
    for (let frame = -5; frame < 305; frame += 0.5) {
      assert.equal(keyframeValueAt(keys, frame), referenceValue(keys, frame), `trial ${trial} frame ${frame}`)
    }
  }
})

// ---------------------------------------------------------------------------
// The sampler's consumers
// ---------------------------------------------------------------------------

test('an item with no keys is drawn as the same object: the static path costs nothing', () => {
  const plain = item()
  assert.equal(animatedItemAt(plain, 120), plain)
  assert.equal(animatedLayoutAt(plain, 120), plain.layout)
  // Volume keys alone change no picture, so the picture is still the stored one.
  const voiced = item({ keyframes: { volume: [{ frame: 0, value: 0 }, { frame: 10, value: 1 }] } })
  assert.equal(animatedItemAt(voiced, 105), voiced)
})

test('keyed layout properties are sampled at item-relative frames; the rest are kept', () => {
  const pushed = item({
    layout: { left: 10, top: 20, width: 1920, height: 1080, opacity: 0.8, rotation: 5 },
    keyframes: { scale: [{ frame: 0, value: 1 }, { frame: 150, value: 1.04 }], opacity: [{ frame: 0, value: 0 }, { frame: 30, value: 1 }] }
  })
  const at = animatedItemAt(pushed, 175) // item-relative 75
  assert.notEqual(at, pushed)
  assert.ok(Math.abs(at.layout.scale! - 1.02) < 1e-12)
  assert.equal(at.layout.opacity, 1)
  assert.deepEqual([at.layout.left, at.layout.top, at.layout.rotation], [10, 20, 5])
  assert.equal(animatedItemAt(pushed, 115).layout.opacity, 0.5)
  assert.equal(pushed.layout.scale, undefined, 'the stored item is not touched')
  assert.equal(pushed.layout.opacity, 0.8)
  // A key whose value is not finite is skipped rather than removing the clip.
  const broken = item({ keyframes: { width: [{ frame: 0, value: Number.NaN }] } })
  assert.equal(animatedLayoutAt(broken, 100).width, 1920)
})

test('volume keys replace the static volume, and the shared gain multiplies fades on top', () => {
  const timeline: Timeline = {
    id: 'tl', name: 'T', fps: 30, width: 1920, height: 1080, background: '#000',
    tracks: [{ id: 'trk', kind: 'audio', name: 'A1', locked: false, muted: false, hidden: false, items: [] }]
  }
  const project: Project = {
    id: 'p', name: 'p', version: 1, assets: [], timelines: [timeline], activeTimelineId: 'tl', createdAt: 0, updatedAt: 0
  }
  const ride = item({
    volume: 0,
    fadeInFrames: 20,
    keyframes: { volume: [{ frame: 0, value: 1 }, { frame: 40, value: 0.25 }] }
  })
  timeline.tracks[0]!.items = [ride]
  assert.equal(animatedVolumeAt(ride, 120), 0.625)
  assert.ok(volumeMayBeAudible(ride), 'static volume 0 but keyed up: audible')
  // frame 110: volume key 1 - 0.75 * 10/40 = 0.8125, fade-in 10/20 = 0.5.
  assert.ok(Math.abs(itemAudioGainAt(project, timeline, ride, 110) - 0.8125 * 0.5) < 1e-12)
  assert.ok(Math.abs(itemAudioGainAt(project, timeline, ride, 200) - 0.25) < 1e-12)
  assert.ok(!volumeMayBeAudible(item({ volume: 1, keyframes: { volume: [{ frame: 0, value: 0 }] } })))
  assert.ok(!volumeMayBeAudible(item({ volume: 0 })) && volumeMayBeAudible(item({ volume: 0.5 })))
})

// ---------------------------------------------------------------------------
// Edits
// ---------------------------------------------------------------------------

test('a split draws exactly what the whole did, on both halves, for any curve and cut', () => {
  let seed = 11
  const random = (): number => {
    seed = (seed * 1103515245 + 12345) % 2 ** 31
    return seed / 2 ** 31
  }
  const eases: Array<KeyframeEase | undefined> = [undefined, 'hold', 'in', 'out', 'inOut', [0.1, 0.9, 0.2, 1]]
  const duration = 120
  for (let trial = 0; trial < 60; trial += 1) {
    const frames = new Set<number>()
    while (frames.size < 1 + Math.floor(random() * 8)) frames.add(Math.floor(random() * (duration + 1)))
    const keys = [...frames].sort((a, b) => a - b).map((frame) => ({
      frame,
      value: random(),
      ease: eases[Math.floor(random() * eases.length)]
    }))
    const whole: ItemKeyframes = { opacity: keys }
    for (const cut of [1, 17, 60, 61, 119, Math.floor(random() * 118) + 1]) {
      const left = sliceKeyframes(whole, 0, cut)!
      const right = sliceKeyframes(whole, cut, duration)!
      for (let f = 0; f < cut; f += 1) {
        assert.equal(keyframeValueAt(left.opacity, f), keyframeValueAt(keys, f), `trial ${trial} cut ${cut} left ${f}`)
      }
      for (let f = cut; f < duration; f += 1) {
        assert.equal(keyframeValueAt(right.opacity, f - cut), keyframeValueAt(keys, f), `trial ${trial} cut ${cut} right ${f}`)
      }
      // And it does divide: neither half carries keys it has no use for.
      assert.ok(left.opacity!.filter((k) => k.frame > cut).length <= 1)
      assert.ok(right.opacity!.filter((k) => k.frame < 0).length <= 1)
    }
  }
})

test('shifting moves every key and leaves the input alone', () => {
  const keys: ItemKeyframes = { scale: [{ frame: 0, value: 1 }, { frame: 30, value: 2, ease: 'out' }], volume: [{ frame: 5, value: 1 }] }
  const moved = shiftKeyframes(keys, -10)!
  assert.deepEqual(moved.scale, [{ frame: -10, value: 1 }, { frame: 20, value: 2, ease: 'out' }])
  assert.deepEqual(moved.volume, [{ frame: -5, value: 1 }])
  assert.equal(keys.scale![0]!.frame, 0)
  assert.equal(shiftKeyframes(undefined, 5), undefined)
})

test('a timeline fps change keeps keys at the same wall-clock moment in the clip', () => {
  const timeline: Timeline = {
    id: 'tl', name: 'T', fps: 30, width: 1920, height: 1080, background: '#000',
    tracks: [{
      id: 'trk', kind: 'video', name: 'V1', locked: false, muted: false, hidden: false,
      items: [item({ from: 30, durationInFrames: 90, keyframes: { scale: [{ frame: 0, value: 1 }, { frame: 45, value: 1.2 }, { frame: 90, value: 1 }] } })]
    }]
  }
  retimeTimeline(timeline, 60)
  const moved = timeline.tracks[0]!.items[0]!
  assert.deepEqual(moved.keyframes!.scale!.map((k) => k.frame), [0, 90, 180])
})

test('the load-time repair sorts and dedupes, keeps a newer build\'s property, and is a no-op on good data', () => {
  const good: ItemKeyframes = { opacity: [{ frame: 0, value: 0 }, { frame: 10, value: 1, ease: 'inOut' }] }
  assert.deepEqual(repairKeyframes(structuredClone(good)), good)
  const messy = {
    opacity: [{ frame: 10, value: 1 }, { frame: 0, value: 0 }, { frame: 10, value: 0.5 }, { frame: 4, value: null }],
    blur: [{ frame: 0, value: 3 }],
    width: []
  }
  assert.deepEqual(repairKeyframes(messy), {
    opacity: [{ frame: 0, value: 0 }, { frame: 10, value: 0.5 }],
    blur: [{ frame: 0, value: 3 }]
  })
  assert.equal(repairKeyframes('nonsense'), undefined)
})

// ---------------------------------------------------------------------------
// Writing keys: every refusal paired with the nearest call that must succeed
// ---------------------------------------------------------------------------

const TARGET: KeyframeTarget = { itemId: 'itm_a', from: 300, durationInFrames: 150, hasPicture: true, hasAudio: true }

function refused(given: unknown, target: KeyframeTarget = TARGET): string {
  const merged = mergeKeyframes(undefined, given, target)
  assert.equal(merged.ok, false, `expected a refusal for ${JSON.stringify(given)}`)
  return (merged as { error: string }).error
}

function accepted(given: unknown, target: KeyframeTarget = TARGET, current?: ItemKeyframes): ItemKeyframes | undefined {
  const merged = mergeKeyframes(current, given, target)
  assert.ok(merged.ok, `expected acceptance for ${JSON.stringify(given)}: ${(merged as { error?: string }).error}`)
  return merged.keyframes
}

test('an unknown property is refused with the list of real ones', () => {
  const error = refused({ zoom: [{ frame: 0, value: 1 }] })
  assert.match(error, /no property "zoom"/)
  assert.match(error, /opacity, left, top, width, height, rotation, scale, volume/)
  assert.match(error, /a zoom is scale/)
  accepted({ scale: [{ frame: 0, value: 1 }] })
})

test('a key outside the clip names the item-relative and timeline range and the fix', () => {
  const error = refused({ scale: [{ frame: 0, value: 1 }, { frame: 450, value: 1.04 }] })
  assert.match(error, /keyframes\.scale\[1\]\.frame is 450/)
  assert.match(error, /0\.\.150/)
  assert.match(error, /timeline frame 300/)
  assert.match(error, /T - 300/)
  assert.match(error, /use 150/)
  assert.match(refused({ scale: [{ frame: -1, value: 1 }] }), /Use 0/)
  assert.match(refused({ scale: [{ frame: 2.5, value: 1 }] }), /whole number/)
  accepted({ scale: [{ frame: 0, value: 1 }, { frame: 150, value: 1.04 }] })
})

test('a value outside its property\'s range names the range and the unit', () => {
  const error = refused({ opacity: [{ frame: 0, value: 50 }] })
  assert.match(error, /keyframes\.opacity\[0\]\.value is 50/)
  assert.match(error, /0\.\.1/)
  assert.match(error, /50% is 0\.5/)
  assert.match(refused({ volume: [{ frame: 0, value: 3 }] }), /0\.\.2/)
  assert.match(refused({ width: [{ frame: 0, value: 0 }] }), /at least 1/)
  assert.match(refused({ scale: [{ frame: 0, value: 'big' }] }), /must be a number/)
  accepted({ opacity: [{ frame: 0, value: 0.5 }], volume: [{ frame: 0, value: 2 }], width: [{ frame: 0, value: 1 }] })
})

test('volume keys take dB, converted to gain; dB is refused elsewhere and above +6 dB', () => {
  const keys = accepted({ volume: [{ frame: 0, db: 0 }, { frame: 30, db: -12 }] })!
  assert.equal(keys.volume![0]!.value, 1)
  assert.ok(Math.abs(keys.volume![1]!.value - 0.251189) < 1e-6)
  assert.match(refused({ opacity: [{ frame: 0, db: -3 }] }), /db only applies to volume/)
  assert.match(refused({ volume: [{ frame: 0, db: 12 }] }), /\+6\.02/)
  assert.match(refused({ volume: [{ frame: 0, db: -6, value: 0.5 }] }), /both value and db/)
})

test('two keys on one frame are refused, and unsorted keys are sorted', () => {
  assert.match(refused({ left: [{ frame: 10, value: 0 }, { frame: 10, value: 5 }] }), /two keys on frame 10 \(timeline frame 310\)/)
  // The inspector shows the same refusal in its own words: the property as the panel names it.
  const clash = mergeKeyframes(undefined, { left: [{ frame: 10, value: 0 }, { frame: 10, value: 5 }] }, TARGET)
  assert.equal(clash.ok, false)
  if (clash.ok) return
  assert.match(clash.userMessage ?? '', /X position already has a key on that frame/)
  assert.doesNotMatch(clash.userMessage ?? '', /keyframes\.|itm_/)
  const keys = accepted({ left: [{ frame: 20, value: 2 }, { frame: 10, value: 1 }] })!
  assert.deepEqual(keys.left!.map((k) => k.frame), [10, 20])
})

test('an ease that is not one names the options', () => {
  const error = refused({ top: [{ frame: 0, value: 0, ease: 'easeInOut' }] })
  assert.match(error, /"linear", "hold", "in", "out", "inOut"/)
  assert.match(error, /cubic-bezier/)
  assert.match(refused({ top: [{ frame: 0, value: 0, ease: [1.5, 0, 0.5, 1] }] }), /x1 and x2 must be within 0\.\.1/)
  const keys = accepted({ top: [{ frame: 0, value: 0, ease: 'inOut' }, { frame: 5, value: 1, ease: [0.3, -0.5, 0.6, 1.4] }, { frame: 9, value: 2, ease: 'linear' }] })!
  assert.deepEqual(keys.top!.map((k) => k.ease), ['inOut', [0.3, -0.5, 0.6, 1.4], undefined])
})

test('a property the clip cannot show is refused: volume on a silent clip, layout on a sound', () => {
  const silent = { ...TARGET, hasAudio: false }
  assert.match(refused({ volume: [{ frame: 0, value: 1 }] }, silent), /has no sound/)
  accepted({ opacity: [{ frame: 0, value: 1 }] }, silent)
  const sound = { ...TARGET, hasPicture: false }
  assert.match(refused({ scale: [{ frame: 0, value: 1 }] }, sound), /no picture to move\. Only volume/)
  accepted({ volume: [{ frame: 0, value: 1 }] }, sound)
})

test('a named property is replaced whole, others are kept, and null removes', () => {
  const current: ItemKeyframes = {
    scale: [{ frame: 0, value: 1 }, { frame: 10, value: 2 }],
    opacity: [{ frame: 0, value: 0 }]
  }
  const replaced = accepted({ scale: [{ frame: 5, value: 3 }] }, TARGET, current)!
  assert.deepEqual(replaced.scale, [{ frame: 5, value: 3 }])
  assert.deepEqual(replaced.opacity, current.opacity)
  assert.deepEqual(accepted({ scale: null }, TARGET, current), { opacity: current.opacity })
  assert.deepEqual(accepted({ scale: [] }, TARGET, current), { opacity: current.opacity })
  assert.equal(accepted({ opacity: null }, TARGET, { opacity: current.opacity }), undefined, 'the last property gone is no keys at all')
  assert.equal(accepted(null, TARGET, current), undefined)
  assert.equal(current.scale!.length, 2, 'the current keys are not edited in place')
})

test('the inspector\'s one-key edit adds, replaces in place, and removes down to nothing', () => {
  const one = withKeyframe(undefined, 'opacity', 10, 0.5)
  assert.deepEqual(one, { opacity: [{ frame: 10, value: 0.5 }] })
  const two = withKeyframe(one, 'opacity', 0, 1)
  assert.deepEqual(two!.opacity!.map((k) => k.frame), [0, 10], 'kept in frame order')
  const eased: ItemKeyframes = { opacity: [{ frame: 0, value: 1, ease: 'out' }, { frame: 10, value: 0.5 }] }
  assert.deepEqual(withKeyframe(eased, 'opacity', 0, 0.2)!.opacity![0], { frame: 0, value: 0.2, ease: 'out' }, 'editing a key keeps its ease')
  assert.equal(eased.opacity![0]!.value, 1, 'and does not edit the input')
  assert.deepEqual(withKeyframe(two, 'opacity', 10, null), { opacity: [{ frame: 0, value: 1 }] })
  assert.equal(withKeyframe(one, 'opacity', 10, null), undefined, 'the last key gone is no keys')
  assert.deepEqual(withKeyframe(one, 'opacity', 99, null), one, 'removing a key that is not there changes nothing')
})

test('the description speaks in timeline frames', () => {
  const described = describeKeyframes(item({ from: 300, keyframes: { scale: [{ frame: 0, value: 1 }, { frame: 150, value: 1.04 }] } }))
  assert.deepEqual(described, { scale: { keys: 2, timelineFrames: [300, 450], values: [1, 1.04] } })
  assert.equal(describeKeyframes(item()), undefined)
})
