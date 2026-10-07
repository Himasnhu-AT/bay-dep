/**
 * The film oracle from page to verdict, without Electron.
 *
 * `sampleFilm` in `./compositions.ts` cannot be loaded here — it imports `electron` — but
 * everything it does except open a window and take a picture is three pure pieces: the scripts
 * it runs in the page (`./scripts`), the plan of times (`planFilm`) and the judgement
 * (`checkFilm`). This runs those three in its order against the real fixture compositions in
 * `test/app/fixtures/film/`, with the page stood in by a `vm` context and a DOM that only
 * records styles. So what is proved is that a composition file written to the contract, read by
 * the scripts main injects, reaches the verdict its header promises.
 *
 * **Not proved here**, because there is no picture: the stillness numbers, purity by picture,
 * and that Chromium runs the scripts as `vm` does. `test/app/film.mjs` is that check, against
 * the same four files, in the running app.
 *
 * The kit in `bay://guide/motion-design` goes through the same route at the end of this file:
 * the example an agent starts every film from has to pass the oracle the guide teaches. It is a
 * canvas program on `bay-motion.js`, so for it the page also gets the real library and a canvas
 * that accepts every call and draws nothing.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createContext, runInContext } from 'node:vm'
import { fatalFaults, readComposition } from '@shared/composition'
import {
  BEAT_CV_MIN,
  BEAT_RATIO_MIN,
  SAME_CURVE_BAND,
  checkFilm,
  planFilm,
  readFilmMeta,
  type DeclaredFilm,
  type FilmReport,
  type FilmSamples,
  type RawTrackSample
} from '@shared/film-oracle'
import { MOTION_FILE } from '@shared/motion-file'
import { checkScore } from '@shared/sfx/score'
import { MOTION_SCRIPT } from './motion-script.generated'
import { filmDeclaredScript, filmTrackScript } from './scripts'

const FIXTURES = join(import.meta.dirname, '../../../test/app/fixtures/film')
const FPS = 30

type Sampled = { declared: DeclaredFilm; problems: string[] | null; report: FilmReport | null; events: unknown }

/** A 2D context that accepts every call and keeps every property set on it: a canvas film runs, and draws nothing. */
function blankCanvas(): unknown {
  return new Proxy({} as Record<string | symbol, unknown>, {
    get: (target, key) => (key in target ? target[key] : () => undefined),
    set: (target, key, value) => {
      target[key] = value
      return true
    }
  })
}

/** What `sampleFilm` does with a fixture composition, minus the window and the pictures. */
function sample(name: string): Sampled {
  const path = join(FIXTURES, name)
  return sampleHtml(readFileSync(path, 'utf8'), name, path)
}

function sampleHtml(html: string, name: string, path?: string): Sampled {
  const { info, faults } = readComposition(html, path)
  assert.deepEqual(fatalFaults(faults), [], `${name} must be a composition bay can render`)
  assert.ok(info)

  // The page's scripts in document order; the one file a `src` may name is the library main writes.
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].map((tag) => {
    const src = /\bsrc="([^"]*)"/.exec(tag[1]!)?.[1]
    if (src === undefined) return tag[2]!
    assert.equal(src, MOTION_FILE, `${name} loads ${src}, which bay does not put beside a composition`)
    return MOTION_SCRIPT
  })
  assert.ok(scripts.some((script) => script.includes('__timelines')), `${name} has an inline script`)
  // The preload's one job: the registry exists before the page's scripts run.
  const window: Record<string, unknown> = { __timelines: {} }
  const elements = new Map<string, unknown>()
  const element = (): unknown => ({ style: {}, width: info.width, height: info.height, getContext: blankCanvas })
  const document = {
    getElementById: (id: string) => {
      if (!elements.has(id)) elements.set(id, element())
      return elements.get(id)
    },
    createElement: element
  }
  const context = createContext({ window, document })
  for (const script of scripts) runInContext(script, context)

  const plain = <T>(value: unknown): T => JSON.parse(JSON.stringify(value)) as T
  const declared = plain<DeclaredFilm>(runInContext(filmDeclaredScript(), context))
  const read = readFilmMeta(declared, info.durationSeconds)
  if (!read.ok) return { declared, problems: read.problems, report: null, events: undefined }

  const plan = planFilm(info.durationSeconds, FPS, false)
  type Tracked = { ok: true; samples: RawTrackSample[]; purity: { t: number; via: number; first: RawTrackSample; again: RawTrackSample }[] }
  const tracked = plain<Tracked>(runInContext(filmTrackScript(info.compositionId, plan.trackTimes, []), context))
  const probed = plain<Tracked>(runInContext(filmTrackScript(info.compositionId, [], plan.purity), context))
  assert.equal(tracked.ok, true)
  const samples: FilmSamples = {
    width: info.width,
    height: info.height,
    fps: FPS,
    durationSeconds: info.durationSeconds,
    trackRate: plan.trackRate,
    track: tracked.samples,
    energy: null,
    energyMissing: 'this test takes no pictures',
    purity: probed.purity.map((probe) => ({ ...probe, pictureDelta: null }))
  }
  // The events come the way check_film's do: read by the page script, carried by the report.
  const report = checkFilm(read.meta, samples)
  return { declared, problems: null, report, events: report.events }
}

const status = (report: FilmReport): Record<string, string> =>
  Object.fromEntries(Object.entries(report.legs).map(([leg, value]) => [leg, value.status]))

test('carried.html: every boundary is carried by the hero, and every leg the tracks can judge passes', () => {
  const { report } = sample('carried.html')
  assert.ok(report)
  // Rhythm is unmeasured only because this test has no pictures; its cadence half is judged.
  assert.deepEqual(status(report), { faults: 'pass', continuity: 'pass', curves: 'pass', rhythm: 'unmeasured', framing: 'pass' })
  assert.equal(report.legs.continuity.score, 1)
  assert.deepEqual(
    report.legs.continuity.boundaries.map((b) => [b.seconds, b.verdict, b.by[0]]),
    [
      [1, 'carried', 'hero'],
      [5, 'carried', 'hero'],
      [7.5, 'carried', 'hero']
    ]
  )
  assert.deepEqual(report.findings.map((f) => f.leg), ['rhythm'])
  assert.match(report.findings[0]!.sentence, /Stillness was not measured: this test takes no pictures/)
  assert.deepEqual(report.legs.framing.subjects, [{ id: 'hero', whole: true, out: [] }])
})

test('slideshow.html: the same cards with nothing crossing a boundary score 0 and fail', () => {
  const { report } = sample('slideshow.html')
  assert.ok(report)
  assert.equal(report.verdict, 'fail')
  assert.equal(report.legs.continuity.status, 'fail')
  assert.equal(report.legs.continuity.score, 0)
  assert.deepEqual(report.legs.continuity.boundaries.map((b) => b.verdict), ['bare', 'bare', 'bare'])
  assert.deepEqual([report.legs.faults.status, report.legs.curves.status], ['pass', 'pass'])
  assert.match(report.summary, /^FAIL: continuity\. Carry score 0\.00 over 3 boundaries/)
})

test('faulty.html: impure, throwing, too fast and out of frame are each found, and its carry still passes', () => {
  const { report } = sample('faulty.html')
  assert.ok(report)
  assert.equal(report.verdict, 'fail')
  assert.deepEqual(status(report), { faults: 'fail', continuity: 'pass', curves: 'fail', rhythm: 'unmeasured', framing: 'fail' })

  assert.equal(report.legs.faults.threw.count, 31)
  assert.equal(report.legs.faults.threw.first[0]!.seconds, 11)
  assert.equal(report.legs.faults.threw.first[0]!.message, 'late frames are broken')
  assert.ok(report.legs.faults.impure.length > 0)
  assert.match(report.legs.faults.impure[0]!.what, /track gave different boxes for hero/)

  const streak = report.legs.curves.peaks.find((p) => p.id === 'streak')!
  assert.equal(streak.pxPerFrame, 200)
  assert.deepEqual(report.legs.framing.subjects, [{ id: 'dot', whole: false, out: [{ fromSeconds: 4, toSeconds: 4.97, how: 'off frame' }] }])
  // Failures first, and among them the ones nobody sees by watching.
  assert.deepEqual(report.findings.filter((f) => f.severity === 'fail').map((f) => f.leg), ['faults', 'faults', 'curves', 'framing'])
})

test('undeclared.html: a composition with no __film is refused with the shape to add, and nothing is sampled', () => {
  const { declared, problems, report } = sample('undeclared.html')
  assert.deepEqual(declared, { present: false, kind: 'undefined' })
  assert.equal(report, null)
  assert.equal(problems?.length, 1)
  assert.match(problems![0]!, /declares nothing to measure: there is no window\.__film/)
  assert.match(problems![0]!, /track\(t\)/)
})

// ---------------------------------------------------------------------------
// The kit in bay://guide/motion-design
// ---------------------------------------------------------------------------

const GUIDE = join(import.meta.dirname, '../mcp/docs/compositions/motion-design.md')

/** The guide's one whole-document example: the film an agent is told to start from. */
function guideKit(): string {
  const kit = /^```html\n([\s\S]*?)^```/m.exec(readFileSync(GUIDE, 'utf8'))?.[1]
  assert.ok(kit && kit.includes('window.__film') && kit.includes(`<script src="${MOTION_FILE}">`), 'the guide has a kit on bay-motion.js that declares __film')
  return kit
}

/** The kit with one piece swapped, and proof the swap landed. */
function kitWith(from: string, to: string): string {
  const kit = guideKit()
  assert.ok(kit.includes(from), `specimen: the kit must contain ${JSON.stringify(from)}`)
  return kit.replace(from, to)
}

test('the motion-design kit passes the oracle it teaches: faults, continuity, curves and framing', () => {
  const { report } = sampleHtml(guideKit(), 'the guide kit')
  assert.ok(report)
  // Rhythm's stillness half needs pictures, which this test cannot take; its cadence half is judged below.
  assert.deepEqual(status(report), { faults: 'pass', continuity: 'pass', curves: 'pass', rhythm: 'unmeasured', framing: 'pass' })
  assert.deepEqual(report.findings.map((f) => f.sentence), ['Stillness was not measured: this test takes no pictures.'])

  // Three boundaries, each carried, each by the id the guide says carries it.
  assert.equal(report.legs.continuity.score, 1)
  const boundaries = report.legs.continuity.boundaries
  assert.deepEqual(boundaries.map((b) => [b.seconds, b.verdict, b.exempt]), [
    [1.3, 'carried', null],
    [4.3, 'carried', null],
    [5.1, 'carried', null]
  ])
  assert.equal(boundaries[0]!.by[0], 'panel')
  assert.ok(boundaries[1]!.by.includes('thumb'), `the push is carried by ${boundaries[1]!.by.join(', ')}`)
  assert.equal(boundaries[2]!.by[0], 'dot')

  // Cadence: uneven, and the longest beat at least four times the shortest.
  const rhythm = report.legs.rhythm
  assert.deepEqual(rhythm.beatSeconds, [1.3, 3, 0.8, 4.9])
  assert.ok(rhythm.beatCv! >= BEAT_CV_MIN && rhythm.longestOverShortest! >= BEAT_RATIO_MIN, JSON.stringify(rhythm))

  // Curves: the moves are not one curve, and the fastest is over the limit — so the pass rests on the blur it declares and draws.
  const curves = report.legs.curves
  const t80 = curves.moves.map((move) => move.t80)
  assert.ok(curves.moves.length >= 3 && Math.max(...t80) - Math.min(...t80) > SAME_CURVE_BAND, JSON.stringify(t80))
  assert.equal(curves.blurDeclared, true)
  assert.ok(curves.peaks[0]!.pxPerFrame > curves.limitPxPerFrame)

  assert.deepEqual(report.legs.framing.subjects, [
    { id: 'panel', whole: false, out: [] },
    { id: 'word', whole: true, out: [] }
  ])
})

test('the kit, broken on purpose, fails the leg that should catch it (the proof the pass means something)', () => {
  // Without the blur it declares, its fast moves strobe: curves fails and nothing else moves.
  const unblurred = sampleHtml(kitWith('blur: true,', 'blur: false,'), 'the kit without blur').report
  assert.ok(unblurred)
  assert.deepEqual(status(unblurred), { faults: 'pass', continuity: 'pass', curves: 'fail', rhythm: 'unmeasured', framing: 'pass' })

  // The iris built from two ids — the dot, then a separate stage — is the guide's own warning:
  // neither carries. (The boundary is still "carried", by the panel: the last 0.25 s of the push
  // before it falls inside its window. That is the oracle's reach, and the report names it.)
  const twoIds = sampleHtml(kitWith('boxes.dot = { x: W / 2 - ir.r', 'boxes.stage = { x: W / 2 - ir.r'), 'the kit with a two-id iris').report
  assert.ok(twoIds)
  const last = twoIds.legs.continuity.boundaries[2]!
  assert.equal(last.seconds, 5.1)
  assert.deepEqual(last.by.filter((id) => id === 'dot' || id === 'stage'), [], `${last.verdict} by ${last.by.join(', ')}`)
  assert.doesNotMatch(last.detail, /dot|stage/)

  // A camera that loses the word: framing names it.
  const lost = sampleHtml(kitWith("const WORD = { x: 510,", "const WORD = { x: 1510,"), 'the kit with the word off the edge').report
  assert.ok(lost)
  assert.equal(lost.legs.framing.status, 'fail')
  assert.deepEqual(lost.legs.framing.subjects.filter((subject) => subject.out.length > 0).map((subject) => subject.id), ['word'])
})

test('a film\'s events reach the report through the page script, and a broken events() costs the sound, not the film', () => {
  // No events declared: nothing returned, nothing said.
  const none = sample('slideshow.html').report!
  assert.equal('events' in none, false)
  assert.deepEqual(none.findings.filter((f) => /events/.test(f.sentence)), [])
  assert.deepEqual(sample('carried.html').report!.events, [1, 5, 7.5].map((t) => ({ t, material: 'knock', gain: 0.5 })))

  const thrown = sampleHtml(kitWith('events: () => [', "events: () => { throw new Error('no table') }, unused: () => ["), 'the kit whose events() throws').report!
  assert.equal(thrown.events, undefined)
  assert.equal(thrown.legs.faults.status, 'warn')
  assert.equal(thrown.legs.continuity.score, 1, 'the film was still measured')
  assert.match(thrown.findings.find((f) => f.leg === 'faults')!.sentence, /__film\.events\(\) threw: "no table"/)

  // A list given directly, not as a function, is read the same way.
  const listed = sampleHtml(kitWith('events: () => [', 'events: ['), 'the kit with events as a list')
  assert.deepEqual(listed.events, sampleHtml(guideKit(), 'the guide kit').events)
})

test('the kit\'s sound events are a score score_sfx accepts: fewer than its picture has, one loudest', () => {
  const { events } = sampleHtml(guideKit(), 'the guide kit')
  assert.ok(Array.isArray(events) && events.length >= 3, 'the kit declares __film.events()')
  const checked = checkScore({ durationSeconds: 10, events })
  assert.ok(checked.ok, checked.ok ? '' : checked.errors.join(' '))
  assert.deepEqual(checked.warnings, [])
  // Nine things happen in the picture (a pop, a press, an opening, a fill, a tick, a push, an iris, a landing, a line).
  assert.ok(events.length <= 4, `${events.length} sounds`)
  const gains = checked.score.events.map((event) => event.gain).sort((a, b) => b - a)
  assert.ok(gains[0]! > gains[1]!, 'one hit is the loudest')
  assert.equal(checked.score.events.find((event) => event.gain === gains[0])!.material, 'thump')
})
