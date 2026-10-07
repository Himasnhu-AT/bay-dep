/**
 * Healing a through-edit. The requirement is "a join is a split run backwards", so most of this
 * file splits a clip with the real `splitItemAt` and asks for the clip back; the refusals are each
 * that same pair with one thing changed, beside the unchanged pair that still joins.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { joinItems, joinPair, noCutReason, refusalText, CONTIGUOUS_TOLERANCE_US } from './heal'
import { splitItemAt } from './split'
import { animatedItemAt } from './keyframes'
import type { Asset, Item, Timeline, Track } from './project'

const VIDEO: Asset = {
  id: 'ast_take', kind: 'video', name: 'take.mp4', path: '/f/take.mp4', durationUs: 60_000_000,
  width: 1920, height: 1080, fps: 30, hasAudio: true, hasVideo: true, posterPath: null, waveformPath: null, createdAt: 1
} as Asset
const OTHER: Asset = { ...VIDEO, id: 'ast_other', name: 'other.mp4' }
const STILL: Asset = { ...VIDEO, id: 'ast_still', kind: 'image', name: 'card.png', hasAudio: false }
const ASSETS = [VIDEO, OTHER, STILL]

function clip(id: string, from: number, durationInFrames: number, extra: Partial<Item> = {}): Item {
  return {
    id, assetId: VIDEO.id, trackId: 'v1', from, durationInFrames, sourceStartUs: 2_000_000,
    layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
    volume: 1, fadeInFrames: 0, fadeOutFrames: 0, speed: 1, ...extra
  }
}
const track = (id: string, kind: Track['kind'], items: Item[], extra: Partial<Track> = {}): Track => ({
  id, kind, name: id.toUpperCase(), locked: false, muted: false, hidden: false,
  items: items.map((item) => ({ ...item, trackId: id })), ...extra
})
const timelineOf = (tracks: Track[], extra: Partial<Timeline> = {}): Timeline => ({
  id: 'tl', name: 'T', fps: 30, width: 1920, height: 1080, background: '#000000', tracks, ...extra
})

/** A whole clip cut at `at` by the real split: the timeline with both halves, and the whole as it was. */
function cut(whole: Item, at: number, extra: Partial<Timeline> = {}): { timeline: Timeline; whole: Item; left: Item; right: Item } {
  const original = structuredClone(whole)
  const left = structuredClone(whole)
  const transitions = extra.transitions
  const right = splitItemAt(left, at, 30, 'right', transitions)
  assert.ok(right, 'the specimen must really be cut')
  return { timeline: timelineOf([track('v1', 'video', [left, right])], extra), whole: { ...original, trackId: 'v1' }, left, right }
}
const itemsOf = (timeline: Timeline, trackId = 'v1'): Item[] => timeline.tracks.find((t) => t.id === trackId)!.items

test('joining the two halves of a split gives back the clip that was split, exactly', () => {
  for (const whole of [
    clip('a', 10, 90),
    clip('a', 10, 90, { speed: 2, volume: 0.4, fadeInFrames: 6, fadeOutFrames: 12 }),
    clip('a', 0, 47, { speed: 0.5, sourceStartUs: 7_333_333 }),
    clip('a', 10, 90, { crop: { left: 0.1, top: 0, right: 0, bottom: 0.2 }, pan: -0.5 } as Partial<Item>)
  ]) {
    const { timeline, whole: was } = cut(whole, whole.from + 31)
    const result = joinPair(timeline, ASSETS, 'a', 'right')
    assert.ok('joined' in result, JSON.stringify(result))
    assert.deepEqual(itemsOf(timeline), [was])
    assert.deepEqual(result.joined, [{ itemId: 'a', removedId: 'right', trackId: 'v1', from: was.from, durationInFrames: was.durationInFrames }])
  }
})

test('the clips may be named in either order', () => {
  const { timeline, whole } = cut(clip('a', 10, 90), 40)
  assert.ok('joined' in joinPair(timeline, ASSETS, 'right', 'a'))
  assert.deepEqual(itemsOf(timeline), [whole])
})

test('a fade-out longer than the second half is the whole clip’s again after the join', () => {
  // The split cuts the second half's copy of the fade down to its 5 frames; the first half's
  // copy is the one that still says 12.
  const { timeline, whole, right } = cut(clip('a', 0, 60, { fadeOutFrames: 12 }), 55)
  assert.equal(right.fadeOutFrames, 5, 'the specimen must be the cut-down case')
  assert.ok('joined' in joinPair(timeline, ASSETS, 'a', 'right'))
  assert.deepEqual(itemsOf(timeline), [whole])
})

test('keyframes cut in two by a split are one animation again, drawing as the whole did', () => {
  const keyframes = { left: [{ frame: 0, value: 0 }, { frame: 30, value: 300, ease: 'ease-in' as const }, { frame: 80, value: 0 }], opacity: [{ frame: 10, value: 1 }, { frame: 70, value: 0.2 }] }
  const { timeline, whole } = cut(clip('a', 0, 90, { keyframes } as Partial<Item>), 45)
  assert.ok('joined' in joinPair(timeline, ASSETS, 'a', 'right'))
  const joined = itemsOf(timeline)[0]!
  for (let frame = 0; frame < 90; frame += 1) {
    assert.deepEqual(animatedItemAt(joined, frame).layout, animatedItemAt(whole, frame).layout, `frame ${frame}`)
  }
  assert.deepEqual(joined.keyframes, whole.keyframes)
})

test('keyframes that are not one animation cut in two are refused; the clips are untouched', () => {
  const { timeline, right } = cut(clip('a', 0, 90, { keyframes: { left: [{ frame: 0, value: 0 }, { frame: 80, value: 300 }] } } as Partial<Item>), 45)
  // The second half re-animated on its own after the cut.
  itemsOf(timeline)[1]!.keyframes = { left: [{ frame: 0, value: 900 }, { frame: 40, value: 0 }] }
  const before = structuredClone(timeline)
  const result = joinPair(timeline, ASSETS, 'a', right.id)
  assert.ok('reason' in result)
  assert.match(result.reason, /keyframes are not one animation/)
  assert.deepEqual(timeline, before)
})

test('keyframes cleared on the second half only: joined, it would start moving — refused', () => {
  // The first half still holds its share of the animation, so a check of it alone passes.
  const { timeline } = cut(clip('a', 0, 90, { keyframes: { left: [{ frame: 0, value: 0 }, { frame: 80, value: 300 }] } } as Partial<Item>), 45)
  delete itemsOf(timeline)[1]!.keyframes
  const before = structuredClone(timeline)
  const result = joinPair(timeline, ASSETS, 'a', 'right')
  assert.ok('reason' in result)
  assert.match(result.reason, /keyframes are not one animation/)
  assert.deepEqual(timeline, before)
  // And the mirror: cleared on the first half only.
  const mirror = cut(clip('a', 0, 90, { keyframes: { left: [{ frame: 0, value: 0 }, { frame: 80, value: 300 }] } } as Partial<Item>), 45)
  delete itemsOf(mirror.timeline)[0]!.keyframes
  assert.ok('reason' in joinPair(mirror.timeline, ASSETS, 'a', 'right'))
})

// -- each way a cut is a real cut, beside the through-edit it differs from by one thing -------

const refusals: [string, (t: Timeline) => void, RegExp, RegExp | null][] = [
  ['a frame trimmed off the second clip’s head', (t) => { itemsOf(t)[1]!.sourceStartUs += 33_333 }, /starts 0\.03s later in the source .* footage was removed at this cut/, null],
  ['footage that repeats', (t) => { itemsOf(t)[1]!.sourceStartUs -= 1_000_000 }, /starts 1\.00s earlier in the source .* footage repeats/, null],
  ['a gap', (t) => { itemsOf(t)[1]!.from += 3 }, /gap of 3 frames/, null],
  ['different media', (t) => { itemsOf(t)[1]!.assetId = OTHER.id }, /different media/, null],
  ['a different level', (t) => { itemsOf(t)[1]!.volume = 0.5 }, /^They differ in volume, so joined they would not look or sound as they do now\.$/, /edit_item/],
  ['a grade on one half', (t) => { (itemsOf(t)[0] as unknown as { grade: unknown }).grade = { exposure: 0.3 } }, /They differ in grade/, /inspect_item/],
  ['a different speed', (t) => { itemsOf(t)[1]!.speed = 2 }, /They differ in speed/, null],
  ['a different layout', (t) => { itemsOf(t)[1]!.layout.left = 40 }, /They differ in layout/, null],
  ['one half disabled', (t) => { itemsOf(t)[1]!.disabled = true }, /They differ in disabled/, null],
  ['a fade in at the cut', (t) => { itemsOf(t)[1]!.fadeInFrames = 8 }, /second clip fades in over 8 frames at the cut/, /edit_item right with fadeInFrames: 0/],
  ['a fade out at the cut', (t) => { itemsOf(t)[0]!.fadeOutFrames = 8 }, /first clip fades out over 8 frames at the cut/, /edit_item a with fadeOutFrames: 0/],
  ['a locked track', (t) => { t.tracks[0]!.locked = true }, /V1 is locked/, null],
  ['a transition on the cut', (t) => { t.transitions = [{ id: 'tr_1', kind: 'cross-dissolve', fromItemId: 'a', toItemId: 'right', durationInFrames: 10 }] }, /cross-dissolve transition on this cut/, /remove_transition tr_1/]
]

for (const [what, change, reason, hint] of refusals) {
  test(`a cut with ${what} is a real cut: refused with why, nothing changed`, () => {
    const { timeline } = cut(clip('a', 10, 90), 40)
    // The pair: the same clips, unchanged, do join — so the refusal below is about the change.
    assert.ok('joined' in joinPair(structuredClone(timeline), ASSETS, 'a', 'right'))
    change(timeline)
    const before = structuredClone(timeline)
    const result = joinPair(timeline, ASSETS, 'a', 'right')
    assert.ok('reason' in result, `expected a refusal for ${what}`)
    assert.match(result.reason, reason)
    // A person reads `reason`: no ids and no tool names in it.
    assert.doesNotMatch(result.reason, /edit_item|inspect_item|remove_transition|\bright\b|linked: false/)
    if (hint) assert.match(refusalText(result), hint)
    assert.deepEqual(timeline, before, 'a refusal must change nothing')
  })
}

test('a setting written in a different order on each half is still the same setting', () => {
  const { timeline, whole } = cut(clip('a', 10, 90), 40)
  const [left, right] = itemsOf(timeline) as [Item, Item]
  // The same layout and crop, as two edits made in a different order would leave them.
  const { left: x, top: y, ...rest } = right.layout
  right.layout = { ...rest, top: y, left: x }
  left.crop = { left: 0.1, top: 0.2, right: 0, bottom: 0 }
  right.crop = { bottom: 0, right: 0, top: 0.2, left: 0.1 }
  assert.notEqual(JSON.stringify(left.layout), JSON.stringify(right.layout), 'the specimen must defeat a comparison of the text')
  assert.notEqual(JSON.stringify(left.crop), JSON.stringify(right.crop))
  assert.ok('joined' in joinPair(timeline, ASSETS, 'a', 'right'))
  assert.deepEqual(itemsOf(timeline), [{ ...whole, crop: left.crop }])
  // The pair: one value really different in there is still a difference.
  const other = cut(clip('a', 10, 90), 40)
  itemsOf(other.timeline)[0]!.crop = { left: 0.1, top: 0.2, right: 0, bottom: 0 }
  itemsOf(other.timeline)[1]!.crop = { bottom: 0, right: 0, top: 0.25, left: 0.1 }
  assert.ok('reason' in joinPair(other.timeline, ASSETS, 'a', 'right'))
})

test('source positions a rounding apart still join; a millisecond and more apart do not', () => {
  const near = cut(clip('a', 10, 90), 40)
  itemsOf(near.timeline)[1]!.sourceStartUs += 2
  assert.ok('joined' in joinPair(near.timeline, ASSETS, 'a', 'right'))
  const far = cut(clip('a', 10, 90), 40)
  itemsOf(far.timeline)[1]!.sourceStartUs += CONTIGUOUS_TOLERANCE_US + 1
  assert.ok('reason' in joinPair(far.timeline, ASSETS, 'a', 'right'))
})

test('a still has no source time: two abutting copies set alike join wherever each "starts"', () => {
  const timeline = timelineOf([track('v1', 'video', [clip('a', 0, 30, { assetId: STILL.id, sourceStartUs: 0 }), clip('b', 30, 30, { assetId: STILL.id, sourceStartUs: 0 })])])
  assert.ok('joined' in joinPair(timeline, ASSETS, 'a', 'b'))
  assert.equal(itemsOf(timeline)[0]!.durationInFrames, 60)
  // The pair: the same two as video are a jump back to the start, and a real cut.
  const video = timelineOf([track('v1', 'video', [clip('a', 0, 30, { sourceStartUs: 0 }), clip('b', 30, 30, { sourceStartUs: 0 })])])
  assert.ok('reason' in joinPair(video, ASSETS, 'a', 'b'))
})

test('a transition out of the second clip leaves the joined clip; one into the first still enters it', () => {
  const before = clip('z', 0, 10, { sourceStartUs: 30_000_000 })
  const after = clip('n', 100, 20, { sourceStartUs: 40_000_000 })
  const { timeline } = cut(clip('a', 10, 90), 40)
  timeline.tracks[0]!.items = [{ ...before, trackId: 'v1' }, ...itemsOf(timeline), { ...after, trackId: 'v1' }]
  timeline.transitions = [
    { id: 'tr_in', kind: 'cross-dissolve', fromItemId: 'z', toItemId: 'a', durationInFrames: 6 },
    { id: 'tr_out', kind: 'cross-dissolve', fromItemId: 'right', toItemId: 'n', durationInFrames: 6 }
  ]
  assert.ok('joined' in joinPair(timeline, ASSETS, 'a', 'right'))
  assert.deepEqual(timeline.transitions.map((t) => [t.id, t.fromItemId, t.toItemId]), [['tr_in', 'z', 'a'], ['tr_out', 'a', 'n']])
})

// -- linked clips ----------------------------------------------------------------------

function linkedPairCut(): Timeline {
  const picture = clip('p', 0, 90, { linkId: 'l1', audioDetached: true })
  const sound = clip('s', 0, 90, { linkId: 'l1' })
  const pictureRight = splitItemAt(picture, 40, 30, 'p2')!
  const soundRight = splitItemAt(sound, 40, 30, 's2')!
  // As `normaliseLinks` leaves a split pair: each half its own group.
  pictureRight.linkId = 'l2'
  soundRight.linkId = 'l2'
  return timelineOf([track('v1', 'video', [picture, pictureRight]), track('a1', 'audio', [sound, soundRight])])
}

test('joining a picture joins its detached sound with it', () => {
  const timeline = linkedPairCut()
  const result = joinPair(timeline, ASSETS, 'p', 'p2')
  assert.ok('joined' in result)
  assert.deepEqual(result.joined.map((join) => [join.itemId, join.removedId, join.trackId]), [['p', 'p2', 'v1'], ['s', 's2', 'a1']])
  assert.deepEqual(itemsOf(timeline, 'a1').map((item) => [item.id, item.durationInFrames]), [['s', 90]])
})

test('when the linked sound is a real cut the picture is not joined alone — unless asked to be', () => {
  const timeline = linkedPairCut()
  itemsOf(timeline, 'a1')[1]!.volume = 0.2
  const before = structuredClone(timeline)
  const refused = joinPair(timeline, ASSETS, 'p', 'p2')
  assert.ok('reason' in refused)
  assert.match(refused.reason, /clips linked to them on A1 are a real cut.*They differ in volume/)
  assert.match(refusalText(refused), /s and s2.*linked: false/)
  assert.deepEqual(timeline, before)
  const alone = joinPair(timeline, ASSETS, 'p', 'p2', { linked: false })
  assert.ok('joined' in alone)
  assert.equal(alone.joined.length, 1)
  assert.equal(itemsOf(timeline, 'a1').length, 2, 'the sound stays cut')
})

// -- several at once -------------------------------------------------------------------

test('naming a run of clips joins every cut among them and reports the real one', () => {
  const whole = clip('a', 0, 120)
  const second = splitItemAt(whole, 30, 30, 'b')!
  const third = splitItemAt(second, 60, 30, 'c')!
  const fourth = splitItemAt(third, 90, 30, 'd')!
  third.volume = 0.5 // c differs: the cuts b|c and c|d are real, a|b is not
  const timeline = timelineOf([track('v1', 'video', [whole, second, third, fourth])])
  const result = joinItems(timeline, ASSETS, ['a', 'b', 'c', 'd'])
  assert.deepEqual(result.joined.map((join) => [join.itemId, join.removedId]), [['a', 'b']])
  assert.deepEqual(result.refused.map((refusal) => [refusal.leftId, refusal.rightId]), [['a', 'c'], ['c', 'd']])
  assert.deepEqual(itemsOf(timeline).map((item) => [item.id, item.from, item.durationInFrames]), [['a', 0, 60], ['c', 60, 30], ['d', 90, 30]])
})

test('three pieces of one take join back into the one clip', () => {
  const whole = clip('a', 0, 120)
  const original = { ...structuredClone(whole), trackId: 'v1' }
  const second = splitItemAt(whole, 31, 30, 'b')!
  const third = splitItemAt(second, 77, 30, 'c')!
  const timeline = timelineOf([track('v1', 'video', [whole, second, third])])
  const result = joinItems(timeline, ASSETS, ['a', 'b', 'c'])
  assert.equal(result.joined.length, 2)
  assert.deepEqual(result.refused, [])
  assert.deepEqual(itemsOf(timeline), [original])
})

test('one id joins that clip to the next; several ids never reach for a clip that was not named', () => {
  const one = cut(clip('a', 10, 90), 40)
  assert.equal(joinItems(one.timeline, ASSETS, ['a']).joined.length, 1)
  const whole = clip('a', 0, 120)
  const second = splitItemAt(whole, 30, 30, 'b')!
  const third = splitItemAt(second, 60, 30, 'c')!
  const timeline = timelineOf([track('v1', 'video', [whole, second, third])])
  const result = joinItems(timeline, ASSETS, ['a', 'b'])
  assert.deepEqual(result.joined.map((join) => join.removedId), ['b'])
  assert.equal(itemsOf(timeline).length, 2, 'c was not named and stays its own clip')
})

test('with no cut among the clips named, the reason says which kind of nothing it was', () => {
  const { timeline } = cut(clip('a', 10, 90), 40)
  timeline.tracks.push(track('v2', 'video', [clip('x', 0, 20)]))
  assert.match(noCutReason(timeline, []), /Select the clips on each side of a cut/)
  assert.match(noCutReason(timeline, ['nope']), /No clip has the id "nope"/)
  assert.match(noCutReason(timeline, ['right']), /No clip starts where that clip ends on V1 \(frame 100\)/)
  assert.match(noCutReason(timeline, ['a', 'x']), /all on different tracks/)
  assert.deepEqual(joinItems(timeline, ASSETS, ['right']), { joined: [], refused: [] })
})

test('the same clip twice, clips on two tracks and an unknown id are each refused by name', () => {
  const { timeline } = cut(clip('a', 10, 90), 40)
  timeline.tracks.push(track('v2', 'video', [clip('x', 100, 20)]))
  const reasonOf = (result: ReturnType<typeof joinPair>): string => ('reason' in result ? result.reason : 'joined')
  assert.match(reasonOf(joinPair(timeline, ASSETS, 'a', 'a')), /one clip, named twice/)
  assert.match(reasonOf(joinPair(timeline, ASSETS, 'right', 'x')), /different tracks \(V1 and V2\)/)
  assert.match(reasonOf(joinPair(timeline, ASSETS, 'a', 'ghost')), /No clip has the id "ghost"/)
})
