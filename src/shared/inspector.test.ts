import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  canSound,
  commonValue,
  dbToGain,
  editKey,
  formatDb,
  gainToDb,
  hasSourceTime,
  isVisualItem,
  keyTimeBounds,
  MAX_VOLUME_DB,
  VOLUME_DB_FLOOR
} from './inspector'
import { mergeKeyframes } from './keyframes'
import type { Keyframe } from './project'

test('a text clip is a picture, although its asset says hasVideo: false', () => {
  // The requirement, not the implementation: the Text panel mints text assets with
  // hasVideo false, and the old gate (hasVideo !== false) hid Transform from every title.
  const textAsset = { kind: 'text' as const, hasVideo: false }
  assert.equal(textAsset.hasVideo !== false, false, 'specimen: the old predicate calls text invisible')
  assert.equal(isVisualItem(textAsset.kind, 'video'), true)
  for (const kind of ['video', 'image', 'gif', 'html', 'brf'] as const) {
    assert.equal(isVisualItem(kind, 'video'), true, kind)
  }
})

test('a detached sound on an audio track draws nothing, though its asset is a video', () => {
  assert.equal(isVisualItem('video', 'audio'), false)
  assert.equal(isVisualItem('audio', 'video'), false)
  assert.equal(isVisualItem('audio', undefined), false)
  // Positive control beside it: the same asset on a video track is a picture.
  assert.equal(isVisualItem('video', 'video'), true)
  // A missing asset falls back to the track, so a clip whose media is offline keeps its framing.
  assert.equal(isVisualItem(undefined, 'video'), true)
  assert.equal(isVisualItem(undefined, 'audio'), false)
})

test('speed and source in-point exist only where there is source time', () => {
  assert.equal(hasSourceTime('text'), false)
  assert.equal(hasSourceTime('image'), false)
  for (const kind of ['video', 'audio', 'gif', 'html', 'brf'] as const) assert.equal(hasSourceTime(kind), true, kind)
})

test('a clip sounds when its asset has audio and it was not detached', () => {
  assert.equal(canSound({ kind: 'video', hasAudio: true }, {}), true)
  assert.equal(canSound({ kind: 'video', hasAudio: true }, { audioDetached: true }), false)
  assert.equal(canSound({ kind: 'text', hasAudio: false }, {}), false)
  assert.equal(canSound({ kind: 'html', hasAudio: false }, {}), true)
  assert.equal(canSound(undefined, {}), false)
})

test('commonValue: agreeing values are not mixed, disagreeing ones are, NaN agrees with itself', () => {
  assert.deepEqual(commonValue([1, 1, 1]), { value: 1, mixed: false })
  assert.deepEqual(commonValue([1, 2, 1]), { value: 1, mixed: true })
  assert.deepEqual(commonValue([Number.NaN]), { value: Number.NaN, mixed: false })
  assert.deepEqual(commonValue([0, -0]), { value: 0, mixed: false })
  assert.deepEqual(commonValue<number>([]), { value: undefined, mixed: false })
})

test('dB and gain round-trip, and agree with the agent’s db volume keys', () => {
  for (const db of [-48, -24, -12, -6, -0.5, 0, 3, MAX_VOLUME_DB]) {
    const gain = dbToGain(db)
    assert.ok(Math.abs(gainToDb(gain) - db) < 1e-9, `${db} dB`)
    // The same conversion the tool applies to { frame, db }: one scale, not two.
    const merged = mergeKeyframes(undefined, { volume: [{ frame: 0, db }] }, {
      itemId: 'i', from: 0, durationInFrames: 10, hasPicture: false, hasAudio: true
    })
    assert.ok(merged.ok)
    if (merged.ok) assert.ok(Math.abs(merged.keyframes!.volume![0]!.value - gain) < 1e-12)
  }
  assert.equal(dbToGain(-6), 10 ** (-6 / 20))
  assert.equal(gainToDb(0), Number.NEGATIVE_INFINITY)
  assert.equal(dbToGain(VOLUME_DB_FLOOR), 0, 'the fader bottoms out at silence')
  assert.equal(dbToGain(12), 2, 'clamped to the model ceiling')
  assert.equal(gainToDb(1), 0)
})

test('formatDb fits the readout column and says −∞ for silence', () => {
  assert.equal(formatDb(Number.NEGATIVE_INFINITY), '−∞')
  assert.equal(formatDb(0), '0dB')
  assert.equal(formatDb(-6.02), '−6.0dB')
  assert.equal(formatDb(2.5), '+2.5dB')
  assert.equal(formatDb(-24.4), '−24dB')
  for (const db of [-59.9, -12.34, -1, 0.04, 6.02]) assert.ok(formatDb(db).length <= 6, formatDb(db))
})

test('editKey moves and eases one key; mergeKeyframes refuses a move onto another key', () => {
  const keys: Keyframe[] = [
    { frame: 0, value: 0 },
    { frame: 10, value: 1, ease: 'in' },
    { frame: 20, value: 0.5 }
  ]
  const moved = editKey(keys, 10, { to: 25 })
  assert.deepEqual(moved.map((k) => k.frame), [0, 20, 25], 'sorted after the move')
  assert.equal(moved.find((k) => k.frame === 25)?.ease, 'in', 'the ease travels with its key')
  assert.equal(keys[1]!.frame, 10, 'input untouched')

  const eased = editKey(keys, 0, { ease: 'hold' })
  assert.equal(eased[0]!.ease, 'hold')
  const linear = editKey(keys, 10, { ease: 'linear' })
  assert.equal('ease' in linear[1]!, false, 'linear is stored as absence')

  const target = { itemId: 'i', from: 0, durationInFrames: 30, hasPicture: true, hasAudio: false }
  const clash = mergeKeyframes(undefined, { opacity: editKey(keys, 10, { to: 20 }) }, target)
  assert.equal(clash.ok, false)
  if (!clash.ok) assert.match(clash.error, /two keys on frame 20/)
  // Positive control: the legal move merges.
  assert.equal(mergeKeyframes(undefined, { opacity: moved }, target).ok, true)
})

test('a key can move to the clip’s last frame and no further: the frame after the clip is never drawn', () => {
  const item = { from: 100, durationInFrames: 30 }
  const { min, max } = keyTimeBounds(item)
  assert.equal(min, 100)
  assert.equal(max, 129)
  // The clip covers [from, from + duration): its last drawn frame is max, and max + 1 is outside.
  assert.ok(max < item.from + item.durationInFrames && max + 1 === item.from + item.durationInFrames)
  assert.deepEqual(keyTimeBounds({ from: 5, durationInFrames: 1 }), { min: 5, max: 5 })
})
