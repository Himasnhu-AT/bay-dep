/**
 * The score's contract: what is accepted, and what each refusal says. Run with `pnpm test`.
 *
 * Every refusal is paired with the nearest score that must still pass, because a checker that
 * refuses everything and one that is correctly strict print the same thing; and each is read
 * for what the caller needs in order to retry, not merely for being a refusal.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_CEILING_DB, DEFAULT_ROOM, SFX_LIMITS, SFX_MATERIALS, SFX_MATERIAL_NAMES, checkScore, scoreDensity } from './score'

function errorsOf(input: unknown): string {
  const checked = checkScore(input)
  assert.equal(checked.ok, false, 'expected a refusal')
  return checked.ok ? '' : checked.errors.join('\n')
}

function scoreOf(input: unknown): Extract<ReturnType<typeof checkScore>, { ok: true }> {
  const checked = checkScore(input)
  assert.equal(checked.ok, true, checked.ok ? '' : checked.errors.join('\n'))
  if (!checked.ok) throw new Error('unreachable')
  return checked
}

test('a film event list — { t, material, gain, pan } — is a whole score, with the rest defaulted', () => {
  // The shape a film composition reports from window.__film.events(), copied straight across.
  const { score, warnings } = scoreOf({
    durationSeconds: 12,
    events: [
      { t: 0.4, material: 'whoosh', gain: 0.6, pan: -0.4 },
      { t: 1.1, material: 'thump', gain: 1, pan: 0 }
    ]
  })
  assert.deepEqual(warnings, [])
  assert.equal(score.events.length, 2)
  assert.deepEqual(score.events[0], {
    t: 0.4, material: 'whoosh', gain: 0.6, pan: -0.4, pitch: 0, size: 1, brightness: 0.5, send: SFX_MATERIALS.whoosh.send
  })
  // Each material is sent to the room by its own distance unless the event says otherwise.
  assert.equal(score.events[1]!.send, SFX_MATERIALS.thump.send)
  assert.notEqual(SFX_MATERIALS.thump.send, SFX_MATERIALS.whoosh.send)
  assert.deepEqual(score.room, DEFAULT_ROOM)
  assert.equal(score.ceilingDb, DEFAULT_CEILING_DB)
  assert.equal(score.seed, 1)
  assert.equal(score.tail, 'fit')
})

test('the palette is small, and every material says what it is for', () => {
  assert.ok(SFX_MATERIAL_NAMES.length >= 4 && SFX_MATERIAL_NAMES.length <= 6, 'a palette, not a library')
  for (const name of SFX_MATERIAL_NAMES) assert.ok(SFX_MATERIALS[name].use.length > 20, name)
})

test('an event at or past the end is refused with its index, its time and the duration; one just inside passes', () => {
  const said = errorsOf({ durationSeconds: 5, events: [{ t: 1, material: 'knock' }, { t: 5, material: 'knock' }] })
  assert.match(said, /events\[1\]\.t is 5 s/)
  assert.match(said, /durationSeconds 5/)
  assert.match(said, /move the event before 5, or lengthen durationSeconds/)
  assert.doesNotMatch(said, /events\[0\]/, 'the event inside the score is not accused')
  scoreOf({ durationSeconds: 5, events: [{ t: 1, material: 'knock' }, { t: 4.99, material: 'knock' }] })

  assert.match(errorsOf({ durationSeconds: 5, events: [{ t: -0.1, material: 'knock' }] }), /events\[0\]\.t is -0\.1, outside 0 to/)
})

test('an unknown material is refused naming every valid one and what it is for; each valid one passes', () => {
  const said = errorsOf({ durationSeconds: 5, events: [{ t: 1, material: 'beep' }] })
  assert.match(said, /events\[0\]\.material is "beep"/)
  for (const name of SFX_MATERIAL_NAMES) {
    assert.ok(said.includes(name), `the refusal names ${name}`)
    assert.ok(said.includes(SFX_MATERIALS[name].use), `…and what ${name} is for`)
    scoreOf({ durationSeconds: 5, events: [{ t: 1, material: name }] })
  }
  // A name that is a property of every object is not a material.
  assert.match(errorsOf({ durationSeconds: 5, events: [{ t: 1, material: 'toString' }] }), /material is "toString"/)
  assert.match(errorsOf({ durationSeconds: 5, events: [{ t: 1 }] }), /events\[0\]\.material is missing/)
})

const every = (count: number, seconds: number): { t: number; material: string }[] =>
  Array.from({ length: count }, (_, i) => ({ t: (i * seconds) / count, material: 'knock' }))

test('too dense a score is refused with its rate, the limit, and what the palette is for', () => {
  const duration = 10
  const allowed = SFX_LIMITS.averagePerSecond * duration
  // The specimen really is over the limit, and its neighbour really is at it.
  const said = errorsOf({ durationSeconds: duration, events: every(allowed + 20, duration) })
  assert.match(said, /5 events a second \(50 in 10 s\)/)
  assert.match(said, /not one sound per visual event/)
  assert.match(said, new RegExp(`${SFX_LIMITS.averagePerSecond} a second on average \\(${allowed} here\\)`))
  assert.match(said, /one key in three/)
  scoreOf({ durationSeconds: duration, events: every(allowed, duration) })
})

test('a burst inside one second is refused with where it is, even when the average is low', () => {
  const burst = (count: number): unknown => ({
    durationSeconds: 60,
    events: Array.from({ length: count }, (_, i) => ({ t: 20 + i * 0.1, material: 'bell', pitch: i }))
  })
  const over = SFX_LIMITS.perSecondWindow + 1
  const said = errorsOf(burst(over))
  assert.match(said, new RegExp(`${over} events start in the second from 20 s`))
  assert.match(said, /drop the rest, or spread them out/)
  scoreOf(burst(SFX_LIMITS.perSecondWindow))
})

test('scoreDensity counts the busiest one-second window, not the busiest calendar second', () => {
  // Four hits straddling 1.0 s: no whole-numbered second holds more than two of them.
  const density = scoreDensity([0.6, 0.9, 1.2, 1.5, 3], 10)
  assert.equal(density.windowCount, 4)
  assert.equal(density.windowFrom, 0.6)
  assert.equal(density.perSecond, 0.5)
  // Exactly one second apart is two windows.
  assert.equal(scoreDensity([1, 2], 10).windowCount, 1)
})

test('a non-finite number is refused as non-finite, wherever it is; the finite value passes', () => {
  const base = { t: 1, material: 'bell' }
  for (const [field, bad, good] of [
    ['gain', Number.NaN, 0.5],
    ['pan', Number.POSITIVE_INFINITY, 0.5],
    ['pitch', Number.NEGATIVE_INFINITY, 7],
    ['size', Number.NaN, 2],
    ['brightness', Number.NaN, 1],
    ['send', Number.NaN, 0],
    ['t', Number.NaN, 2]
  ] as const) {
    const said = errorsOf({ durationSeconds: 5, events: [{ ...base, [field]: bad }] })
    assert.match(said, new RegExp(`events\\[0\\]\\.${field} is ${String(bad)}, which is not a finite number`), field)
    assert.match(said, /give a number from/, field)
    scoreOf({ durationSeconds: 5, events: [{ ...base, [field]: good }] })
  }
  assert.match(errorsOf({ durationSeconds: Number.NaN, events: [base] }), /durationSeconds is NaN, which is not a finite number/)
  assert.match(
    errorsOf({ durationSeconds: 5, events: [base], room: { decaySeconds: Number.POSITIVE_INFINITY } }),
    /room\.decaySeconds is Infinity, which is not a finite number/
  )
})

test('a value outside its range is refused with the range; the edges pass', () => {
  const one = (extra: Record<string, unknown>): unknown => ({ durationSeconds: 5, events: [{ t: 1, material: 'drop', ...extra }] })
  assert.match(errorsOf(one({ gain: 1.5 })), /events\[0\]\.gain is 1\.5, outside 0 to 1 \(1 is the loudest one hit gets\)/)
  assert.match(errorsOf(one({ pan: -2 })), /events\[0\]\.pan is -2, outside -1 to 1/)
  assert.match(errorsOf(one({ pitch: 30 })), /events\[0\]\.pitch is 30, outside -24 to 24 semitones/)
  assert.match(errorsOf(one({ gain: '0.5' })), /events\[0\]\.gain must be a number from 0 to 1.*but is "0\.5"/)
  scoreOf(one({ gain: 1, pan: -1, pitch: 24, size: 4, brightness: 0, send: 1 }))
  assert.match(errorsOf({ durationSeconds: 500, events: [{ t: 1, material: 'drop' }] }), /durationSeconds is 500, outside 0\.1 to 120/)
  assert.match(errorsOf({ durationSeconds: 5, events: [{ t: 1, material: 'drop' }], ceilingDb: 0 }), /ceilingDb is 0, outside -24 to -1 dBFS/)
  assert.match(errorsOf({ durationSeconds: 5, events: [{ t: 1, material: 'drop' }], seed: 1.5 }), /seed is 1\.5; it must be a whole number/)
  assert.match(errorsOf({ durationSeconds: 5, events: [{ t: 1, material: 'drop' }], tail: 'cut' }), /tail is "cut"\. Use "fit".*or "ring"/)
})

test('a score that is not a score says what one looks like', () => {
  assert.match(errorsOf(null), /must be an object: \{ durationSeconds, events/)
  assert.match(errorsOf({ durationSeconds: 5 }), /events must be an array.*but is missing.*window\.__film\.events\(\)/)
  assert.match(errorsOf({ durationSeconds: 5, events: [] }), /events is empty, so there is nothing to render/)
  assert.match(errorsOf({ durationSeconds: 5, events: ['knock'] }), /events\[0\] must be an object/)
  assert.match(errorsOf({ events: [{ t: 1, material: 'knock' }] }), /durationSeconds is missing/)
  assert.match(errorsOf({ durationSeconds: 5, events: [{ t: 1, material: 'knock' }], reverb: {} }), /no field "reverb"\. It takes durationSeconds, events, room/)
  assert.match(errorsOf({ durationSeconds: 5, events: [{ t: 1, material: 'knock' }], room: { size: 2 } }), /room has no field "size"\. It takes decaySeconds/)
})

test('a field an event carries that is not read is a warning naming it, not a refusal and not silence', () => {
  // A film may report more than the sound needs; a typo ("volume" for "gain") must still be seen.
  const { score, warnings } = scoreOf({
    durationSeconds: 5,
    events: [{ t: 1, material: 'knock', volume: 0.2, kind: 'key' }, { t: 2, material: 'knock', kind: 'key' }]
  })
  assert.equal(score.events.length, 2)
  assert.equal(score.events[0]!.gain, 0.7, 'the unread field changed nothing')
  assert.ok(warnings.some((w) => /"volume" on events\[0\] is not read\. An event takes t, material, gain, pan/.test(w)), warnings.join('\n'))
  assert.ok(warnings.some((w) => /"kind" on 2 events is not read/.test(w)), warnings.join('\n'))
})

test('two hits of one material at one pitch 20 ms apart are warned about; a chord and a layered hit are not', () => {
  const twin = scoreOf({ durationSeconds: 5, events: [{ t: 1, material: 'knock' }, { t: 2, material: 'bell' }, { t: 1.02, material: 'knock' }] })
  assert.equal(twin.warnings.length, 1)
  assert.match(twin.warnings[0]!, /events\[0\] and events\[2\] are the same knock 20 ms apart.*Keep one/)

  const chord = scoreOf({
    durationSeconds: 5,
    events: [
      { t: 1, material: 'bell', pitch: 0 }, { t: 1, material: 'bell', pitch: 4 }, { t: 1, material: 'bell', pitch: 7 },
      { t: 1, material: 'thump' }
    ]
  })
  assert.deepEqual(chord.warnings, [])
  // 40 ms apart is two hits.
  assert.deepEqual(scoreOf({ durationSeconds: 5, events: [{ t: 1, material: 'knock' }, { t: 1.05, material: 'knock' }] }).warnings, [])
})

test('many faults are listed a few at a time, with the rest counted', () => {
  const said = errorsOf({ durationSeconds: 60, events: Array.from({ length: 10 }, (_, i) => ({ t: i, material: 'beep' })) })
  assert.match(said, /…and 4 more of the same kind\./)
})
