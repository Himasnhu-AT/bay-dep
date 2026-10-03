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
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createContext, runInContext } from 'node:vm'
import { fatalFaults, readComposition } from '@shared/composition'
import { checkFilm, planFilm, readFilmMeta, type DeclaredFilm, type FilmReport, type FilmSamples, type RawTrackSample } from '@shared/film-oracle'
import { filmDeclaredScript, filmTrackScript } from './scripts'

const FIXTURES = join(import.meta.dirname, '../../../test/app/fixtures/film')
const FPS = 30

type Sampled = { declared: DeclaredFilm; problems: string[] | null; report: FilmReport | null }

/** What `sampleFilm` does with a composition, minus the window and the pictures. */
function sample(name: string): Sampled {
  const path = join(FIXTURES, name)
  const html = readFileSync(path, 'utf8')
  const { info, faults } = readComposition(html, path)
  assert.deepEqual(fatalFaults(faults), [], `${name} must be a composition bay can render`)
  assert.ok(info)

  const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1]
  assert.ok(script, `${name} has an inline script`)
  // The preload's one job: the registry exists before the page's scripts run.
  const window: Record<string, unknown> = { __timelines: {} }
  const elements = new Map<string, { style: Record<string, string> }>()
  const document = {
    getElementById: (id: string) => {
      if (!elements.has(id)) elements.set(id, { style: {} })
      return elements.get(id)
    }
  }
  const context = createContext({ window, document })
  runInContext(script, context)

  const plain = <T>(value: unknown): T => JSON.parse(JSON.stringify(value)) as T
  const declared = plain<DeclaredFilm>(runInContext(filmDeclaredScript(), context))
  const read = readFilmMeta(declared, info.durationSeconds)
  if (!read.ok) return { declared, problems: read.problems, report: null }

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
  return { declared, problems: null, report: checkFilm(read.meta, samples) }
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
