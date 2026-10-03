/**
 * `check_film` end to end, in the running app: the four fixtures in `fixtures/film/`, through the
 * real executor, main's sampler, a real composition window and real captures.
 *
 *     PORT=9222 node test/app/film.mjs
 *
 * Build first (`./run.sh`), because main's sampler is in the bundle the app started with. 47
 * checks; first run against a real instance was green as written, and the raw energy series it
 * measured is what `STILL_ENERGY` and `LOW_ENERGY` in `src/shared/film-oracle.ts` are set from.
 *
 * What only this can prove — `src/main/html/film-fixtures.test.ts` runs the same fixtures through
 * the same scripts and the same judgement under Node, but with a `vm` for the page and no picture:
 *
 * - that Chromium runs the injected scripts and the answer survives `executeJavaScript`;
 * - the picture half: stillness, the moving stretches, purity by picture;
 * - that sampling leaves the project, the undo stack and the preview's composition alone.
 *
 * The stillness instrument has its own positive control: `carried.html` is dead still between
 * its boundaries and moves through each, so a sampler that read every step as still (or none)
 * fails the pair of checks on `moving` and `longestRest`.
 *
 * Imports four assets; `runProbe` unwinds them. Nothing is placed and nothing is saved.
 */

import { fileURLToPath } from 'node:url'
import { attach, runProbe, check, PreconditionError } from './cdp.mjs'

const DIR = fileURLToPath(new URL('./fixtures/film/', import.meta.url))
const FILES = ['carried.html', 'slideshow.html', 'faulty.html', 'undeclared.html']

const { evaluate } = await attach()

await runProbe(async () => {
  const S = 'window.bayEngine.store.getState()'
  let n = 0
  const call = (tool, args = {}, timeout = 300_000) =>
    evaluate(`window.bayMcp.execute(${JSON.stringify({ id: `film${++n}`, tool, args })})`, timeout)

  const imported = await call('import_media', { paths: FILES.map((name) => DIR + name) })
  if (!imported.ok) throw new PreconditionError('import_media failed', imported.error)
  const assets = await evaluate(`${S}.project.assets.map((a) => ({ id: a.id, path: a.path, kind: a.kind, error: a.error ?? null }))`)
  const idOf = (name) => {
    const asset = assets.find((a) => a.path === DIR + name)
    if (!asset || asset.kind !== 'html' || asset.error) {
      throw new PreconditionError(`${name} did not import as a usable composition`, JSON.stringify(asset ?? null))
    }
    return asset.id
  }
  const ids = Object.fromEntries(FILES.map((name) => [name, idOf(name)]))
  const fps = await evaluate(`${S}.project.timelines[0].fps`)
  const pastBefore = await evaluate(`${S}.past.length`)
  const status = (value) => Object.fromEntries(Object.entries(value.legs).map(([leg, v]) => [leg, v.status]))

  console.log('\n── carried.html: a film that passes')
  const started = Date.now()
  const carried = await call('check_film', { assetId: ids['carried.html'] })
  check('it answers ok', carried.ok, true)
  const c = carried.value
  console.log(`     ${Date.now() - started} ms (it reports ${c.elapsedSeconds} s); ${JSON.stringify(c.sampling)}`)
  console.log(`     ${c.summary}`)
  console.log(`     still ${c.legs.rhythm.stillShare}, low ${c.legs.rhythm.lowShare}, rest ${JSON.stringify(c.legs.rhythm.longestRest)}, moving ${JSON.stringify(c.legs.rhythm.moving)}`)
  check('measured', c.measured, true)
  check('every leg passes', status(c), (s) => Object.values(s).every((v) => v === 'pass'))
  check('verdict pass', c.verdict, 'pass')
  check('no findings', c.findings.length, 0)
  check('carry 1.00 over 3 boundaries', [c.legs.continuity.score, c.legs.continuity.considered], (v) => v[0] === 1 && v[1] === 3)
  check('each carried by hero', c.legs.continuity.boundaries.map((b) => `${b.verdict}:${b.by[0]}`), (v) => v.every((x) => x === 'carried:hero'))
  check('tracks at the timeline rate, 12 s', [c.sampling.trackRate, c.sampling.trackSamples], (v) => v[0] === fps && v[1] === 12 * fps + 1)
  check('145 pictures, twelve a second', c.sampling.pictures, 145)
  // The stillness instrument, both ways: it sees the three crossings, and it sees the holds.
  check('the picture moves through each boundary', [1, 5, 7.5].map((b) => c.legs.rhythm.moving.some((m) => m.fromSeconds <= b + 0.1 && m.toSeconds >= b - 0.1)), (v) => v.every(Boolean))
  check('and nowhere else (three moving stretches)', c.legs.rhythm.moving.length, 3)
  check('it is dead still between them', c.legs.rhythm.stillShare, (v) => v >= 0.8)
  check('with a rest of over a second', c.legs.rhythm.longestRest, (r) => r && r.toSeconds - r.fromSeconds >= 3)
  check('the same time twice is the same picture', c.legs.faults.impure.length, 0)
  check('nothing reads as untracked', c.legs.continuity.untracked.length, 0)
  check('its events() come back as events, for score_sfx', c.events, (e) => JSON.stringify(e) === JSON.stringify([1, 5, 7.5].map((t) => ({ t, material: 'knock', gain: 0.5 }))))
  check('and next says where they go', c.next, (t) => /pass it to score_sfx as events, with durationSeconds 12/.test(t))

  console.log('\n── slideshow.html: the same cards, nothing carried')
  const slides = await call('check_film', { assetId: ids['slideshow.html'] })
  check('it answers ok', slides.ok, true)
  const s = slides.value
  console.log(`     ${s.summary}`)
  check('verdict fail', s.verdict, 'fail')
  check('continuity is the leg that fails', status(s), (v) => v.continuity === 'fail' && v.faults === 'pass' && v.curves === 'pass' && v.rhythm === 'pass')
  check('carry 0', s.legs.continuity.score, 0)
  check('bare at 1, 5 and 7.5 s', s.legs.continuity.boundaries.map((b) => `${b.seconds}:${b.verdict}`).join(' '), '1:bare 5:bare 7.5:bare')
  check('the finding says what to do', s.findings[0].sentence, (t) => /Carry score 0\.00/.test(t) && /keep one tracked thing on screen/.test(t))
  check('and the next step is to fix, not place', s.next, (t) => /Do not place or export a film that fails/.test(t))
  check('a film with no events() returns none', 'events' in s, false)

  console.log('\n── faulty.html: impure, throwing, too fast, out of frame')
  const faulty = await call('check_film', { assetId: ids['faulty.html'] })
  check('it answers ok — a film that throws is still measured', faulty.ok, true)
  const f = faulty.value
  console.log(`     ${f.summary}`)
  console.log(`     findings: ${f.findings.map((x) => `${x.severity}:${x.leg}`).join(', ')}`)
  check('verdict fail', f.verdict, 'fail')
  check('faults, curves and framing fail; continuity passes', status(f), (v) => v.faults === 'fail' && v.curves === 'fail' && v.framing === 'fail' && v.continuity === 'pass')
  check('time(t) threw for the last second', f.legs.faults.threw.count, fps + 1)
  check('with its message', f.legs.faults.threw.first[0].message, 'late frames are broken')
  check('the same time twice differed', f.legs.faults.impure.length, (v) => v > 0)
  check('streak at 200 px/frame (at 30 fps)', f.legs.curves.peaks.find((p) => p.id === 'streak').pxPerFrame, Math.round((200 * 30) / fps * 10) / 10)
  check('dot off frame from 4 s', f.legs.framing.subjects[0].out[0], (o) => o && o.how === 'off frame' && o.fromSeconds === 4)
  check('the 11 s it could draw were still measured for stillness', f.legs.rhythm.stillShare, (v) => typeof v === 'number')

  console.log('\n── undeclared.html: no window.__film')
  const none = await call('check_film', { assetId: ids['undeclared.html'] })
  check('it answers ok — a refusal with the shape, not an error', none.ok, true)
  check('measured false', none.value.measured, false)
  check('no verdict', none.value.verdict, undefined)
  check('it says there is no __film', none.value.problems[0], (t) => /there is no window\.__film/.test(t))
  check('and gives the contract', none.value.contract, (t) => /beats: \[0, 1\.6, 3\.0\]/.test(t) && /track\(t\)/.test(t))

  console.log('\n── pictures: false')
  const quickStart = Date.now()
  const quick = await call('check_film', { assetId: ids['carried.html'], pictures: false })
  const quickMs = Date.now() - quickStart
  console.log(`     ${quickMs} ms`)
  check('it answers ok', quick.ok, true)
  check('stillness is unmeasured, and says why', quick.value.findings.map((x) => x.sentence).join(' '), (t) => /Stillness was not measured: check_film was called with pictures: false/.test(t))
  check('so the film warns rather than passes', quick.value.verdict, 'warn')
  check('carry is still judged', quick.value.legs.continuity.score, 1)
  check('no pictures were taken', quick.value.sampling.pictures, 0)
  check('and it is quick (under 5 s)', quickMs, (ms) => ms < 5000)

  console.log('\n── refusals')
  const neither = await call('check_film', {})
  check('no id is refused with what to pass', neither.error, (t) => /needs assetId .* or itemId/.test(t ?? ''))

  console.log('\n── it changes nothing')
  check('no undo step from five checks', await evaluate(`${S}.past.length`), pastBefore)

  return true
})
