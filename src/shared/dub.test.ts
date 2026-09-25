/**
 * The mechanical half of dubbing: cue slots, the tempo decision, and the refusal an over-long
 * line gets. Each rule is paired with the nearest case it must *not* catch.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  cleanForSpeech,
  dubCues,
  dubPlanId,
  fitTempo,
  noRoomRefusal,
  overLongRefusal,
  separateLines,
  speechBudget,
  suggestedCut,
  DUB_GAP_SECONDS,
  DUB_MUTE_DB,
  TEMPO_ACCEPT,
  TEMPO_WARN
} from './dub'
import { MAX_DUCK_DB } from './audio-gain'

const FPS = 30

test('a cue keeps its id when the cues around it change; a position-numbered id would not', () => {
  const all = dubCues(
    [
      { fromFrame: 0, toFrame: 30, text: 'First.' },
      { fromFrame: 60, toFrame: 90, text: 'Second.' },
      { fromFrame: 120, toFrame: 150, text: 'Third.' }
    ],
    300,
    FPS
  )
  // The same clip read from frame 50 on (a narrower range): "Second." is the first cue now.
  const later = dubCues(
    [
      { fromFrame: 60, toFrame: 90, text: 'Second.' },
      { fromFrame: 120, toFrame: 150, text: 'Third.' }
    ],
    300,
    FPS
  )
  const idOf = (list: typeof all, text: string): string | undefined => list.find((c) => c.text === text)?.id
  assert.equal(idOf(later, 'Second.'), idOf(all, 'Second.'))
  assert.equal(idOf(later, 'Third.'), idOf(all, 'Third.'))
  assert.deepEqual(all.map((c) => c.id), ['c@0', 'c@60', 'c@120'])
  // No id of the narrower list names a different sentence in the wider one.
  for (const cue of later) assert.equal(all.find((c) => c.id === cue.id)?.text, cue.text)
})

test('two cues on one frame get distinct ids, and the first has no room', () => {
  const cues = dubCues(
    [
      { fromFrame: 30, toFrame: 60, text: 'One.' },
      { fromFrame: 30, toFrame: 90, text: 'Two.' }
    ],
    300,
    FPS
  )
  assert.deepEqual(cues.map((c) => [c.id, c.slotFrames]), [['c@30', 0], ['c@30.2', 60 + Math.round(DUB_GAP_SECONDS * FPS)]])
  // A translation for the cue with no room is refused by name; leaving it out is not.
  assert.match(String(noRoomRefusal(cues, new Set(['c@30', 'c@30.2']))), /^c@30 has no room: it starts where the next cue or the range ends/)
  assert.equal(noRoomRefusal(cues, new Set(['c@30.2'])), null)
})

test('a slot never runs past the next cue or the range, even when the cue itself does', () => {
  const cues = dubCues(
    [
      // whisper timed this sentence past the start of the next one.
      { fromFrame: 0, toFrame: 100, text: 'Overlapping.' },
      { fromFrame: 80, toFrame: 120, text: 'Next.' },
      // And this one past the end of the dubbed range.
      { fromFrame: 200, toFrame: 260, text: 'Last.' }
    ],
    230,
    FPS
  )
  assert.deepEqual(cues.map((c) => [c.id, c.slotFrames]), [['c@0', 80], ['c@80', 120 - 80 + Math.round(DUB_GAP_SECONDS * FPS)], ['c@200', 30]])
  // Positive control: a cue that ends before the next one keeps its gap tolerance.
  const apart = dubCues([{ fromFrame: 0, toFrame: 30, text: 'A.' }, { fromFrame: 200, toFrame: 230, text: 'B.' }], 300, FPS)
  assert.equal(apart[0]!.slotFrames, 30 + Math.round(DUB_GAP_SECONDS * FPS))
})

test('a plan id names the reading: the same clip reads the same, any change reads differently', () => {
  const cues = dubCues([{ fromFrame: 0, toFrame: 30, text: 'Hi.' }], 100, FPS)
  const id = dubPlanId('clip', { from: 0, to: 100 }, cues)
  assert.match(id, /^plan-[0-9a-f]{16}$/)
  assert.equal(dubPlanId('clip', { from: 0, to: 100 }, dubCues([{ fromFrame: 0, toFrame: 30, text: 'Hi.' }], 100, FPS)), id)
  assert.notEqual(dubPlanId('clip', { from: 0, to: 90 }, cues), id)
  assert.notEqual(dubPlanId('clip', { from: 0, to: 100 }, dubCues([{ fromFrame: 0, toFrame: 30, text: 'Hey.' }], 100, FPS)), id)
  assert.notEqual(dubPlanId('other', { from: 0, to: 100 }, cues), id)
})

test('lines placed together never overlap: the earlier ends at the later, one with no frames left is dropped', () => {
  const out = separateLines([
    { cueId: 'b', from: 50, durationInFrames: 30 },
    { cueId: 'a', from: 0, durationInFrames: 70 },
    { cueId: 'c', from: 100, durationInFrames: 10 },
    { cueId: 'd', from: 100, durationInFrames: 20 }
  ])
  assert.deepEqual(out.kept.map((l) => [l.cueId, l.from, l.durationInFrames]), [['a', 0, 50], ['b', 50, 30], ['d', 100, 20]])
  assert.deepEqual(out.trimmed, ['a'])
  assert.deepEqual(out.dropped, ['c'])
  // Positive control: lines that already fit are passed through untouched.
  const clean = [{ cueId: 'x', from: 0, durationInFrames: 10 }, { cueId: 'y', from: 10, durationInFrames: 10 }]
  assert.deepEqual(separateLines(clean), { kept: clean, trimmed: [], dropped: [] })
})

test('a mute is the deepest duck there is', () => {
  assert.equal(DUB_MUTE_DB, MAX_DUCK_DB)
  assert.equal(DUB_MUTE_DB, 40)
})

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
      ['c@0', 75, 2.5],
      ['c@75', 75 + gap, (75 + gap) / FPS],
      ['c@400', 70, 2.33]
    ]
  )
})

test('a cue that is only a sound tag is dropped, and the others keep their ids, which name where they start', () => {
  const cues = dubCues(
    [
      { fromFrame: 0, toFrame: 30, text: '[Music]' },
      { fromFrame: 40, toFrame: 80, text: 'Hello.' }
    ],
    100,
    FPS
  )
  assert.deepEqual(cues.map((c) => [c.id, c.text, c.fromFrame]), [['c@40', 'Hello.', 40]])
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
