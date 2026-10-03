/**
 * The film oracle, against films built here to be exactly one thing wrong.
 *
 * Every refusal is a single change to `good()` — a film that passes every leg — so each failing
 * film sits beside the passing one it differs from by that change alone. A leg that failed
 * everything would fail `good()` too, and the first test would say so.
 *
 * What is held still is the behaviour: which boundary is carried and by which id, which leg
 * fails and that its sentence carries the number and the fix. The thresholds are imported, not
 * retyped — except where a threshold is the claim (0.5 and 0.7 for the carry score, 80 px/frame),
 * which are spelled out so that moving the constant fails here.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  ANCHOR_AREA_SHARE,
  BLIND,
  CARRY_AFTER_SECONDS,
  CARRY_FAIL_BELOW,
  CARRY_WARN_BELOW,
  ENERGY_STEP_SECONDS,
  FAST_PX_PER_FRAME_AT_1080P,
  FILM_CONTRACT,
  MAX_PICTURES,
  MAX_TRACK_SAMPLES,
  checkFilm,
  planFilm,
  readFilmMeta,
  type DeclaredFilm,
  type FilmBox,
  type FilmMeta,
  type FilmSamples,
  type RawTrackSample
} from './film-oracle'

const W = 1920
const H = 1080
const DURATION = 12
/** Beat lengths 1, 4, 2.5, 4.5: varied enough that only the test's own change can fail rhythm. */
const BEATS = [0, 1, 5, 7.5]

type Boxes = Record<string, Partial<FilmBox> & { x: number; y: number; w: number; h: number }>
type Track = (t: number) => Boxes

const clamp01 = (u: number): number => Math.min(1, Math.max(0, u))
const EASES = [(u: number) => 1 - (1 - u) ** 3, (u: number) => u, (u: number) => u * u * (3 - 2 * u)]

/** Which beat `t` is in. */
const beatAt = (t: number, beats = BEATS): number => beats.filter((beat) => beat <= t + 1e-9).length - 1

/** One card per beat, each a different id, replacing the last at the boundary: the slideshow. */
const cards: Track = (t) => ({ [`card${beatAt(t)}`]: { x: 500, y: 300, w: 900, h: 500 } })

/** A hero that crosses every boundary, travelling 300 px through it on a different curve each time. */
const hero: Track = (t) => {
  let x = 100
  BEATS.slice(1).forEach((beat, index) => {
    x += 300 * EASES[index % EASES.length]!(clamp01((t - (beat - 0.1)) / 0.4))
  })
  return { hero: { x, y: 60, w: 200, h: 200 } }
}

const both = (...tracks: Track[]): Track => (t) => Object.assign({}, ...tracks.map((track) => track(t)))

/** Picture energy that moves through each boundary and is dead still everywhere else. */
const calm = (t: number): number => (BEATS.slice(1).some((beat) => t >= beat - 0.15 && t <= beat + 0.35) ? 6 : 0)

interface Build {
  track?: Track
  energy?: ((t: number) => number | null) | null
  fps?: number
  trackRate?: number
  duration?: number
  /** Replace a sample: a throw, a wrong shape. */
  spoil?: (sample: RawTrackSample) => RawTrackSample
  purity?: FilmSamples['purity']
}

const raw = (t: number, track: Track): RawTrackSample => ({
  t,
  boxes: Object.fromEntries(Object.entries(track(t)).map(([id, b]) => [id, [b.x, b.y, b.w, b.h, b.op ?? 1]]))
})

function film(build: Build = {}): FilmSamples {
  const track = build.track ?? both(cards, hero)
  const fps = build.fps ?? 30
  const rate = build.trackRate ?? fps
  const duration = build.duration ?? DURATION
  const count = Math.floor(duration * rate + 1e-6) + 1
  const samples = Array.from({ length: count }, (_, k) => raw(k / rate, track)).map(build.spoil ?? ((s) => s))
  const energy = build.energy === null ? null : (build.energy ?? calm)
  const steps = Math.floor(duration / ENERGY_STEP_SECONDS + 1e-6)
  return {
    width: W,
    height: H,
    fps,
    durationSeconds: duration,
    trackRate: rate,
    track: samples,
    energy: energy ? { step: ENERGY_STEP_SECONDS, values: Array.from({ length: steps }, (_, i) => energy((i + 0.5) * ENERGY_STEP_SECONDS)) } : null,
    ...(energy ? {} : { energyMissing: 'check_film was called with pictures: false' }),
    purity: build.purity ?? [
      { t: 4, via: 10, first: raw(4, track), again: raw(4, track), pictureDelta: 0 },
      { t: 8, via: 1, first: raw(8, track), again: raw(8, track), pictureDelta: 0 }
    ]
  }
}

const meta = (extra: Partial<FilmMeta> = {}): FilmMeta => ({ beats: BEATS, cuts: [], inFrame: {}, blur: false, ...extra })
const good = (): ReturnType<typeof checkFilm> => checkFilm(meta(), film())
const sentence = (report: ReturnType<typeof checkFilm>, leg: string): string =>
  report.findings
    .filter((finding) => finding.leg === leg)
    .map((finding) => finding.sentence)
    .join('\n')

test('a move that ends on the beat and then sits still is the last beat\'s move, not a carry into the next', () => {
  const beats = [0, 2, 6, 9]
  // The same 300 px, on the same curve, over the same 0.4 s — only where it sits against the boundary differs.
  const mover = (endsAfterBoundary: number): Track => (t) => {
    let x = 100
    beats.slice(1).forEach((beat) => {
      x += 300 * EASES[1]!(clamp01((t - (beat + endsAfterBoundary - 0.4)) / 0.4))
    })
    // Big enough to anchor (over 3 % of the frame), so "survives unmoved" has a verdict of its own.
    return { hero: { x, y: 60, w: 400, h: 400 } }
  }
  const verdicts = (track: Track): string[] =>
    checkFilm(meta({ beats }), film({ track, energy: () => 0 })).legs.continuity.boundaries.map((b) => `${b.verdict}:${b.by[0]}`)

  // Specimen: before the boundary the move is whole and inside the old window (it opens 0.25 s before).
  const ending = mover(0)
  assert.equal(ending(2).hero!.x - ending(1.75).hero!.x >= 150, true, 'specimen: most of the travel is in the 0.25 s before the boundary')
  assert.ok(Math.abs(ending(2.5).hero!.x - ending(2).hero!.x) < 1e-6, 'specimen: nothing moves after the boundary')
  assert.deepEqual(verdicts(ending), ['anchored:hero', 'anchored:hero', 'anchored:hero'])

  // The nearest legal film: the same move straddling the boundary is a carry, counted for the part after it.
  assert.deepEqual(verdicts(mover(0.2)), ['carried:hero', 'carried:hero', 'carried:hero'])
  // …and so is one that starts on the beat.
  assert.deepEqual(verdicts(mover(0.4)), ['carried:hero', 'carried:hero', 'carried:hero'])
})

// ---------------------------------------------------------------------------
// The passing film every refusal below is one change away from
// ---------------------------------------------------------------------------

test('a film whose hero crosses every boundary passes every leg, and says what it could not see', () => {
  const report = good()
  assert.deepEqual(report.findings, [])
  assert.equal(report.verdict, 'pass')
  assert.deepEqual(
    Object.fromEntries(Object.entries(report.legs).map(([leg, value]) => [leg, value.status])),
    // Framing is unmeasured, not passed: this film names nothing in inFrame.
    { faults: 'pass', continuity: 'pass', curves: 'pass', rhythm: 'pass', framing: 'unmeasured' }
  )
  assert.equal(report.legs.continuity.score, 1)
  assert.deepEqual(
    report.legs.continuity.boundaries.map((b) => [b.seconds, b.verdict, b.by[0], b.exempt]),
    [
      [1, 'carried', 'hero', null],
      [5, 'carried', 'hero', null],
      [7.5, 'carried', 'hero', null]
    ]
  )
  assert.match(report.summary, /^PASS: carry 1\.00 over 3 boundaries/)
  assert.equal(report.blind, BLIND)
  assert.ok(report.blind.length >= 4)
})

// ---------------------------------------------------------------------------
// Continuity
// ---------------------------------------------------------------------------

test('a slideshow — the same cards with nothing crossing a boundary — scores 0 and fails, naming each boundary', () => {
  const report = checkFilm(meta(), film({ track: cards }))
  assert.equal(report.verdict, 'fail')
  assert.equal(report.legs.continuity.status, 'fail')
  assert.equal(report.legs.continuity.score, 0)
  assert.deepEqual(report.legs.continuity.boundaries.map((b) => b.verdict), ['bare', 'bare', 'bare'])
  // Only continuity: the cards are the passing film's cards, and the beats are its beats.
  assert.deepEqual([...new Set(report.findings.map((f) => f.leg))], ['continuity'])
  const said = sentence(report, 'continuity')
  assert.match(said, /Carry score 0\.00 over 3 boundaries \(0 carried, 0 anchored, 3 bare\)/)
  assert.match(said, /slides/)
  assert.match(said, /Bare at 1 s, 5 s, 7\.5 s/)
  // The recovery: how far a survivor has to go, in this frame's pixels, and the way out for a real cut.
  assert.match(said, /move it at least 44 px or scale it 10 %/)
  assert.match(said, /__film\.cuts/)
  assert.match(report.legs.continuity.boundaries[0]!.detail, /card0 is replaced by card1/)
  assert.match(report.summary, /^FAIL: continuity\./)
})

test('the carry score fails under 0.5 and warns under 0.7: 0.40 fails, 0.60 warns, 0.80 passes', () => {
  // Five boundaries, the hero crossing only some of them. Beats 1, 2.5, 4.5, 7.5, 9: lengths vary.
  const beats = [0, 1, 2.5, 4.5, 7.5, 9]
  const scored = (carriedAt: number[], anchoredAt: number[] = []): ReturnType<typeof checkFilm> => {
    const track: Track = (t) => {
      const out: Boxes = { [`card${beatAt(t, beats)}`]: { x: 500, y: 300, w: 900, h: 500 } }
      // A carrier per boundary it carries, alive only around it; an anchor likewise, unmoved.
      for (const beat of carriedAt) {
        if (Math.abs(t - beat) < 0.7) out[`carrier${beat}`] = { x: 100 + 300 * clamp01((t - (beat - 0.1)) / 0.4), y: 60, w: 200, h: 200 }
      }
      for (const beat of anchoredAt) if (Math.abs(t - beat) < 0.7) out[`anchor${beat}`] = { x: 100, y: 700, w: 400, h: 300 }
      return out
    }
    return checkFilm(meta({ beats }), film({ track, energy: (t) => (beats.some((b) => Math.abs(t - b) < 0.3) ? 6 : 0) }))
  }
  assert.equal(CARRY_FAIL_BELOW, 0.5)
  assert.equal(CARRY_WARN_BELOW, 0.7)

  const rejected = scored([1, 2.5])
  assert.equal(rejected.legs.continuity.score, 0.4)
  assert.equal(rejected.legs.continuity.status, 'fail')

  // 2 carried + 2 anchored of 5 is 0.6: passes the bar, and is told it would be better carried.
  const middling = scored([1, 2.5], [4.5, 7.5])
  assert.equal(middling.legs.continuity.score, 0.6)
  assert.equal(middling.legs.continuity.status, 'warn')
  assert.match(sentence(middling, 'continuity'), /Carry score 0\.60 .* passes, under 0\.7/)

  const accepted = scored([1, 2.5, 4.5, 7.5])
  assert.equal(accepted.legs.continuity.score, 0.8)
  assert.equal(accepted.legs.continuity.status, 'pass')
})

test('a survivor that does not move anchors a boundary for half a point; a small one does not', () => {
  const still = (w: number, h: number): Track => both(cards, () => ({ logo: { x: 100, y: 60, w, h } }))

  const large = checkFilm(meta(), film({ track: still(400, 300) }))
  assert.ok((400 * 300) / (W * H) >= ANCHOR_AREA_SHARE, 'specimen: the logo is large enough to anchor')
  assert.deepEqual(large.legs.continuity.boundaries.map((b) => [b.verdict, b.by[0]]), [
    ['anchored', 'logo'],
    ['anchored', 'logo'],
    ['anchored', 'logo']
  ])
  assert.equal(large.legs.continuity.score, 0.5)
  // Exactly at the bar: not a failure, and not a pass.
  assert.equal(large.legs.continuity.status, 'warn')
  assert.match(large.legs.continuity.boundaries[0]!.detail, /logo survives but does not move/)

  const small = checkFilm(meta(), film({ track: still(50, 50) }))
  assert.ok((50 * 50) / (W * H) < ANCHOR_AREA_SHARE, 'specimen: this logo is too small to anchor')
  assert.deepEqual(small.legs.continuity.boundaries.map((b) => b.verdict), ['bare', 'bare', 'bare'])
  assert.equal(small.legs.continuity.status, 'fail')
  assert.match(small.legs.continuity.boundaries[0]!.detail, /logo survives, but unmoved and small \(0\.1 % of the frame/)
})

test('a carry is a move of 2 % of the diagonal or a 10 % scale — just under either is anchored', () => {
  const diagonal = Math.hypot(W, H)
  // Each move starts on its beat: only travel from the boundary on counts, so this is the threshold itself.
  const across = (dx: number, grow: number): Track =>
    both(cards, (t) => {
      const u = BEATS.slice(1).reduce((sum, beat) => sum + clamp01((t - beat) / 0.4), 0)
      return { hero: { x: 100 + dx * u, y: 60, w: 400 * (1 + grow) ** u, h: 300 * (1 + grow) ** u } }
    })
  const verdicts = (dx: number, grow: number): string[] =>
    checkFilm(meta(), film({ track: across(dx, grow) })).legs.continuity.boundaries.map((b) => b.verdict)

  assert.deepEqual(verdicts(0.021 * diagonal, 0), ['carried', 'carried', 'carried'])
  assert.deepEqual(verdicts(0.019 * diagonal, 0), ['anchored', 'anchored', 'anchored'])
  // Scaling about its corner moves the centre too, so the scale is tested alone by keeping the centre.
  const scaled = (grow: number): Track =>
    both(cards, (t) => {
      const u = BEATS.slice(1).reduce((sum, beat) => sum + clamp01((t - beat) / 0.4), 0)
      const s = (1 + grow) ** u
      return { hero: { x: 400 - 200 * s, y: 400 - 150 * s, w: 400 * s, h: 300 * s } }
    })
  const byScale = (grow: number): ReturnType<typeof checkFilm> => checkFilm(meta(), film({ track: scaled(grow) }))
  assert.deepEqual(byScale(0.11).legs.continuity.boundaries.map((b) => b.verdict), ['carried', 'carried', 'carried'])
  assert.match(byScale(0.11).legs.continuity.boundaries[0]!.detail, /hero survives and scales 11 % across it/)
  assert.deepEqual(byScale(0.09).legs.continuity.boundaries.map((b) => b.verdict), ['anchored', 'anchored', 'anchored'])
})

test('blind spot, pinned: a carry built from two ids reads as bare, and one id doing the same reads as carried', () => {
  // The card shrinks into the corner as the page grows out of the same spot.
  const morph = (t: number): { x: number; y: number; w: number; h: number } => {
    const u = clamp01((t - 0.9) / 0.4)
    return { x: 500 - 400 * u, y: 300 - 200 * u, w: 900 + 800 * u, h: 500 + 400 * u }
  }
  const beats = [0, 1, 5]
  const two: Track = (t) => ({ [t < 1 ? 'card' : 'page']: morph(t) })
  const one: Track = (t) => ({ card: morph(t) })
  const split = checkFilm(meta({ beats }), film({ track: two }))
  const single = checkFilm(meta({ beats }), film({ track: one }))
  assert.equal(split.legs.continuity.boundaries[0]!.verdict, 'bare')
  assert.equal(single.legs.continuity.boundaries[0]!.verdict, 'carried')
  assert.ok(BLIND.some((line) => /two elements/.test(line)), 'the report must say so')
})

test('blind spot, pinned: a replacement slower than the window reads as survival', () => {
  const beats = [0, 1, 5]
  const crossfade = (seconds_: number): Track => (t) => ({
    old: { x: 500, y: 300, w: 900, h: 500, op: 1 - clamp01((t - 1) / seconds_) },
    new: { x: 500, y: 300, w: 900, h: 500, op: clamp01((t - 1) / seconds_) }
  })
  const quick = checkFilm(meta({ beats }), film({ track: crossfade(0.2) }))
  const slow = checkFilm(meta({ beats }), film({ track: crossfade(CARRY_AFTER_SECONDS * 3) }))
  assert.equal(quick.legs.continuity.boundaries[0]!.verdict, 'bare')
  assert.equal(slow.legs.continuity.boundaries[0]!.verdict, 'anchored')
})

test('a boundary with nothing tracked on either side is untracked, counts as lost, and says what to return', () => {
  // The hero exists only in the first and last beats; the middle of the film tracks nothing.
  const none: Boxes = {}
  const track: Track = (t) => (t < 0.7 || t > 8 ? { hero: { x: 100, y: 60, w: 200, h: 200 } } : none)
  const report = checkFilm(meta(), film({ track }))
  const at5 = report.legs.continuity.boundaries.find((b) => b.seconds === 5)!
  assert.equal(at5.verdict, 'untracked')
  assert.match(at5.detail, /reports nothing on screen on either side/)
  assert.match(at5.detail, /Return a box for whatever the viewer is looking at/)
  assert.equal(report.legs.continuity.status, 'fail')
  // The twin: the same boundary in the passing film is judged.
  assert.equal(good().legs.continuity.boundaries.find((b) => b.seconds === 5)!.verdict, 'carried')
})

test('a declared cut is exempt and reported as one; an undeclared bare boundary beside it still counts', () => {
  const report = checkFilm(meta({ cuts: [5] }), film({ track: cards }))
  assert.deepEqual(report.legs.continuity.boundaries.map((b) => [b.seconds, b.verdict, b.exempt]), [
    [1, 'bare', null],
    [5, 'bare', 'cut'],
    [7.5, 'bare', null]
  ])
  assert.equal(report.legs.continuity.considered, 2)
  assert.equal(report.legs.continuity.score, 0)
  assert.match(sentence(report, 'continuity'), /Bare at 1 s, 7\.5 s:/)
})

test('declaring every boundary a cut measures nothing, and that is a warning rather than a pass', () => {
  const report = checkFilm(meta({ cuts: [1, 5, 7.5] }), film({ track: cards }))
  assert.equal(report.legs.continuity.status, 'unmeasured')
  assert.equal(report.legs.continuity.score, null)
  assert.equal(report.verdict, 'warn')
  assert.match(sentence(report, 'continuity'), /all 3 boundaries are exempt \(1 s cut, 5 s cut, 7\.5 s cut\)/)
  assert.match(report.summary, /^WARN \(continuity not measured\)/)
})

test('a bare boundary into the end card, or inside a burst of hits, is exempt; the same boundary carried is not', () => {
  const beats = [0, 3, 3.4, 3.8, 6, 11.2]
  const slides: Track = (t) => ({ [`card${beatAt(t, beats)}`]: { x: 500, y: 300, w: 900, h: 500 } })
  const energy = (t: number): number => (beats.some((b) => Math.abs(t - b) < 0.3) ? 6 : 0)
  const report = checkFilm(meta({ beats }), film({ track: slides, energy }))
  assert.deepEqual(report.legs.continuity.boundaries.map((b) => [b.seconds, b.exempt]), [
    [3, 'burst'],
    [3.4, 'burst'],
    [3.8, 'burst'],
    [6, null],
    [11.2, 'end']
  ])
  assert.equal(report.legs.continuity.considered, 1)
  assert.match(sentence(report, 'continuity'), /4 of 5 boundaries are exempt, so the carry score covers only 1/)

  // Carried, the end boundary earns its point instead of being excused.
  const carriedEnd: Track = (t) => ({ ...slides(t), hero: { x: 100 + 300 * clamp01((t - 11.1) / 0.4), y: 60, w: 200, h: 200 } })
  const end = checkFilm(meta({ beats }), film({ track: carriedEnd, energy })).legs.continuity.boundaries.at(-1)!
  assert.deepEqual([end.verdict, end.exempt], ['carried', null])
})

test('a scene change the beats do not declare is found, judged, and asked for', () => {
  // The slideshow's cards still change at 7.5 s; the beat sheet stops at 5.
  const report = checkFilm(meta({ beats: [0, 1, 5] }), film({ track: cards }))
  const found = report.legs.continuity.boundaries.filter((b) => !b.declared)
  assert.equal(found.length, 1)
  assert.ok(Math.abs(found[0]!.seconds - 7.5) < 0.1, `found at ${found[0]!.seconds}`)
  assert.equal(found[0]!.verdict, 'bare')
  assert.equal(report.legs.continuity.considered, 3)
  assert.match(sentence(report, 'continuity'), /scene changes at 7\.\d+ s \(bare\) and no beat starts there.*add it to __film\.beats/s)
  // The twin: declared, the same film has no such finding.
  assert.doesNotMatch(sentence(checkFilm(meta(), film({ track: cards })), 'continuity'), /no beat starts there/)
})

test('one beat and no scene change is unmeasured, not carried', () => {
  const report = checkFilm(meta({ beats: [0] }), film({ track: hero }))
  assert.equal(report.legs.continuity.status, 'unmeasured')
  assert.equal(report.verdict, 'warn')
  assert.match(sentence(report, 'continuity'), /declares one beat and the tracks show no scene change/)
})

test('a picture that cuts while every tracked box holds is reported as something untracked', () => {
  const spike = (at: number) => (t: number): number => (Math.abs(t - at) < ENERGY_STEP_SECONDS / 2 ? 40 : calm(t))
  const midBeat = checkFilm(meta(), film({ energy: spike(3) }))
  assert.equal(midBeat.legs.continuity.untracked.length, 1)
  assert.ok(Math.abs(midBeat.legs.continuity.untracked[0]! - 3) < 0.1)
  assert.match(sentence(midBeat, 'continuity'), /picture changes wholesale at 3\.\d+ s while every tracked box holds.*Track it/s)
  // At a declared boundary a picture cut is the boundary, already judged.
  assert.deepEqual(checkFilm(meta(), film({ energy: spike(5) })).legs.continuity.untracked, [])
})

test('the verdicts do not depend on the sampling rate, until it is too coarse to trust', () => {
  const verdicts = (rate: number): string[] =>
    checkFilm(meta(), film({ trackRate: rate })).legs.continuity.boundaries.map((b) => `${b.verdict}:${b.by[0]}`)
  assert.deepEqual(verdicts(60), verdicts(30))
  assert.deepEqual(verdicts(12), verdicts(30))
  const slides = (rate: number): string[] =>
    checkFilm(meta(), film({ track: cards, trackRate: rate })).legs.continuity.boundaries.map((b) => b.verdict)
  assert.deepEqual(slides(60), ['bare', 'bare', 'bare'])
  assert.deepEqual(slides(12), ['bare', 'bare', 'bare'])

  const coarse = checkFilm(meta(), film({ trackRate: 6 }))
  assert.equal(coarse.legs.continuity.status, 'warn')
  assert.match(sentence(coarse, 'continuity'), /sampled 6 times a second, under the 10 a carry window needs/)
  assert.doesNotMatch(sentence(checkFilm(meta(), film({ trackRate: 12 })), 'continuity'), /coarse/)
})

// ---------------------------------------------------------------------------
// Rhythm
// ---------------------------------------------------------------------------

test('equal beats are a metronome and fail; the same film with varied beats does not', () => {
  const beats = [0, 3, 6, 9]
  const track: Track = (t) => ({
    [`card${beatAt(t, beats)}`]: { x: 500, y: 300, w: 900, h: 500 },
    hero: { x: 100 + 300 * beats.slice(1).reduce((sum, beat) => sum + clamp01((t - (beat - 0.1)) / 0.4), 0), y: 60, w: 200, h: 200 }
  })
  const report = checkFilm(meta({ beats }), film({ track, energy: (t) => (beats.some((b) => Math.abs(t - b) < 0.3) ? 6 : 0) }))
  assert.equal(report.legs.continuity.status, 'pass', 'specimen: only the cadence is wrong')
  assert.equal(report.legs.rhythm.status, 'fail')
  assert.equal(report.legs.rhythm.beatCv, 0)
  assert.match(sentence(report, 'rhythm'), /metronome: lengths 3, 3, 3, 3 s vary by 0\.00 .* under 0\.25/)
  assert.match(sentence(report, 'rhythm'), /longest at least 4x the shortest/)

  const varied = good().legs.rhythm
  assert.equal(varied.status, 'pass')
  assert.deepEqual(varied.beatSeconds, [1, 4, 2.5, 4.5])
  assert.ok(varied.beatCv! >= 0.25)
  assert.equal(varied.longestOverShortest, 4.5)
})

test('beats that vary but by less than 4x warn with the ratio', () => {
  const beats = [0, 2, 5.5, 8]
  const report = checkFilm(meta({ beats }), film({ track: hero, energy: () => 0 }))
  // Lengths 2, 3.5, 2.5, 4: CV 0.27, ratio 2.
  assert.ok(report.legs.rhythm.beatCv! >= 0.25, `specimen: not a metronome (${report.legs.rhythm.beatCv})`)
  assert.equal(report.legs.rhythm.status, 'warn')
  assert.match(sentence(report, 'rhythm'), /longest beat is 2\.0x the shortest \(4 s against 2 s\); the method asks for 4x/)
})

test('a film that never stops fails; so does one whose only quiet is a slow push', () => {
  const restless = checkFilm(meta(), film({ energy: () => 5 }))
  assert.equal(restless.legs.rhythm.status, 'fail')
  assert.equal(restless.legs.rhythm.stillShare, 0)
  assert.equal(restless.legs.rhythm.longestRest, null)
  assert.match(sentence(restless, 'rhythm'), /never stops: 0 % of it is dead still, under 25 % and its longest rest is 0 s, under 1 s/)
  assert.match(sentence(restless, 'rhythm'), /no slow push/)

  // A push reads 0.2 everywhere it "rests": under the low bar for seconds, never dead still.
  const pushed = checkFilm(meta(), film({ energy: (t) => (calm(t) > 0 ? 6 : 0.2) }))
  assert.equal(pushed.legs.rhythm.status, 'fail')
  assert.ok(pushed.legs.rhythm.longestRest!.toSeconds - pushed.legs.rhythm.longestRest!.fromSeconds >= 1, 'specimen: it does have a long quiet stretch')
  assert.match(sentence(pushed, 'rhythm'), /never stops: 0 % of it is dead still, under 25 %\./)

  // Still most of the time but never for a whole second.
  const twitchy = checkFilm(meta(), film({ energy: (t) => (Math.floor(t / 0.5) % 2 === 0 ? 0 : 6) }))
  assert.ok(twitchy.legs.rhythm.stillShare! >= 0.25, 'specimen: it is still often enough')
  assert.equal(twitchy.legs.rhythm.status, 'fail')
  assert.match(sentence(twitchy, 'rhythm'), /never stops: its longest rest is 0\.5 s, under 1 s/)

  // The numbers the running app read off fixtures/film/carried.html (test/app/film.mjs): a 200 px
  // subject crossing at 25 px/frame is 1.97, and the tail of its ease 0.34–0.41. Neither is a rest
  // or a hold, and on the thresholds this started with (2 and 0.5) both were.
  const crossing = checkFilm(meta(), film({ energy: () => 1.97 }))
  assert.equal(crossing.legs.rhythm.longestRest, null, 'a subject crossing the frame is not a rest')
  assert.equal(crossing.legs.rhythm.moving.length, 1)
  const tail = checkFilm(meta(), film({ energy: () => 0.34 }))
  assert.equal(tail.legs.rhythm.stillShare, 0, 'the tail of an ease is not dead still')
  assert.equal(tail.legs.rhythm.status, 'fail')
  // …and a time captured twice may differ by 0.05 and be the same picture, so under that is still.
  const same = checkFilm(meta(), film({ energy: () => 0.04 }))
  assert.equal(same.legs.rhythm.stillShare, 1)

  const rested = good().legs.rhythm
  assert.equal(rested.status, 'pass')
  assert.ok(rested.stillShare! >= 0.25)
  // The last beat: still from the end of the move through 7.5 s to the end of the film.
  assert.deepEqual(rested.longestRest, { fromSeconds: 7.83, toSeconds: 12 })
})

test('the energy summary says when the film moves', () => {
  const rhythm = good().legs.rhythm
  assert.equal(rhythm.moving.length, 3)
  for (const [index, beat] of BEATS.slice(1).entries()) {
    const stretch = rhythm.moving[index]!
    assert.ok(stretch.fromSeconds <= beat && stretch.toSeconds >= beat, `the stretch around ${beat}`)
    assert.equal(stretch.peak, 6)
  }
  assert.equal(rhythm.energyPerBeat!.length, BEATS.length)
})

test('with no pictures the stillness leg is unmeasured and says why, and the film cannot pass', () => {
  const report = checkFilm(meta(), film({ energy: null }))
  assert.equal(report.legs.rhythm.status, 'unmeasured')
  assert.equal(report.legs.rhythm.stillShare, null)
  assert.equal(report.verdict, 'warn')
  assert.match(sentence(report, 'rhythm'), /Stillness was not measured: check_film was called with pictures: false/)
  // Everything else is still judged.
  assert.equal(report.legs.continuity.status, 'pass')
})

// ---------------------------------------------------------------------------
// Curves
// ---------------------------------------------------------------------------

/** The passing film plus a streak that crosses `px` per frame for five frames in the second beat. */
const streak = (px: number): Track => both(cards, hero, (t) => ({ streak: { x: 100 + px * 5 * clamp01((t - 2) / (5 / 30)), y: 800, w: 100, h: 100 } }))

test('a 200 px/frame move fails without blur and passes with it declared; 60 px/frame passes either way', () => {
  assert.equal(FAST_PX_PER_FRAME_AT_1080P, 80)
  const samples = film({ track: streak(200) })
  const a = samples.track[60]!.boxes!['streak']!
  const b = samples.track[61]!.boxes!['streak']!
  assert.ok(Math.abs(b[0]! - a[0]! - 200) < 1e-6, 'specimen: the streak really steps 200 px in one frame')

  const bare = checkFilm(meta(), samples)
  assert.equal(bare.legs.curves.status, 'fail')
  assert.equal(bare.verdict, 'fail')
  const peak = bare.legs.curves.peaks.find((p) => p.id === 'streak')!
  assert.equal(peak.pxPerFrame, 200)
  assert.equal(peak.framesOverLimit, 5)
  assert.ok(peak.seconds > 2 && peak.seconds <= 2.17, `inside the streak: ${peak.seconds}`)
  const said = sentence(bare, 'curves')
  assert.match(said, /streak moves 200 px\/frame at 2\.\d+ s — over 80 px\/frame at 30 fps/)
  assert.match(said, /declare __film\.blur: true/)

  const blurred = checkFilm(meta({ blur: true }), samples)
  assert.equal(blurred.legs.curves.status, 'pass')
  assert.equal(blurred.legs.curves.blurDeclared, true)
  // Still reported: declaring blur lifts the limit, it does not hide the number.
  assert.equal(blurred.legs.curves.peaks.find((p) => p.id === 'streak')!.pxPerFrame, 200)
  assert.equal(sentence(blurred, 'curves'), '')

  const gentle = checkFilm(meta(), film({ track: streak(60) }))
  assert.equal(gentle.legs.curves.status, 'pass')
  assert.equal(gentle.legs.curves.peaks.find((p) => p.id === 'streak')!.pxPerFrame, 60)
})

test('the speed limit is per frame of the film and scales with the frame', () => {
  // The same 200 px/frame-at-30 streak is 100 px/frame at 60 fps: still over. At 40 it is under.
  const at60 = checkFilm(meta(), film({ track: streak(200), fps: 60 }))
  assert.equal(at60.legs.curves.peaks.find((p) => p.id === 'streak')!.pxPerFrame, 100)
  assert.equal(at60.legs.curves.status, 'fail')
  // Sampled at half the film's rate, a step covers two frames and is reported per frame.
  const halfRate = checkFilm(meta(), film({ track: streak(200), fps: 60, trackRate: 30 }))
  assert.equal(halfRate.legs.curves.peaks.find((p) => p.id === 'streak')!.pxPerFrame, 100)
  // A 4K frame doubles the limit: 150 px/frame there is 75 at 1080p.
  const big = { ...film({ track: streak(150) }), width: 3840, height: 2160 }
  assert.equal(checkFilm(meta(), big).legs.curves.limitPxPerFrame, 160)
  assert.equal(checkFilm(meta(), big).legs.curves.status, 'pass')
  assert.equal(checkFilm(meta(), film({ track: streak(150) })).legs.curves.status, 'fail')
})

test('speed is what a viewer can see: a panel growing past the frame is judged on its visible edges', () => {
  // A panel grows about the frame's centre from 1600x900 to ten times that in a third of a second:
  // its corners leave the frame after a few frames and go on travelling far outside it.
  const grow = (t: number): number => 1 + 9 * clamp01((t - 2) / (10 / 30))
  const panel: Track = (t) => ({ panel: { x: W / 2 - 800 * grow(t), y: H / 2 - 450 * grow(t), w: 1600 * grow(t), h: 900 * grow(t) } })
  const samples = film({ track: both(hero, panel), energy: () => 0 })
  const box = (k: number): number[] => samples.track[k]!.boxes!['panel'] as number[]
  const unclipped = Math.hypot(box(66)[0]! - box(65)[0]!, box(66)[1]! - box(65)[1]!)
  assert.ok(unclipped > 800, `specimen: a corner really travels ${Math.round(unclipped)} px in a frame, off screen`)
  assert.ok(box(65)[0]! < 0 && box(65)[1]! < 0, 'specimen: and by then the panel already covers the frame')

  const report = checkFilm(meta(), samples)
  const peak = report.legs.curves.peaks.find((p) => p.id === 'panel')!
  // On screen its edges go from 160 px inside the frame to the frame's edge, in the first frame or two.
  assert.ok(peak.pxPerFrame <= Math.hypot(160, 90) + 0.1, `judged on the visible part: ${peak.pxPerFrame}`)
  assert.ok(peak.pxPerFrame > 0, 'the edges reaching the frame still count')
  assert.ok(peak.seconds <= 2.1, `and it peaks while there is an edge to see, not at ${peak.seconds} s`)
  assert.doesNotMatch(sentence(report, 'curves'), /panel moves [3-9]\d\d/)

  // The nearest thing that must still be caught: the same speed, on screen.
  const seen = checkFilm(meta(), film({ track: streak(200), energy: () => 0 }))
  assert.equal(seen.legs.curves.peaks.find((p) => p.id === 'streak')!.pxPerFrame, 200)
  // …and something that comes in from outside the frame is measured from the edge it crosses.
  const entering: Track = (t) => ({ card: { x: -400 + 1200 * clamp01((t - 2) / (4 / 30)), y: 400, w: 300, h: 300 } })
  const came = checkFilm(meta(), film({ track: both(hero, entering), energy: () => 0 })).legs.curves.peaks.find((p) => p.id === 'card')!
  assert.equal(came.pxPerFrame, 300)
})

test('the film\'s events come back as it gave them; a bad list is a warning with the shape, never a failure', () => {
  const declared = (events?: DeclaredFilm['events']): DeclaredFilm => ({ present: true, kind: 'object', beats: BEATS, track: 'function', ...(events ? { events } : {}) })
  const report = (events?: DeclaredFilm['events']): ReturnType<typeof checkFilm> => {
    const read = readFilmMeta(declared(events), DURATION)
    assert.ok(read.ok, 'events never refuse the film')
    return checkFilm(read.meta, film())
  }
  // Fields the oracle does not know are carried through: score_sfx is what checks a score.
  const list = [{ t: 1, material: 'knock', gain: 0.4, pan: -0.2 }, { t: 5, material: 'thump', size: 2 }]
  const given = report({ value: list })
  assert.deepEqual(given.events, list)
  assert.equal(given.verdict, 'pass')
  assert.deepEqual(report({ value: [] }).events, [])

  const none = report()
  assert.equal('events' in none, false)
  assert.equal(none.verdict, 'pass')

  for (const [events, said] of [
    [{ threw: 'table is not defined' }, /__film\.events\(\) threw: "table is not defined"\. The film was measured without it/],
    [{ value: { t: 1 } }, /__film\.events gave a object, not a list.*\[\{ t: 1\.2, material: 'knock' \}\]/],
    [{ value: null }, /__film\.events gave null, not a list/],
    [{ value: [{ t: 1, material: 'knock' }, { t: 'soon', material: 'bell' }] }, /__film\.events\(\)\[1\] is \{"t":"soon","material":"bell"\}, which has no finite t and string material/],
    [{ value: [{ t: 2 }] }, /__film\.events\(\)\[0\] is \{"t":2\}/],
    [{ value: [null] }, /__film\.events\(\)\[0\] is null/]
  ] as const) {
    const bad = report(events)
    assert.equal('events' in bad, false, 'a list that cannot be trusted is not passed on')
    assert.equal(bad.verdict, 'warn')
    assert.equal(bad.legs.faults.status, 'warn')
    assert.deepEqual(bad.findings.map((f) => `${f.leg}:${f.severity}`), ['faults:warn'])
    assert.match(bad.findings[0]!.sentence, said)
    // Everything else is as measured.
    assert.equal(bad.legs.continuity.score, given.legs.continuity.score)
  }
})

test('a jump across a declared cut is not a move', () => {
  const beats = [0, 1, 5]
  const jump: Track = (t) => ({ hero: { x: t < 5 ? 100 : 1500, y: 60, w: 200, h: 200 }, bg: { x: 0, y: 0, w: W, h: H } })
  const declared = checkFilm(meta({ beats, cuts: [5] }), film({ track: jump }))
  assert.equal(declared.legs.curves.status, 'pass')
  const undeclared = checkFilm(meta({ beats }), film({ track: jump }))
  assert.equal(undeclared.legs.curves.status, 'fail')
  assert.match(sentence(undeclared, 'curves'), /hero moves 1400 px\/frame at 5 s/)
})

test('each move reports its t80, so a film of one curve is visible', () => {
  const moves = good().legs.curves.moves.filter((m) => m.id === 'hero')
  assert.equal(moves.length, 3)
  const byStart = [...moves].sort((a, b) => a.fromSeconds - b.fromSeconds)
  // Ease-out cubic gets 80 % done early, linear at 0.8, smoothstep between.
  assert.ok(byStart[0]!.t80 > 0.35 && byStart[0]!.t80 < 0.5, `ease-out: ${byStart[0]!.t80}`)
  assert.ok(Math.abs(byStart[1]!.t80 - 0.8) < 0.02, `linear: ${byStart[1]!.t80}`)
  assert.ok(byStart[2]!.t80 > 0.66 && byStart[2]!.t80 < 0.76, `smoothstep: ${byStart[2]!.t80}`)
  assert.equal(byStart[1]!.travelPx, 300)
  assert.equal(good().legs.curves.status, 'pass')

  // The same film with every boundary on the smoothstep.
  const same: Track = both(cards, (t) => ({
    hero: { x: 100 + 300 * BEATS.slice(1).reduce((sum, beat) => sum + EASES[2]!(clamp01((t - (beat - 0.1)) / 0.4)), 0), y: 60, w: 200, h: 200 }
  }))
  const report = checkFilm(meta(), film({ track: same }))
  assert.equal(report.legs.curves.status, 'warn')
  assert.match(sentence(report, 'curves'), /All 3 moves are the same curve: every t80 is between 0\.7\d* and 0\.7\d*/)
})

// ---------------------------------------------------------------------------
// Framing
// ---------------------------------------------------------------------------

test('a subject that leaves the frame inside its span fails with its id and the times; one that stays passes', () => {
  const wander = (out: boolean): Track => both(cards, hero, (t) => ({ dot: { x: out && t >= 4 && t < 5 ? W + 40 : 900, y: 500, w: 120, h: 120 } }))
  const lost = checkFilm(meta({ inFrame: { dot: { from: 1, to: 10, whole: false } } }), film({ track: wander(true) }))
  assert.equal(lost.legs.framing.status, 'fail')
  assert.equal(lost.verdict, 'fail')
  assert.deepEqual(lost.legs.framing.subjects, [{ id: 'dot', whole: false, out: [{ fromSeconds: 4, toSeconds: 4.97, how: 'off frame' }] }])
  assert.match(sentence(lost, 'framing'), /dot must stay in frame from 1 to 10 s and is off frame at 4–4\.97 s/)

  const kept = checkFilm(meta({ inFrame: { dot: { from: 1, to: 10, whole: false } } }), film({ track: wander(false) }))
  assert.equal(kept.legs.framing.status, 'pass')
  assert.equal(sentence(kept, 'framing'), '')
  // Outside its span the same excursion is nobody's business.
  const later = checkFilm(meta({ inFrame: { dot: { from: 6, to: 10, whole: false } } }), film({ track: wander(true) }))
  assert.equal(later.legs.framing.status, 'pass')
})

test("a 'whole' subject cut by the frame edge fails; the same box without 'whole' is in frame", () => {
  const mark: Track = both(cards, hero, () => ({ mark: { x: -20, y: 400, w: 600, h: 200 } }))
  const whole = checkFilm(meta({ inFrame: { mark: { from: 2, to: 3, whole: true } } }), film({ track: mark }))
  assert.equal(whole.legs.framing.status, 'fail')
  assert.deepEqual(whole.legs.framing.subjects[0]!.out, [{ fromSeconds: 2, toSeconds: 3, how: 'cut by the edge' }])
  assert.match(sentence(whole, 'framing'), /mark must stay whole in frame from 2 to 3 s and is cut by the edge at 2–3 s/)

  const partial = checkFilm(meta({ inFrame: { mark: { from: 2, to: 3, whole: false } } }), film({ track: mark }))
  assert.equal(partial.legs.framing.status, 'pass')
})

test('a subject that fades out inside its span is absent, and an id track never returns is named with the ids it does', () => {
  const fading: Track = both(cards, hero, (t) => ({ dot: { x: 900, y: 500, w: 120, h: 120, op: t >= 3 && t < 3.5 ? 0 : 1 } }))
  const report = checkFilm(meta({ inFrame: { dot: { from: 1, to: 10, whole: false } } }), film({ track: fading }))
  assert.deepEqual(report.legs.framing.subjects[0]!.out, [{ fromSeconds: 3, toSeconds: 3.47, how: 'absent' }])

  const misnamed = checkFilm(meta({ inFrame: { logo: { from: 1, to: 10, whole: false } } }), film())
  assert.equal(misnamed.legs.framing.status, 'fail')
  const said = sentence(misnamed, 'framing')
  assert.match(said, /inFrame names logo, but track\(t\) never returns it/)
  assert.match(said, /it returns card0, hero, card1, card2, card3/)
})

// ---------------------------------------------------------------------------
// Faults
// ---------------------------------------------------------------------------

test('time(t) throwing is counted, with the first times and the message; nothing thrown, nothing said', () => {
  const report = checkFilm(
    meta(),
    film({ spoil: (s) => (s.t >= 9.8 ? { t: s.t, threw: 'time', message: 'The source image cannot be decoded' } : s) })
  )
  assert.equal(report.legs.faults.status, 'fail')
  assert.equal(report.legs.faults.threw.count, 67)
  assert.deepEqual(report.legs.faults.threw.first.map((f) => f.seconds), [9.8, 9.83, 9.87, 9.9, 9.93])
  assert.equal(report.legs.faults.threw.first[0]!.call, 'time')
  assert.match(sentence(report, 'faults'), /time\(t\) threw at 67 of 361 sampled times, first at 9\.8 s, 9\.83 s.*"The source image cannot be decoded"/)

  assert.equal(good().legs.faults.status, 'pass')
  assert.equal(good().legs.faults.threw.count, 0)
})

test('track(t) throwing, returning nothing, or returning a NaN are each named as what they are', () => {
  const thrown = checkFilm(meta(), film({ spoil: (s) => (s.t === 2 ? { t: 2, threw: 'track', message: 'el is null' } : s) }))
  assert.match(sentence(thrown, 'faults'), /track\(t\) threw at 1 of 361 sampled times, first at 2 s: "el is null"/)

  const shapeless = checkFilm(meta(), film({ spoil: (s) => (s.t === 2 ? { t: 2, shape: 'undefined' } : s) }))
  assert.equal(shapeless.legs.faults.status, 'fail')
  assert.match(sentence(shapeless, 'faults'), /track\(t\) returned undefined at 1 sampled times, first at 2 s.*\{\} when nothing is on screen/s)

  const nan = checkFilm(meta(), film({ spoil: (s) => (s.t >= 2 && s.boxes ? { t: s.t, boxes: { ...s.boxes, hero: [null, 60, 200, 200, 1] } } : s) }))
  assert.equal(nan.legs.faults.status, 'fail')
  assert.deepEqual(nan.legs.faults.malformed, [{ id: 'hero', seconds: 2 }])
  assert.match(sentence(nan, 'faults'), /not five finite numbers for hero \(first at 2 s\)/)
})

test('a time that draws differently the second time is impure, by box or by picture; an exact repeat is not', () => {
  const track = both(cards, hero)
  const moved: RawTrackSample = { t: 4, boxes: { ...raw(4, track).boxes!, hero: [431.5, 60, 200, 200, 1] } }
  const byBox = checkFilm(meta(), film({ purity: [{ t: 4, via: 10, first: raw(4, track), again: moved, pictureDelta: 0 }] }))
  assert.equal(byBox.legs.faults.status, 'fail')
  assert.deepEqual(byBox.legs.faults.impure, [{ seconds: 4, viaSeconds: 10, what: 'track gave different boxes for hero' }])
  const said = sentence(byBox, 'faults')
  assert.match(said, /not a pure function of t: seeking 4 s, then 10 s, then 4 s again, track gave different boxes for hero/)
  assert.match(said, /no counters, no state carried between calls/)

  const byPicture = checkFilm(meta(), film({ purity: [{ t: 4, via: 10, first: raw(4, track), again: raw(4, track), pictureDelta: 3.2 }] }))
  assert.deepEqual(byPicture.legs.faults.impure, [{ seconds: 4, viaSeconds: 10, what: 'the picture differed (energy 3.2)' }])

  const pure = checkFilm(meta(), film({ purity: [{ t: 4, via: 10, first: raw(4, track), again: raw(4, track), pictureDelta: 0 }] }))
  assert.equal(pure.legs.faults.status, 'pass')
  // Never checked is not the same as pure.
  const unchecked = checkFilm(meta(), film({ purity: [] }))
  assert.equal(unchecked.legs.faults.status, 'unmeasured')
  assert.equal(unchecked.verdict, 'warn')
})

test('findings list failures before warnings, and what a viewer cannot see before what they can', () => {
  // Impure, a slideshow, off frame, and a metronome-free rhythm warning from too few pictures.
  const track = both(cards, () => ({ dot: { x: W + 40, y: 500, w: 120, h: 120 } }))
  const report = checkFilm(
    meta({ inFrame: { dot: { from: 1, to: 2, whole: false } } }),
    film({
      track,
      energy: null,
      purity: [{ t: 4, via: 10, first: raw(4, track), again: raw(4.5, cards), pictureDelta: null }]
    })
  )
  assert.deepEqual(
    report.findings.map((f) => `${f.severity}:${f.leg}`),
    ['fail:faults', 'fail:continuity', 'fail:framing', 'warn:rhythm']
  )
  assert.match(report.summary, /^FAIL: faults, continuity, framing\. time\(t\) is not a pure function/)
})

// ---------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------

const declared = (extra: Partial<DeclaredFilm> = {}): DeclaredFilm => ({ present: true, kind: 'object', beats: BEATS, track: 'function', ...extra })

test('a well-formed __film reads into its meta', () => {
  const read = readFilmMeta(
    declared({ cuts: [5], inFrame: { dot: [0.5, 12], mark: [7.6, 12, 'whole'] }, blur: true }),
    DURATION
  )
  assert.deepEqual(read, {
    ok: true,
    meta: {
      beats: BEATS,
      cuts: [5],
      inFrame: { dot: { from: 0.5, to: 12, whole: false }, mark: { from: 7.6, to: 12, whole: true } },
      blur: true
    }
  })
  // Only beats and track are required.
  assert.deepEqual(readFilmMeta(declared(), DURATION), { ok: true, meta: { beats: BEATS, cuts: [], inFrame: {}, blur: false } })
})

const problems = (film_: DeclaredFilm): string => {
  const read = readFilmMeta(film_, DURATION)
  assert.equal(read.ok, false)
  return read.ok ? '' : read.problems.join('\n')
}

test('no __film at all is refused with the smallest shape that can be checked', () => {
  const said = problems({ present: false, kind: 'undefined' })
  assert.match(said, /declares nothing to measure: there is no window\.__film/)
  assert.ok(said.includes(FILM_CONTRACT), 'the shape to add is in the refusal')
  assert.match(FILM_CONTRACT, /beats: \[0, 1\.6, 3\.0\]/)
  assert.match(FILM_CONTRACT, /track\(t\)/)
  assert.match(FILM_CONTRACT, /top-left/)
  assert.match(problems({ present: false, kind: 'function' }), /window\.__film is function, not an object/)
})

test('each mistake in the contract is its own sentence, and all of them come back at once', () => {
  assert.match(problems(declared({ track: 'undefined' })), /__film\.track is missing\. It is what the oracle follows.*\{ card: \{ x, y, w, h, op \} \}/s)
  assert.match(problems(declared({ track: 'object' })), /__film\.track is a object, not a function/)
  assert.match(problems(declared({ beats: undefined })), /__film\.beats is missing.*\[0, 1\.6, 3\.0\] for three beats/s)
  assert.match(problems(declared({ beats: [0, 1, null] })), /__film\.beats must be numbers \(seconds\)/)
  assert.match(problems(declared({ beats: [0.5, 2] })), /must start at 0 .* but it starts at 0\.5/)
  assert.match(problems(declared({ beats: [0, 3, 2] })), /must ascend, and 2 follows 3/)
  assert.match(problems(declared({ beats: [0, 5, 12, 14] })), /names 12, 14, at or past the composition's end \(12 s, its data-duration\)/)
  assert.match(problems(declared({ cuts: [3] })), /__film\.cuts lists 3, but no beat starts there.*one of the beat starts after the first: 1, 5, 7\.5/s)
  assert.match(problems(declared({ cuts: 'all' })), /__film\.cuts must be a list of times/)
  assert.match(problems(declared({ inFrame: { dot: [5, 2] } })), /__film\.inFrame\.dot is \[5,2\]\. It must be \[from, to\]/)
  assert.match(problems(declared({ inFrame: { dot: [1, 2, 'all'] } })), /__film\.inFrame\.dot is \[1,2,"all"\]/)
  assert.match(problems(declared({ blur: 'yes' })), /__film\.blur must be true or false/)

  const many = readFilmMeta(declared({ beats: [0, 3, 2], track: 'undefined', blur: 1 }), DURATION)
  assert.equal(many.ok === false && many.problems.length, 3)
  // The twin of every refusal above.
  assert.equal(readFilmMeta(declared({ cuts: [5], inFrame: { dot: [2, 5] }, blur: false }), DURATION).ok, true)
})

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

test('tracks are planned at every frame and pictures twelve a second, and both are capped with the rate reported', () => {
  const short = planFilm(15, 30, true)
  assert.equal(short.trackTimes.length, 451)
  assert.equal(short.trackRate, 30)
  assert.equal(short.trackTimes.at(-1), 15)
  assert.equal(short.pictureTimes.length, 181)
  assert.ok(Math.abs(short.pictureStep - 1 / 12) < 1e-12)
  // Probes return from far away, on times a picture is taken at.
  assert.equal(short.purity.length, 3)
  for (const [t, via] of short.purity) {
    assert.ok(short.pictureTimes.includes(t) && short.pictureTimes.includes(via))
    assert.ok(Math.abs(t - via) > 5)
  }

  const long = planFilm(300, 60, true)
  assert.equal(long.trackTimes.length, MAX_TRACK_SAMPLES)
  assert.ok(Math.abs(long.trackRate - (MAX_TRACK_SAMPLES - 1) / 300) < 1e-9)
  assert.equal(long.pictureTimes.length, MAX_PICTURES)
  assert.ok(long.pictureStep > 1 / 12)
  assert.ok(long.trackTimes.at(-1)! <= 300 && long.pictureTimes.at(-1)! <= 300)

  assert.deepEqual(planFilm(15, 30, false).pictureTimes, [])
})
