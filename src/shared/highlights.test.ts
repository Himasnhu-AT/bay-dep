/**
 * Highlights: sentences out of whisper's lines, and the check every pick must pass. Run with
 * `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkPicks, FOCUSES, highlightScore, sentencesOf, type HighlightPick } from './highlights'
import type { TranscriptSegment } from './transcribe'

const w = (startSeconds: number, endSeconds: number, text: string) => ({ startSeconds, endSeconds, text })

test('words are regrouped into sentences across whisper’s ~42-character lines', () => {
  // Two lines that split the first sentence in the middle — what `-ml 42` produces.
  const segments: TranscriptSegment[] = [
    { startSeconds: 0, endSeconds: 2, text: ' So here is the thing I', words: [w(0, 0.3, 'So'), w(0.3, 0.6, 'here'), w(0.6, 0.8, 'is'), w(0.8, 1, 'the'), w(1, 1.5, 'thing'), w(1.5, 2, 'I')] },
    { startSeconds: 2, endSeconds: 4, text: ' learned. Nobody cares.', words: [w(2, 2.6, 'learned.'), w(2.8, 3.3, 'Nobody'), w(3.3, 4, 'cares.')] }
  ]
  const sentences = sentencesOf(segments)
  assert.deepEqual(sentences, [
    { startSeconds: 0, endSeconds: 2.6, text: 'So here is the thing I learned.' },
    { startSeconds: 2.8, endSeconds: 4, text: 'Nobody cares.' }
  ])
  // The instrument: the lines themselves are not sentences, or the test would prove nothing.
  assert.notDeepEqual(segments.map((s) => s.text.trim()), sentences.map((s) => s.text))
})

test('without word times, whole lines are joined until one ends a sentence', () => {
  const segments: TranscriptSegment[] = [
    { startSeconds: 0, endSeconds: 2, text: ' Why would anyone' },
    { startSeconds: 2, endSeconds: 3.5, text: ' do this?' },
    { startSeconds: 3.6, endSeconds: 5, text: ' Because it works!”' }
  ]
  assert.deepEqual(sentencesOf(segments).map((s) => [s.startSeconds, s.endSeconds, s.text]), [
    [0, 3.5, 'Why would anyone do this?'],
    [3.6, 5, 'Because it works!”']
  ])
})

test('a long silence or a run-on closes a sentence even with no punctuation', () => {
  const segments: TranscriptSegment[] = [
    { startSeconds: 0, endSeconds: 2, text: ' first thought' },
    { startSeconds: 5, endSeconds: 7, text: ' after a pause' }
  ]
  assert.equal(sentencesOf(segments).length, 2, 'a 3-second gap ends the sentence')
  assert.equal(sentencesOf(segments, { pauseSeconds: 10 }).length, 1, 'positive control: a shorter gap than the threshold joins')

  const runOn: TranscriptSegment[] = Array.from({ length: 20 }, (_, i) => ({ startSeconds: i * 3, endSeconds: i * 3 + 3, text: ` part ${i}` }))
  const cut = sentencesOf(runOn, { maxSeconds: 30 })
  assert.ok(cut.length >= 2, 'an unpunctuated minute is not one sentence')
  for (const s of cut) assert.ok(s.endSeconds - s.startSeconds <= 30 + 3, `${s.text} runs too long`)
})

const limits = { bounds: { from: 0, to: 3000 }, fps: 30, minSeconds: 10, maxSeconds: 40 }
const pick = (title: string, fromFrame: number, toFrame: number, extra: Partial<HighlightPick> = {}): HighlightPick => ({ title, fromFrame, toFrame, ...extra })

test('good picks pass, including two that touch', () => {
  assert.deepEqual(checkPicks([pick('A', 0, 600), pick('B', 600, 1200)], limits), [])
})

test('every fault is named at once, with what to change', () => {
  const faults = checkPicks(
    [
      pick('Late', 1200, 1500),
      pick('Overlapping', 1400, 1800),
      pick('Too short', 2000, 2100),
      pick('Past the end', 2800, 3100),
      pick('', 100, 400),
      pick('Backwards', 500, 450),
      pick('Bad score', 400, 700, { scores: { hook: 120, information: 50, emotion: 50, completeness: 50 } })
    ],
    limits
  )
  const all = faults.join('\n')
  assert.match(all, /"Overlapping".*overlaps.*"Late".*by 100 frames/)
  assert.match(all, /"Too short".*3\.3s, shorter than the 10s minimum/)
  assert.match(all, /"Past the end".*outside the material, frames 0–3000/)
  assert.match(all, /highlights\[4\] has no title/)
  assert.match(all, /"Backwards".*ends \(frame 450\) at or before it starts/)
  assert.match(all, /scores\.hook must be a number from 0 to 100, but got 120/)
  assert.match(checkPicks([pick('Long', 0, 1500)], limits).join(''), /50\.0s, longer than the 40s maximum.*earlier sentence/)
})

test('overlap is found whatever order the picks arrive in', () => {
  const faults = checkPicks([pick('Second', 900, 1300), pick('First', 0, 1000)], limits)
  assert.equal(faults.length, 1)
  assert.match(faults[0]!, /"Second".*overlaps.*"First"/)
})

test('the focus decides the ranking: a gripping clip wins viral, a complete one wins knowledge', () => {
  const gripping = { hook: 95, information: 30, emotion: 90, completeness: 50 }
  const thorough = { hook: 40, information: 95, emotion: 30, completeness: 95 }
  assert.ok(highlightScore(gripping, 'viral') > highlightScore(thorough, 'viral'))
  assert.ok(highlightScore(thorough, 'knowledge') > highlightScore(gripping, 'knowledge'))
  for (const focus of Object.keys(FOCUSES) as (keyof typeof FOCUSES)[]) {
    const sum = Object.values(FOCUSES[focus].weights).reduce((a, b) => a + b, 0)
    assert.ok(Math.abs(sum - 1) < 1e-9, `${focus} weights sum to 1, so a score stays 0–100`)
  }
  assert.equal(highlightScore({ hook: 100, information: 100, emotion: 100, completeness: 100 }, 'balanced'), 100)
})
