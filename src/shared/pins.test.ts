/**
 * Pins, mention matching, and the message the agent receives. Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  activeTrigger,
  parseTime,
  composeMessage,
  matchMentions,
  pinKey,
  pinLabel,
  type MentionCandidate,
  type Pin
} from './pins'

const asset: Pin = { kind: 'asset', assetId: 'ast_1', name: 'Interview.mp4', assetKind: 'video', durationUs: 68_000_000 }
const clip: Pin = { kind: 'clip', itemId: 'itm_9', name: 'Interview.mp4', trackName: 'V1', fromFrame: 30, toFrame: 180 }
const range: Pin = { kind: 'range', fromFrame: 300, toFrame: 450 }

test('with no pins, the message is sent exactly as typed', () => {
  assert.equal(composeMessage('Tighten the opening', [], 30), 'Tighten the opening')
})

test('pins reach the agent as ids and frames it can pass straight to its tools', () => {
  const message = composeMessage('Add captions here', [asset, clip], 30)
  assert.match(message, /assetId ast_1/)
  assert.match(message, /itemId itm_9/)
  assert.match(message, /frames 30–180/)
  // The request itself comes last, after the context it depends on.
  assert.ok(message.endsWith('Add captions here'))
})

test('a pinned range carries the rule to stay inside it', () => {
  const message = composeMessage('Remove the pauses', [range], 30)
  assert.match(message, /frames 300 up to but not including 450/)
  assert.match(message, /Work only inside the pinned time range\./)
  assert.match(message, /Do not move, trim, delete or add anything outside it/)
  assert.match(message, /ripple/)
  // Positive control: pins without a range carry no such rule.
  assert.doesNotMatch(composeMessage('x', [asset], 30), /Work only inside/)
})

test('two ranges are named in the plural', () => {
  const message = composeMessage('x', [range, { kind: 'range', fromFrame: 0, toFrame: 30 }], 30)
  assert.match(message, /pinned time ranges\. .*outside them/)
})

test('each thing has one key, so it cannot be pinned twice', () => {
  assert.equal(pinKey(asset), pinKey({ ...asset, name: 'renamed' }))
  assert.notEqual(pinKey(asset), pinKey(clip))
  assert.notEqual(pinKey(range), pinKey({ kind: 'range', fromFrame: 300, toFrame: 451 }))
})

test('chips read in the user’s terms', () => {
  assert.equal(pinLabel(asset, 30), 'Interview.mp4')
  assert.equal(pinLabel(clip, 30), 'Interview.mp4 · V1')
  assert.equal(pinLabel(range, 30), '0:10:00–0:15:00')
})

const candidates: MentionCandidate[] = [
  { pin: range, label: 'Playhead', detail: '', group: 'Time' },
  { pin: asset, label: 'Painting.mp4', detail: '', group: 'Assets' },
  { pin: { ...asset, assetId: 'ast_2', name: 'Interview.mp4' }, label: 'Interview.mp4', detail: '', group: 'Assets' },
  { pin: { ...asset, assetId: 'ast_3', name: 'b-roll_interview.mov' }, label: 'b-roll_interview.mov', detail: '', group: 'Assets' }
]

test('a match at the start of a word ranks above one inside a word', () => {
  const found = matchMentions('int', candidates).map((c) => c.label)
  // "Painting" contains "int" mid-word; "Interview" and "b-roll_interview" start a word with it.
  assert.deepEqual(found, ['Interview.mp4', 'b-roll_interview.mov', 'Painting.mp4'])
})

test('matching is case-insensitive, and an empty query offers everything in order', () => {
  assert.deepEqual(matchMentions('PLAY', candidates).map((c) => c.label), ['Playhead'])
  assert.deepEqual(matchMentions('', candidates).map((c) => c.label), candidates.map((c) => c.label))
  assert.deepEqual(matchMentions('zzz', candidates), [])
})

test('@ opens a mention only at a word start, and ends at a space', () => {
  assert.deepEqual(activeTrigger('trim @int', 9), { char: '@', start: 5, query: 'int' })
  assert.deepEqual(activeTrigger('@', 1), { char: '@', start: 0, query: '' })
  // An email address, or a completed mention followed by more words, is not a trigger.
  assert.equal(activeTrigger('mail me@example.com', 19), null)
  assert.equal(activeTrigger('trim @interview clip', 20), null)
  // The caret decides: in the middle of the mention it is still active.
  assert.deepEqual(activeTrigger('trim @interview clip', 9), { char: '@', start: 5, query: 'int' })
})

test('/ is a command only at the very start of the message', () => {
  assert.deepEqual(activeTrigger('/cap', 4), { char: '/', start: 0, query: 'cap' })
  assert.equal(activeTrigger('cut the in /out', 15), null)
  assert.equal(activeTrigger('use in/out', 10), null)
})

test('typed times are read as frames in every form the range editor offers', () => {
  assert.equal(parseTime('0:10:00', 30), 300) // m:ss:ff, the form the timeline shows
  assert.equal(parseTime('0:00:10:15', 30), 315) // h:mm:ss:ff
  assert.equal(parseTime('4.5s', 30), 135)
  assert.equal(parseTime('135f', 30), 135)
  assert.equal(parseTime('12', 30), 360) // a bare number is seconds
  // 29.97 counts thirty frame slots a second, as the timeline's own timecode does.
  assert.equal(parseTime('0:01:00', 29.97), 30)
})

test('a time that is not one is refused, never guessed', () => {
  for (const bad of ['', 'soon', '1:2', '0:60:00', '0:10:30', '-5s', '1:2:3:4:5']) {
    assert.equal(parseTime(bad, 30), null, bad)
  }
})
