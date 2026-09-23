/**
 * Beat analysis against signals whose answer is known because they are built here: click tracks
 * and a small drum groove at stated tempos, with the beat times written down as they are made.
 *
 * The tolerances are the ones an editor works to: tempo within ±1 BPM, and every beat within one
 * frame at 30 fps (33 ms) of the click that made it. A beat a frame late is a cut a frame late.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { analyzeBeats, ANALYSIS_SAMPLE_RATE as SR, type BeatAnalysis } from './beat-analysis'

const FRAME = 1 / 30

/** Deterministic noise, so a failure reproduces. */
function noise(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 31 - 1
  }
}

function silence(seconds: number): Float32Array {
  return new Float32Array(Math.round(seconds * SR))
}

/** A short decaying tone burst — a metronome click. */
function click(x: Float32Array, t: number, amp: number, freq: number): void {
  const s = Math.round(t * SR)
  for (let i = 0; i < 0.03 * SR && s + i < x.length; i += 1) {
    x[s + i]! += amp * Math.sin((2 * Math.PI * freq * i) / SR) * Math.exp(-i / (0.005 * SR))
  }
}

function kick(x: Float32Array, t: number): void {
  const s = Math.round(t * SR)
  let phase = 0
  for (let i = 0; i < 0.15 * SR && s + i < x.length; i += 1) {
    phase += (2 * Math.PI * (50 + 70 * Math.exp(-i / (0.02 * SR)))) / SR
    x[s + i]! += 0.9 * Math.sin(phase) * Math.exp(-i / (0.04 * SR))
  }
}

function burst(x: Float32Array, t: number, amp: number, decay: number, rand: () => number, bright: boolean): void {
  const s = Math.round(t * SR)
  let last = 0
  for (let i = 0; i < decay * 6 * SR && s + i < x.length; i += 1) {
    const r = rand()
    // A first difference tilts white noise towards the top: a hat rather than a snare.
    const v = bright ? r - last : r
    last = r
    x[s + i]! += amp * v * Math.exp(-i / (decay * SR))
  }
}

interface ClickTrack {
  samples: Float32Array
  beats: number[]
  accents: number[]
}

function clickTrack(bpm: number, seconds: number, options: { accent?: boolean } = {}): ClickTrack {
  const x = silence(seconds)
  const period = 60 / bpm
  const beats: number[] = []
  const accents: number[] = []
  for (let i = 0, t = 0.5; t < seconds - 0.2; i += 1, t += period) {
    beats.push(t)
    if (options.accent && i % 4 === 0) {
      accents.push(t)
      click(x, t, 0.9, 120)
    } else {
      click(x, t, 0.5, 1000)
    }
  }
  return { samples: x, beats, accents }
}

/**
 * Kick on 1 and 3, snare on 2 and 4, hats on every eighth, over a sustained pad. `mute` removes
 * everything but the pad inside a window; `silent` removes the pad too.
 */
function groove(
  bpm: number,
  seconds: number,
  options: { mute?: [number, number]; silent?: [number, number]; swing?: number; strayHit?: number } = {}
): { samples: Float32Array; beats: number[] } {
  const x = silence(seconds)
  const rand = noise(7)
  const period = 60 / bpm
  const beats: number[] = []
  const inside = (t: number, w?: [number, number]): boolean => w !== undefined && t >= w[0] && t < w[1]
  for (let i = 0, t = 0.5; t < seconds - 0.2; i += 1, t += period) {
    beats.push(t)
    if (inside(t, options.mute) || inside(t, options.silent)) continue
    if (i % 2 === 0) kick(x, t)
    else burst(x, t, 0.5, 0.04, rand, false)
    burst(x, t, 0.15, 0.01, rand, true)
    // The off-beat hat: straight eighths at half a beat, swung ones later (2/3 is triplet swing).
    const off = t + period * (options.swing ?? 0.5)
    if (!inside(off, options.mute) && !inside(off, options.silent)) burst(x, off, 0.15, 0.01, rand, true)
  }
  // One snare hit on its own, inside a muted stretch: a fill, not the drums coming back.
  if (options.strayHit !== undefined) burst(x, options.strayHit, 0.5, 0.04, rand, false)
  for (let i = 0; i < x.length; i += 1) {
    if (inside(i / SR, options.silent)) continue
    x[i]! += 0.05 * Math.sin((2 * Math.PI * 220 * i) / SR)
  }
  return { samples: x, beats }
}

/** Every detected beat within a frame of a real one, and every real beat found. */
function assertOnTheBeats(result: BeatAnalysis, beats: number[], label: string): void {
  const nearest = (t: number, list: number[]): number => Math.min(...list.map((b) => Math.abs(b - t)))
  for (const b of result.beats) {
    assert.ok(nearest(b, beats) <= FRAME, `${label}: detected beat ${b}s is ${(nearest(b, beats) * 1000).toFixed(1)} ms from any click`)
  }
  for (const b of beats) {
    assert.ok(nearest(b, result.beats) <= FRAME, `${label}: the click at ${b.toFixed(3)}s has no beat within a frame`)
  }
}

for (const bpm of [90, 120, 174]) {
  test(`click track at ${bpm} BPM: tempo within 1 BPM, every beat within a frame`, () => {
    const track = clickTrack(bpm, 30)
    const result = analyzeBeats(track.samples, SR)
    assert.ok(Math.abs(result.bpm - bpm) <= 1, `expected ${bpm} BPM, got ${result.bpm}`)
    assertOnTheBeats(result, track.beats, `${bpm} BPM`)
  })
}

test('an off-grid tempo (137.3 BPM) is measured, not rounded to a whole analysis frame', () => {
  // At 86 analysis frames a second a whole-frame lag is ~2 BPM apart here; the answer has to
  // come from the beats, not the lag.
  const track = clickTrack(137.3, 30)
  const result = analyzeBeats(track.samples, SR)
  assert.ok(Math.abs(result.bpm - 137.3) <= 0.5, `got ${result.bpm}`)
  assertOnTheBeats(result, track.beats, '137.3 BPM')
})

for (const bpm of [96, 132]) {
  test(`swung eighths at ${bpm} BPM: the beat is the quarter note, and the swung hat is not a beat`, () => {
    // Swing as it is played: kick and snare on the beats, the hat on the beat and late in it.
    // (A bare click track whose swung click is a click like the others is ambiguous to any
    // onset tracker — every click is equally strong after log compression — and this one can
    // lock onto the swung clicks there. Measured, and left as the documented limit.)
    const swung = groove(bpm, 30, { swing: 2 / 3 })
    const result = analyzeBeats(swung.samples, SR)
    assert.ok(Math.abs(result.bpm - bpm) <= 1, `expected ${bpm} BPM, got ${result.bpm}`)
    assertOnTheBeats(result, swung.beats, `swing ${bpm}`)
  })
}

test('octave: an accented 174 stays at 174, and a groove with eighth hats stays at the quarter note', () => {
  // The pair is the point. A rule that always halves passes the second and fails the first; one
  // that always doubles does the reverse.
  const fast = analyzeBeats(clickTrack(174, 30, { accent: true }).samples, SR)
  assert.ok(Math.abs(fast.bpm - 174) <= 1, `accented 174 came back as ${fast.bpm}`)
  const hats = groove(90, 30)
  const slow = analyzeBeats(hats.samples, SR)
  assert.ok(Math.abs(slow.bpm - 90) <= 1, `90 BPM with eighth hats came back as ${slow.bpm}`)
  assertOnTheBeats(slow, hats.beats, 'groove 90')
})

test('downbeats: found on the accented beat, and not invented when every beat is the same', () => {
  const accented = clickTrack(128, 30, { accent: true })
  const found = analyzeBeats(accented.samples, SR)
  assert.ok(found.downbeats.length > 0, 'an accented bar produced no downbeats')
  for (const d of found.downbeats) {
    assert.ok(accented.accents.some((a) => Math.abs(a - d) <= FRAME), `downbeat ${d}s is not on an accented click`)
  }
  assert.ok(found.downbeats.length >= accented.accents.length - 1, `${found.downbeats.length} downbeats for ${accented.accents.length} bars`)

  const flat = analyzeBeats(clickTrack(128, 30).samples, SR)
  assert.ok(flat.beats.length > 50, 'the flat track must still have beats, or the empty downbeats prove nothing')
  assert.deepEqual(flat.downbeats, [], 'no position in the bar is accented, so there is no downbeat to report')
  // Between two clicks is digital silence, and it is the music, not a drop-out in it.
  assert.deepEqual(flat.dropouts, [])
})

test('drop-out: the drums stopping for two seconds is found, starting on the first missing beat', () => {
  // Drums out for [10, 12) at 120 BPM: beats 10.0, 10.5, 11.0, 11.5 are missing, 12.0 returns.
  const dropped = groove(120, 20, { mute: [10, 12] })
  const result = analyzeBeats(dropped.samples, SR)
  const drops = result.dropouts.filter((d) => d.kind === 'percussion')
  assert.equal(drops.length, 1, `expected one percussion drop-out, got ${JSON.stringify(result.dropouts)}`)
  assert.ok(Math.abs(drops[0]!.start - 10) <= FRAME, `drop starts at ${drops[0]!.start}, expected 10.0`)
  assert.ok(Math.abs(drops[0]!.end - 12) <= FRAME, `drop ends at ${drops[0]!.end}, expected 12.0`)
  // The pad played through it, so it is not silence.
  assert.deepEqual(result.dropouts.filter((d) => d.kind === 'silence'), [])
  // The beat grid carries on through the gap: a cut can land on a beat nobody played.
  assert.ok(result.beats.some((b) => Math.abs(b - 11) <= FRAME), 'no beat at 11.0 inside the drop')

  const steady = analyzeBeats(groove(120, 20).samples, SR)
  assert.deepEqual(steady.dropouts, [], 'the same groove without the gap must report no drop-out')
})

test('drop-out: a silence inside the music is reported as silence, with its edges', () => {
  const silent = groove(120, 20, { silent: [10, 11.5] })
  const result = analyzeBeats(silent.samples, SR)
  const quiet = result.dropouts.filter((d) => d.kind === 'silence')
  assert.equal(quiet.length, 1, `expected one silence, got ${JSON.stringify(result.dropouts)}`)
  // The last hit before it decays for ~0.15 s; the smoothing is ±0.05 s. Two frames covers both.
  assert.ok(quiet[0]!.start >= 10 - FRAME && quiet[0]!.start <= 10 + 0.25, `silence starts at ${quiet[0]!.start}`)
  assert.ok(Math.abs(quiet[0]!.end - 11.5) <= 2 * FRAME, `silence ends at ${quiet[0]!.end}, expected 11.5`)
  assert.ok(result.dropouts.some((d) => d.kind === 'percussion'), 'the drums stopped too')
})

test('silence and noise have no tempo to report', () => {
  const quiet = analyzeBeats(silence(10), SR)
  assert.deepEqual(quiet.beats, [])
  assert.equal(quiet.bpm, 0)
  const rand = noise(3)
  const hiss = new Float32Array(10 * SR).map(() => 0.1 * rand())
  const result = analyzeBeats(hiss, SR)
  assert.ok(result.confidence < 0.3, `white noise reported confidence ${result.confidence}`)
})

test('octave: a heavy accent does not halve the tempo, because midpoints are measured against the weaker beat', () => {
  // A loud, broadband hit on beat 1 over quiet clicks: on the half-tempo grid the beats
  // alternate loud and quiet, and against their *mean* the quiet midpoints look weak.
  const x = silence(30)
  const rand = noise(11)
  const period = 60 / 174
  const beats: number[] = []
  for (let i = 0, t = 0.5; t < 29.8; i += 1, t += period) {
    beats.push(t)
    if (i % 4 === 0) {
      kick(x, t)
      burst(x, t, 1, 0.05, rand, false)
    } else {
      click(x, t, 0.15, 1000)
    }
  }
  const result = analyzeBeats(x, SR)
  assert.ok(Math.abs(result.bpm - 174) <= 1, `heavily accented 174 came back as ${result.bpm}`)
})

test('octave: eighths as hard as the beat with no kick stay under 180; a 200 BPM click with low end is 200', () => {
  // The measured score's shape: every eighth played, off-beats as hard as beats, no kick.
  // Nothing in the onsets says 110 over 220, so the rule decides — and says so in its test.
  const x = silence(30)
  const rand = noise(5)
  // 100 rather than the score's 110: doubled, 110 is past the 215 search ceiling and the rule
  // is never asked; doubled, 100 is 200 — inside the range, which is where the rule decides.
  const period = 60 / 100
  const beats: number[] = []
  for (let t = 0.5; t < 29.8; t += period) {
    beats.push(t)
    burst(x, t, 0.5, 0.03, rand, true)
    burst(x, t + period / 2, 0.5, 0.03, rand, true)
  }
  const eighths = analyzeBeats(x, SR)
  assert.ok(Math.abs(eighths.bpm - 100) <= 1, `a kickless eighth-note groove came back as ${eighths.bpm}`)
  // Its pair: above 180 is reachable when the kick band agrees.
  const fast = analyzeBeats(clickTrack(200, 30).samples, SR)
  assert.ok(Math.abs(fast.bpm - 200) <= 1, `a 200 BPM click track came back as ${fast.bpm}`)
})

test('drop-out: one stray hit inside the gap is a fill, not the drums coming back', () => {
  const dropped = groove(120, 20, { mute: [10, 12], strayHit: 11 })
  const drops = analyzeBeats(dropped.samples, SR).dropouts.filter((d) => d.kind === 'percussion')
  assert.equal(drops.length, 1, JSON.stringify(drops))
  assert.ok(Math.abs(drops[0]!.start - 10) <= FRAME && Math.abs(drops[0]!.end - 12) <= FRAME, JSON.stringify(drops))
})

test('silence shorter than a beat between hits is the music, not a drop-out', () => {
  // Clicks with a quieter swung click: the gaps are digital silence a little over a quarter of
  // a second long, inside a signal whose median level is not silence. (This track's beat phase
  // is the documented ambiguity above and is not asserted here.)
  const x = silence(20)
  const period = 60 / 96
  for (let t = 0.5; t < 19.8; t += period) {
    click(x, t, 0.5, 1000)
    click(x, t + (period * 2) / 3, 0.2, 3000)
  }
  const result = analyzeBeats(x, SR)
  assert.deepEqual(result.dropouts.filter((d) => d.kind === 'silence'), [])
})
