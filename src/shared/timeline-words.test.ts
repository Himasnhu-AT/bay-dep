/**
 * The Transcript panel's model: which clips speak, where their words land, and what deleting
 * words removes.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { cutRanges, findWords, speechItems, timelineWords, wordAt, type TimelineWord } from './timeline-words'
import type { TranscriptSegment } from './transcribe'
import type { Asset, Item, Project, Timeline } from './project'

const asset = (id: string, over: Partial<Asset> = {}): Asset =>
  ({ id, kind: 'video', path: `/m/${id}.mov`, hasAudio: true, hasVideo: true, ...over }) as Asset

const item = (id: string, assetId: string, from: number, over: Partial<Item> = {}): Item =>
  ({ id, assetId, from, durationInFrames: 100, sourceStartUs: 0, speed: 1, ...over }) as Item

test('speech clips: those with a sound file, in time order, one per sound', () => {
  const project = {
    assets: [asset('v'), asset('mute', { hasAudio: false }), asset('title', { kind: 'text', path: null, hasAudio: false }), asset('m', { kind: 'audio', hasVideo: false })]
  } as Pick<Project, 'assets'>
  const timeline = {
    tracks: [
      // The picture of a detached pair: its sound is the A1 clip below, so it is not listed twice.
      { items: [item('pic', 'v', 0, { audioDetached: true }), item('late', 'v', 300)] },
      { items: [item('snd', 'v', 0), item('b-roll', 'mute', 100), item('t', 'title', 0), item('music', 'm', 150)] }
    ]
  } as unknown as Timeline
  assert.deepEqual(speechItems(project, timeline, []).map((i) => i.id), ['snd', 'music', 'late'])
  // A selected clip with sound narrows the list to it; a selection with none does not.
  assert.deepEqual(speechItems(project, timeline, ['late']).map((i) => i.id), ['late'])
  assert.deepEqual(speechItems(project, timeline, ['b-roll']).map((i) => i.id), ['snd', 'music', 'late'])
})

const segments: TranscriptSegment[] = [
  {
    startSeconds: 0,
    endSeconds: 2,
    text: ' hello there friend',
    words: [
      { startSeconds: 0, endSeconds: 0.5, text: ' hello' },
      { startSeconds: 0.5, endSeconds: 1, text: ' there' },
      { startSeconds: 1.2, endSeconds: 2, text: ' friend' }
    ]
  }
]

test('words land where the clip plays them: shifted by its position and in-point', () => {
  // The clip starts on frame 50 and plays the file from 0.5 s: "hello" is before its in-point.
  const clip = item('c', 'v', 50, { sourceStartUs: 500_000 })
  const { words, untranscribed } = timelineWords([clip, item('other', 'v', 500)], (i) => (i.id === 'c' ? segments : undefined), 10)
  assert.deepEqual(
    words.map((w) => [w.text, w.fromFrame, w.toFrame]),
    [
      ['there', 50, 55],
      ['friend', 57, 65]
    ]
  )
  assert.deepEqual(untranscribed.map((i) => i.id), ['other'])
})

test('a transcript without word times still gives cuttable lines', () => {
  const lines: TranscriptSegment[] = [{ startSeconds: 0, endSeconds: 1, text: ' whole line' }]
  const { words } = timelineWords([item('c', 'v', 0)], () => lines, 10)
  assert.deepEqual(words.map((w) => [w.text, w.fromFrame, w.toFrame]), [['whole line', 0, 10]])
})

const w = (fromFrame: number, toFrame: number, text = 'x'): TimelineWord => ({ itemId: 'c', fromFrame, toFrame, text })

test('the word at a frame is found between its bounds, and none in a pause', () => {
  const words = [w(0, 5), w(5, 9), w(12, 20)]
  assert.equal(wordAt(words, 0), 0)
  assert.equal(wordAt(words, 5), 1)
  assert.equal(wordAt(words, 10), -1)
  assert.equal(wordAt(words, 19), 2)
  assert.equal(wordAt(words, 20), -1)
})

test('deleting words removes one span per run, last first, so earlier frames stay valid', () => {
  const words = [w(0, 5), w(5, 9), w(12, 20), w(20, 30), w(31, 40)]
  // Two runs: words 0-1 and word 3. Word 2 between them is kept.
  assert.deepEqual(cutRanges(words, new Set([0, 1, 3])), [
    { fromFrame: 20, toFrame: 30 },
    { fromFrame: 0, toFrame: 9 }
  ])
  assert.deepEqual(cutRanges(words, new Set()), [])
})

test('search finds single words anywhere and phrases across words', () => {
  const words = [w(0, 1, 'Thank'), w(1, 2, 'you,'), w(2, 3, 'thanks'), w(3, 4, 'you')]
  assert.deepEqual(findWords(words, 'thank you'), [[0, 1]])
  assert.deepEqual(findWords(words, 'than'), [[0], [2]])
  assert.deepEqual(findWords(words, 'you'), [[1], [3]])
  assert.deepEqual(findWords(words, '  '), [])
})
