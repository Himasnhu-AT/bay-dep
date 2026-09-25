/**
 * The mechanical half of dubbing: cue slots, the tempo decision, and the refusal an over-long
 * line gets. Each rule is paired with the nearest case it must *not* catch.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  cleanForSpeech,
  dubCues,
  fitTempo,
  overLongRefusal,
  speechBudget,
  suggestedCut,
  DUB_GAP_SECONDS,
  TEMPO_ACCEPT,
  TEMPO_WARN
} from './dub'

const FPS = 30

test('sound tags and symbols are cleaned from a line; the words are kept', () => {
  assert.equal(cleanForSpeech('(music) Welcome back [Applause] to the show™'), 'Welcome back to the show')
  assert.equal(cleanForSpeech('Salt & pepper'), 'Salt and pepper')
  // Positive control: an ordinary parenthesis is speech and stays.
  assert.equal(cleanForSpeech('It works (mostly).'), 'It works (mostly).')
})

test('a slot runs to the next cue, capped at the gap tolerance past its own end, and the last is bounded by the end', () => {
  const gap = Math.round(DUB_GAP_SECONDS * FPS)
  const cues = dubCues(
    [
      { fromFrame: 0, toFrame: 60, text: 'One.' }, // next starts at 75: the next cue binds
      { fromFrame: 75, toFrame: 150, text: 'Two.' }, // next starts at 400: the gap cap binds
      { fromFrame: 400, toFrame: 450, text: 'Three.' } // end at 470: the end binds
    ],
    470,
    FPS
  )
  // The specimen must exercise each bound, or the assertions below would pass on any one rule.
  assert.ok(60 + gap > 75 && 150 + gap < 400 && 450 + gap > 470, 'each cue must be limited by a different bound')
  assert.deepEqual(
    cues.map((c) => [c.id, c.slotFrames, c.slotSeconds]),
    [
      ['c1', 75, 2.5],
      ['c2', 75 + gap, (75 + gap) / FPS],
      ['c3', 70, 2.33]
    ]
  )
})

test('a cue that is only a sound tag is dropped, and the ids stay a plain sequence', () => {
  const cues = dubCues(
    [
      { fromFrame: 0, toFrame: 30, text: '[Music]' },
      { fromFrame: 40, toFrame: 80, text: 'Hello.' }
    ],
    100,
    FPS
  )
  assert.deepEqual(cues.map((c) => [c.id, c.text, c.fromFrame]), [['c1', 'Hello.', 40]])
})

test('tempo: never slowed, quiet up to the accepted tempo, a warning up to the limit, refused beyond', () => {
  assert.deepEqual(fitTempo(1.5, 2), { tempo: 1, verdict: 'fits' })
  assert.deepEqual(fitTempo(2, 2), { tempo: 1, verdict: 'fits' })
  assert.deepEqual(fitTempo(2.4, 2), { tempo: 1.2, verdict: 'tempo' })
  assert.deepEqual(fitTempo(2 * TEMPO_ACCEPT, 2), { tempo: TEMPO_ACCEPT, verdict: 'tempo' })
  assert.deepEqual(fitTempo(2.6, 2), { tempo: 1.3, verdict: 'warn' })
  assert.deepEqual(fitTempo(2 * TEMPO_WARN, 2), { tempo: TEMPO_WARN, verdict: 'warn' })
  assert.equal(fitTempo(2.82, 2).verdict, 'refuse')
  assert.equal(fitTempo(1, 0).verdict, 'refuse')
})

test('the tempo is rounded up, so the fitted line never overruns its slot by the rounding', () => {
  for (const [seconds, slot] of [[2.3456, 2], [3.33333, 3], [1.0001, 1]] as const) {
    const { tempo } = fitTempo(seconds, slot)
    assert.ok(seconds / tempo <= slot + 1e-9, `${seconds}s at ${tempo}× is ${seconds / tempo}s, over the ${slot}s slot`)
  }
})

test('the suggested cut keeps the share of characters that fits the slot', () => {
  assert.deepEqual(suggestedCut('abcdefghij', 4, 2), { cut: 5, keep: 5 })
  assert.deepEqual(suggestedCut('abcdefghij', 2, 4), { cut: 0, keep: 10 })
})

test('an over-long refusal names every line past the accepted tempo, its overage and the cut, and no other line', () => {
  const lines = [
    { cueId: 'c1', text: 'Hola.', slotSeconds: 2, estimatedSeconds: 1, ...fitTempo(1, 2) },
    { cueId: 'c2', text: 'x'.repeat(40), slotSeconds: 2, estimatedSeconds: 3.4, ...fitTempo(3.4, 2) },
    // Sped up a little, which is fine: must not be named.
    { cueId: 'c3', text: 'y'.repeat(20), slotSeconds: 2, estimatedSeconds: 2.3, ...fitTempo(2.3, 2) },
    // Between the accepted tempo and the warning limit: still refused before paying.
    { cueId: 'c4', text: 'z'.repeat(30), slotSeconds: 1, estimatedSeconds: 1.3, ...fitTempo(1.3, 1) }
  ]
  const message = overLongRefusal(lines, 'es')
  assert.ok(message)
  assert.match(message, /2 of 4 translated lines/)
  assert.match(message, /c2: estimated 3\.4s for a 2s slot — 1\.4s over \(needs 1\.7×.*Cut about 17 characters \(to 23 or fewer\)/)
  assert.match(message, /c4: estimated 1\.3s for a 1s slot — 0\.3s over .*Cut about 7 characters \(to 23 or fewer\)/)
  assert.doesNotMatch(message, /c1:|c3:/)
  assert.match(message, /nothing was generated or spent/)
  // Positive control: the same lines without the long ones pass.
  assert.equal(overLongRefusal([lines[0]!, lines[2]!], 'es'), null)
})

test('a budget is given in the estimator’s own unit for the language', () => {
  assert.equal(speechBudget(2, 'es').unit, 'syllables')
  assert.equal(speechBudget(2, 'zh').unit, 'characters')
  // Spanish at a normal pace is 5.9 syllables a second; fast is quicker.
  assert.equal(speechBudget(2, 'es').about, 11)
  assert.ok(speechBudget(2, 'es', 'fast').about > speechBudget(2, 'es').about)
})
