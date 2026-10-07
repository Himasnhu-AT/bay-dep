/**
 * A score rendered, and the render listened to with arithmetic. Run with `pnpm test`.
 *
 * What is held here: the same score is the same bytes; there is silence where there are no
 * hits; pan puts a hit where it says; the bus never passes the ceiling however the hits pile
 * up (with the unlimited bus shown clipping the same score, so the limiter is what holds it);
 * and the end of the file is either exactly the film's or the whole ring-out, never a click.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { KNEE, dbToLinear, limitBus, linearToDb, mixScore, panGains, peakOf, renderScore, renderWarnings, soundingSeconds } from './render'
import { roomSeconds } from './room'
import { DEFAULT_ROOM, FIT_FADE_SECONDS, SFX_MATERIAL_NAMES, SFX_SAMPLE_RATE, checkScore, type SfxScore } from './score'
import { voiceSeconds } from './voices'
import { encodeWav } from './wav'

const FS = SFX_SAMPLE_RATE

function score(input: Record<string, unknown>): SfxScore {
  const checked = checkScore(input)
  if (!checked.ok) throw new Error(checked.errors.join('\n'))
  return checked.score
}

const energy = (samples: Float32Array, from = 0, to = samples.length): number => {
  let sum = 0
  for (let i = Math.max(0, from); i < Math.min(samples.length, to); i += 1) sum += samples[i]! ** 2
  return sum
}

const FILM = {
  durationSeconds: 6,
  events: [
    { t: 0.5, material: 'whoosh', gain: 0.6, pan: -0.5 },
    { t: 1.0, material: 'thump', gain: 1 },
    { t: 1.6, material: 'knock', gain: 0.5, pan: 0.3 },
    { t: 2.4, material: 'bell', gain: 0.6, pitch: 0 },
    { t: 2.4, material: 'bell', gain: 0.5, pitch: 7 },
    { t: 3.2, material: 'drop', gain: 0.7, pan: 0.6 }
  ]
}

test('the same score renders the same bytes, twice; another seed renders others', () => {
  const bytes = (input: Record<string, unknown>): Uint8Array => {
    const r = renderScore(score(input))
    return encodeWav(r.left, r.right, r.sampleRate)
  }
  const first = bytes(FILM)
  const second = bytes(structuredClone(FILM))
  assert.equal(first.length, second.length)
  assert.ok(first.every((byte, i) => byte === second[i]), 'byte for byte')
  // The control: the comparison can see a difference, and the seed is what makes one.
  const other = bytes({ ...FILM, seed: 2 })
  assert.equal(other.length, first.length)
  assert.ok(other.some((byte, i) => byte !== first[i]), 'a different seed is a different file')
})

test('an event’s noise does not depend on the events around it', () => {
  // Removing a hit must not change how the others sound: each event has its own stream.
  const withBoth = renderScore(score({ durationSeconds: 4, room: { wet: 0 }, events: [{ t: 0.2, material: 'whoosh' }, { t: 2, material: 'whoosh' }] }))
  const alone = renderScore(score({ durationSeconds: 4, room: { wet: 0 }, events: [{ t: 0.2, material: 'whoosh' }] }))
  const upTo = Math.round(1.5 * FS)
  assert.deepEqual(withBoth.left.slice(0, upTo), alone.left.slice(0, upTo))
})

test('there is silence where there are no events: exact before the first hit, and after the last has died', () => {
  const r = renderScore(score({ durationSeconds: 8, events: [{ t: 2, material: 'knock', gain: 1 }] }))
  const first = Math.round(2 * FS)
  assert.equal(energy(r.left, 0, first) + energy(r.right, 0, first), 0, 'digital silence before the hit')
  assert.ok(Math.abs(r.left[first + 40]!) > 0.01, 'and the hit is where it was put')
  // The hit, the room after it, and then nothing that could be heard: 70 dB under the hit.
  const ended = Math.round((2 + voiceSeconds('knock', 1) + roomSeconds(DEFAULT_ROOM) + 1) * FS)
  const late = Math.sqrt(energy(r.left, ended) / (r.left.length - ended))
  assert.ok(linearToDb(late) < r.peakDb - 70, `${linearToDb(late).toFixed(1)} dB after the tail, against a ${r.peakDb.toFixed(1)} dB peak`)
})

test('an event is placed at its time to the sample', () => {
  for (const t of [0, 0.25, 1.001]) {
    const r = renderScore(score({ durationSeconds: 3, room: { wet: 0 }, events: [{ t, material: 'bell' }] }))
    let first = 0
    while (first < r.left.length && r.left[first] === 0) first += 1
    // The bell's own first sample is zero (it rises from rest), so sound starts one later.
    assert.ok(Math.abs(first - Math.round(t * FS)) <= 1, `t ${t}: first sound at sample ${first}`)
  }
})

test('pan puts a hit in the channel it names, with the other as its control', () => {
  const sides = (pan: number): { left: number; right: number } => {
    const r = renderScore(score({ durationSeconds: 2, room: { wet: 0 }, events: [{ t: 0.1, material: 'knock', pan, send: 0 }] }))
    return { left: energy(r.left), right: energy(r.right) }
  }
  const hardLeft = sides(-1)
  assert.ok(hardLeft.left > 0)
  assert.equal(hardLeft.right, 0, 'hard left leaves the right channel silent')
  const hardRight = sides(1)
  assert.ok(hardRight.right > 0)
  assert.ok(hardRight.left < hardRight.right * 1e-12, 'hard right leaves the left channel silent')
  const centre = sides(0)
  assert.ok(Math.abs(centre.left / centre.right - 1) < 1e-6, 'centre is equal in both')
  const partLeft = sides(-0.5)
  assert.ok(partLeft.left > partLeft.right * 2 && partLeft.right > 0, 'half left is mostly, not wholly, left')
  const partRight = sides(0.5)
  assert.ok(Math.abs(partRight.right / partLeft.left - 1) < 1e-6, 'and mirrors half right')
})

test('pan is constant power: the hit is as loud wherever it sits', () => {
  for (const pan of [-1, -0.6, -0.2, 0, 0.3, 0.8, 1]) {
    const { left, right } = panGains(pan)
    assert.ok(Math.abs(left ** 2 + right ** 2 - 1) < 1e-12, `pan ${pan}`)
  }
  assert.deepEqual(panGains(-1), { left: 1, right: 0 })
  assert.ok(Math.abs(panGains(0).left - Math.SQRT1_2) < 1e-12)
})

/** Every material at once, as loud as each goes, with a chord on top: the worst a score can do. */
const PILE = {
  durationSeconds: 4,
  events: [
    ...SFX_MATERIAL_NAMES.map((material) => ({ t: 1, material, gain: 1 })),
    { t: 1, material: 'bell', gain: 1, pitch: 4 },
    { t: 1, material: 'bell', gain: 1, pitch: 7 },
    { t: 1, material: 'thump', gain: 1, pitch: 5 }
  ]
}

test('the bus never passes the ceiling, however the hits pile up — and without the limiter the same score does', () => {
  for (const ceilingDb of [-8, -3, -14]) {
    const piled = score({ ...PILE, ceilingDb })
    const ceiling = dbToLinear(ceilingDb)
    // The positive control: this score really is over the ceiling before the limiter.
    const unlimited = peakOf(mixScore(piled))
    assert.ok(unlimited > ceiling * 1.5, `ceiling ${ceilingDb}: the unlimited bus peaks at ${linearToDb(unlimited).toFixed(1)} dBFS`)
    const r = renderScore(piled)
    assert.ok(peakOf(r) <= ceiling, `ceiling ${ceilingDb}: rendered peak ${r.peakDb.toFixed(2)} dBFS`)
    assert.ok(r.peakDb <= ceilingDb)
    assert.ok(r.peakDb > ceilingDb - 2, 'and it is held near the ceiling, not thrown away')
    assert.ok(r.limitedDb > 3, `the limiter says how much it did: ${r.limitedDb.toFixed(1)} dB`)
  }
  // At the default ceiling the unlimited pile is past full scale: it would clip in a file.
  assert.ok(peakOf(mixScore(score(PILE))) > 1)
})

test('the ceiling holds to the last 32-bit float: a pile that rounds up to it is still not over', () => {
  // Found by a mutant, not by thought: with no pre-delay the room's first return lands on the
  // pile, tanh saturates, and the nearest float to "just under the ceiling" is 5e-10 over it.
  const specimen = score({ ...PILE, room: { preDelayMs: 0 } })
  const ceiling = dbToLinear(specimen.ceilingDb)
  assert.ok(Math.fround(ceiling) > ceiling, 'the specimen’s ceiling is one a 32-bit float rounds up past')
  const r = renderScore(specimen)
  assert.ok(peakOf(r) <= ceiling, `over by ${peakOf(r) - ceiling}`)
  assert.ok(ceiling - peakOf(r) < 1e-7, 'and it is the very next float down, not a margin')
})

test('one hit is not limited: a centred hit at gain 1 sits at the knee, and the limiter reports 0', () => {
  for (const material of SFX_MATERIAL_NAMES) {
    const r = renderScore(score({ durationSeconds: 4, room: { wet: 0 }, events: [{ t: 0.5, material, gain: 1 }] }))
    assert.equal(r.limitedDb, 0, material)
    assert.ok(Math.abs(r.peakDb - (-8 + linearToDb(KNEE))) < 0.01, `${material} peaks at ${r.peakDb.toFixed(2)} dBFS`)
  }
})

test('the limiter leaves what is under the knee alone and keeps the stereo image of what is over it', () => {
  const bus = { left: new Float32Array([0.1, 0.5, -0.9, 0.2]), right: new Float32Array([0.05, 0.25, 0.3, -0.2]) }
  const reduced = limitBus(bus, 0.4)
  assert.ok(Math.abs(bus.left[0]! - 0.1) < 1e-7 && Math.abs(bus.right[0]! - 0.05) < 1e-7, 'under the knee: untouched')
  assert.ok(Math.abs(bus.left[3]! - 0.2) < 1e-7 && Math.abs(bus.right[3]! + 0.2) < 1e-7)
  assert.ok(Math.abs(bus.left[1]!) < 0.4 && Math.abs(bus.left[2]!) < 0.4, 'over it: under the ceiling')
  assert.ok(Math.abs(bus.left[1]! / bus.right[1]! - 2) < 1e-5, 'one gain for both channels')
  assert.ok(Math.abs(bus.left[2]! / bus.right[2]! + 3) < 1e-5)
  assert.ok(reduced > 6, `0.9 under a 0.4 ceiling is turned down ${reduced.toFixed(1)} dB`)
})

test('gain is level: half the gain is 6 dB down, and gain 0 is silence that is not counted as a hit', () => {
  const peak = (gain: number): number =>
    renderScore(score({ durationSeconds: 2, room: { wet: 0 }, events: [{ t: 0.1, material: 'drop', gain }] })).peakDb
  assert.ok(Math.abs(peak(1) - peak(0.5) - 6.02) < 0.01)
  const silent = renderScore(score({ durationSeconds: 2, events: [{ t: 0.1, material: 'drop', gain: 0 }] }))
  assert.equal(silent.peakDb, Number.NEGATIVE_INFINITY)
  assert.equal(silent.events, 0)
})

test('send is how much of a hit the room hears: none leaves no tail, more leaves more', () => {
  const tail = (send: number): number => {
    const r = renderScore(score({ durationSeconds: 3, events: [{ t: 0.1, material: 'knock', send }] }))
    return energy(r.left, Math.round((0.1 + voiceSeconds('knock', 1) + 0.02) * FS))
  }
  assert.equal(tail(0), 0)
  assert.ok(tail(0.2) > 0)
  assert.ok(Math.abs(tail(0.8) / tail(0.2) - 16) < 0.5, 'four times the send is sixteen times the energy')
})

const LATE = { durationSeconds: 3, events: [{ t: 0.5, material: 'knock' }, { t: 2, material: 'bell', gain: 1 }] }

test('tail "fit": the file is exactly the film’s length and ends at rest, and the render says what it faded', () => {
  const r = renderScore(score(LATE))
  assert.equal(r.left.length, 3 * FS)
  assert.equal(r.seconds, 3)
  assert.ok(r.left[r.left.length - 1] === 0 && r.right[r.right.length - 1] === 0, 'the last sample is zero: no click')
  // What the fade took is measured: a bell a second old is well within hearing.
  assert.ok(r.fadedPeakDb > -45 && r.fadedPeakDb < r.peakDb, `the faded tail peaked at ${r.fadedPeakDb.toFixed(1)} dBFS`)
  // The bell is still there before the fade begins, and is falling through it.
  const fade = Math.round(FIT_FADE_SECONDS * FS)
  assert.ok(energy(r.left, r.left.length - fade, r.left.length - fade / 2) > energy(r.left, r.left.length - fade / 2) * 4)
  const warnings = renderWarnings(score(LATE), r)
  assert.equal(warnings.length, 1)
  assert.match(warnings[0]!, /still ringing at durationSeconds \(-\d+ dBFS\) and was faded out.*Move the last hit earlier, or pass tail: "ring"/)
})

test('tail "ring": nothing is cut off — the file runs until the last hit and the room have died away', () => {
  const ring = renderScore(score({ ...LATE, tail: 'ring' }))
  const fit = renderScore(score(LATE))
  assert.equal(ring.left.length, Math.ceil(soundingSeconds(score(LATE)) * FS))
  assert.ok(ring.seconds > 3 + voiceSeconds('bell', 1) - 1, 'the file is longer than the film by the bell and its room')
  assert.equal(ring.fadedPeakDb, Number.NEGATIVE_INFINITY, 'nothing was faded')
  // Up to where the fit render starts to fade, they are the same sound.
  const untilFade = 3 * FS - Math.round(FIT_FADE_SECONDS * FS)
  assert.deepEqual(ring.left.slice(0, untilFade), fit.left.slice(0, untilFade))
  // Past the film's end the bell is still ringing…
  assert.ok(energy(ring.left, 3 * FS, 3 * FS + FS / 2) > 1e-3)
  // …and by the end of the file it has gone: 60 dB under the peak over the last 50 ms.
  const last = Math.sqrt(energy(ring.left, ring.left.length - FS / 20) / (FS / 20))
  assert.ok(linearToDb(last) < ring.peakDb - 60, `the file ends ${(ring.peakDb - linearToDb(last)).toFixed(0)} dB under its peak`)
  assert.deepEqual(renderWarnings(score({ ...LATE, tail: 'ring' }), ring), [], 'nothing was cut, so nothing is warned')
})

test('a score whose sound ends inside it is not faded, extended or warned about, in either mode', () => {
  const early = { durationSeconds: 6, events: [{ t: 0.5, material: 'knock' }, { t: 1, material: 'thump' }] }
  const fit = renderScore(score(early))
  const ring = renderScore(score({ ...early, tail: 'ring' }))
  assert.equal(fit.fadedPeakDb, Number.NEGATIVE_INFINITY)
  assert.equal(fit.left.length, 6 * FS)
  assert.equal(ring.left.length, 6 * FS)
  assert.deepEqual(fit.left, ring.left)
  assert.deepEqual(renderWarnings(score(early), fit), [])
})

test('a decay that is past hearing when the film ends is faded without a word; one that is not, is named', () => {
  // A bell three seconds old has 70 dB less to say. Every score ends on something like it,
  // and a warning each time would teach the reader to ignore the one that matters.
  const quiet = score({ durationSeconds: 6, events: [{ t: 3, material: 'bell', gain: 0.6 }] })
  const r = renderScore(quiet)
  assert.ok(soundingSeconds(quiet) > 6, 'the specimen does, on paper, ring past the end')
  assert.ok(r.fadedPeakDb < -8 - 40 && r.fadedPeakDb > Number.NEGATIVE_INFINITY, `faded ${r.fadedPeakDb.toFixed(1)} dBFS`)
  assert.deepEqual(renderWarnings(quiet, r), [])
  assert.ok(r.left[r.left.length - 1] === 0, 'it is still closed to zero')
  // The control: the same bell half a second before the end is heard being cut.
  const loud = score({ durationSeconds: 6, events: [{ t: 5.5, material: 'bell', gain: 0.6 }] })
  assert.equal(renderWarnings(loud, renderScore(loud)).length, 1)
})

test('a pile-up is warned about with how far the limiter turned it down; a single hit is not', () => {
  const piled = score(PILE)
  const said = renderWarnings(piled, renderScore(piled))
  assert.ok(said.some((w) => /limiter turned the loudest moment down by \d+\.\d dB.*Lower their gains or move one/.test(w)), said.join('\n'))
  const single = score({ durationSeconds: 4, events: [{ t: 0.5, material: 'thump', gain: 1 }] })
  assert.deepEqual(renderWarnings(single, renderScore(single)), [])
})

test('a whole film’s score sits under the ceiling with its hits intact, and reports what it rendered', () => {
  const r = renderScore(score(FILM))
  assert.equal(r.events, FILM.events.length)
  assert.equal(r.sampleRate, 48_000)
  assert.ok(r.peakDb <= -8 && r.peakDb > -14, `peak ${r.peakDb.toFixed(2)} dBFS`)
  assert.ok(r.limitedDb < 1, `a score with rests barely touches the limiter: ${r.limitedDb.toFixed(2)} dB`)
  for (const sample of r.left) assert.ok(Number.isFinite(sample))
})
