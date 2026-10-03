/**
 * The scripts injected into a composition window.
 *
 * These are strings of JavaScript that run in another process against a page this file never
 * sees, so nothing here can prove they *work*. What it can prove is the property whose
 * violation cost a full-length caption track: the seek must call the timeline's `time` exactly
 * once, with an argument.
 *
 * The composition contract asks an author for `{ time(seconds), duration() }` and does not
 * promise GSAP. `seekScript` used to finish with `at: tl.time()` — GSAP's getter — which for a
 * hand-rolled timeline is the *setter* receiving `undefined`. It reset the composition right
 * after seeking it, and whether the capture beat the wipe was a race: the first seek into a
 * fresh window came back correct and every later one came back blank with `held: true`.
 *
 * Asserting on generated source is usually weak, but here the generated source IS the artifact
 * that crosses the process boundary, and the failure it guards produces a blank picture rather
 * than an error — so nothing downstream can notice it either.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { runInNewContext } from 'node:vm'
import { filmDeclaredScript, filmTrackScript, seekScript, variablesScript } from './scripts'

test('the seek calls time() exactly once, and never with no argument', () => {
  const script = seekScript('title', 1.5)
  // The specimen has to be capable of failing: prove the pattern matches the broken form.
  const broken = script.replace('at: 1.5', 'at: tl.time()')
  assert.match(broken, /\.time\(\s*\)/, 'the detector must recognise a bare getter call')

  assert.doesNotMatch(script, /\.time\(\s*\)/, 'a bare time() is the setter taking undefined')
  assert.equal(script.match(/tl\.time\(/g)?.length, 1, 'exactly one seek per capture')
  assert.match(script, /tl\.time\(1\.5\)/)
})

test('the seek echoes the time it asked for rather than reading it back', () => {
  assert.match(seekScript('title', 2.25), /at:\s*2\.25/)
})

test('a missing timeline is refused by name, so the reason is actionable', () => {
  const script = seekScript('lower-third', 0)
  assert.match(script, /ok: false/)
  assert.match(script, /"lower-third"/, 'the id it looked for must appear in the refusal')
})

test('the composition id is embedded as JSON, so a quote in it cannot break out', () => {
  const script = seekScript(`ti'tle"x`, 0)
  assert.match(script, /window\.__timelines\[".*?"\]/)
  // The real property: it still parses as JavaScript.
  assert.doesNotThrow(() => new Function(`return ${script.replace('await ', '')}`))
})

test('variable values are embedded as JSON, not interpolated raw', () => {
  const script = variablesScript({ headline: 'it\'s "quoted" \\ odd' }, { tint: '#fff' })
  assert.doesNotThrow(() => new Function(`return ${script}`), 'a quote in a value must not break the script')
  assert.match(script, /--/, 'css custom properties are set from the css map')
})

test('variablesScript writes only an element own text node', () => {
  // The rule that keeps an animated <span> inside a heading alive across a substitution.
  const script = variablesScript({ headline: 'x' }, {})
  assert.match(script, /nodeType === 3/)
})

// ---------------------------------------------------------------------------
// The film oracle's two scripts. Unlike the seek, these compute their answer in the page, so
// they are run here against a stand-in `window` — the answer is the artifact.
// ---------------------------------------------------------------------------

function inPage<T>(script: string, window: Record<string, unknown>): T {
  return runInNewContext(script, { window }) as T
}

/** A composition whose dot slides right, with a timeline that records every seek. */
function page(track?: (t: number, at: number) => unknown): { window: Record<string, unknown>; seeks: number[] } {
  const seeks: number[] = []
  let at = 0
  const window: Record<string, unknown> = {
    __timelines: { film: { time: (t: number) => { seeks.push(t); at = t }, duration: () => 4 } },
    __film: {
      beats: [0, 1.5],
      cuts: [1.5],
      inFrame: { dot: [0, 4, 'whole'] },
      blur: true,
      track: (t: number) => (track ? track(t, at) : { dot: { x: 100 * at, y: 5, w: 20, h: 20, op: 0.5 } })
    }
  }
  return { window, seeks }
}

test('the declared film arrives as plain data, with track as its type and nothing called', () => {
  const { window, seeks } = page()
  assert.deepEqual(JSON.parse(JSON.stringify(inPage(filmDeclaredScript(), window))), {
    present: true,
    kind: 'object',
    beats: [0, 1.5],
    cuts: [1.5],
    inFrame: { dot: [0, 4, 'whole'] },
    blur: true,
    track: 'function'
  })
  assert.deepEqual(seeks, [], 'reading the declaration must not seek')
})

test('a missing, null or non-object __film is reported as absent with what was there instead', () => {
  assert.deepEqual({ ...inPage<object>(filmDeclaredScript(), {}) }, { present: false, kind: 'undefined' })
  assert.deepEqual({ ...inPage<object>(filmDeclaredScript(), { __film: null }) }, { present: false, kind: 'null' })
  assert.deepEqual({ ...inPage<object>(filmDeclaredScript(), { __film: 3 }) }, { present: false, kind: 'number' })
})

test('a NaN in beats arrives as not-a-number rather than failing the read', () => {
  const { window } = page()
  ;(window['__film'] as { beats: unknown }).beats = [0, Number.NaN]
  const declared = inPage<{ present: boolean; beats: unknown[] }>(filmDeclaredScript(), window)
  assert.equal(declared.present, true)
  assert.equal(declared.beats[1], null)
})

type Tracked = { ok: boolean; why?: string; samples: { t: number; boxes?: Record<string, unknown>; threw?: string; message?: string; shape?: string }[]; purity: { t: number; via: number; first: { boxes: unknown }; again: { boxes: unknown } }[] }
const plain = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T

test('each time is seeked, then tracked, and a box comes back as five numbers', () => {
  const { window, seeks } = page()
  const result = plain(inPage<Tracked>(filmTrackScript('film', [0, 0.5, 2], []), window))
  assert.equal(result.ok, true)
  assert.deepEqual(seeks, [0, 0.5, 2], 'one seek per time, in order, before its track call')
  // x follows the SEEKED time, so a track call made before the seek would read the previous one.
  assert.deepEqual(result.samples, [
    { t: 0, boxes: { dot: [0, 5, 20, 20, 0.5] } },
    { t: 0.5, boxes: { dot: [50, 5, 20, 20, 0.5] } },
    { t: 2, boxes: { dot: [200, 5, 20, 20, 0.5] } }
  ])
})

test('op left out is 1; a NaN, a string or a missing field is null; an entry that is not a box is null', () => {
  const { window } = page(() => ({
    whole: { x: 1, y: 2, w: 3, h: 4 },
    broken: { x: Number.NaN, y: '2', w: 3, h: Infinity, op: 0 },
    point: [10, 20],
    gone: null
  }))
  const [sample] = plain(inPage<Tracked>(filmTrackScript('film', [1], []), window)).samples
  assert.deepEqual(sample!.boxes, {
    whole: [1, 2, 3, 4, 1],
    broken: [null, null, 3, null, 0],
    point: [null, null, null, null, 1],
    gone: null
  })
})

test('a throw from time or from track costs that sample only, and says which call it was', () => {
  const seeks: number[] = []
  const window = {
    __timelines: {
      film: {
        time: (t: number) => {
          if (t === 1) throw new Error('decode failed')
          seeks.push(t)
        }
      }
    },
    __film: {
      track: (t: number) => {
        if (t === 2) throw new TypeError('el is null')
        return t === 3 ? undefined : {}
      }
    }
  }
  const { samples } = plain(inPage<Tracked>(filmTrackScript('film', [0, 1, 2, 3, 4], []), window))
  assert.deepEqual(samples, [
    { t: 0, boxes: {} },
    { t: 1, threw: 'time', message: 'decode failed' },
    { t: 2, threw: 'track', message: 'el is null' },
    { t: 3, shape: 'undefined' },
    { t: 4, boxes: {} }
  ])
  assert.deepEqual(seeks, [0, 2, 3, 4])
})

test('a purity probe reads t, goes away, and reads t again — and catches a composition that accumulates', () => {
  const pure = page()
  const result = plain(inPage<Tracked>(filmTrackScript('film', [], [[1, 3]]), pure.window))
  assert.deepEqual(pure.seeks, [1, 3, 1])
  assert.deepEqual(result.purity[0]!.first.boxes, result.purity[0]!.again.boxes)
  assert.deepEqual([result.purity[0]!.t, result.purity[0]!.via], [1, 3])

  // A counter: every seek nudges the dot, so the second visit to t is somewhere else.
  let calls = 0
  const impure = page((t) => ({ dot: { x: 100 * t + (calls += 1), y: 5, w: 20, h: 20 } }))
  const drifted = plain(inPage<Tracked>(filmTrackScript('film', [], [[1, 3]]), impure.window)).purity[0]!
  assert.notDeepEqual(drifted.first.boxes, drifted.again.boxes)
})

test('with no timeline registered the track pass refuses by name instead of throwing', () => {
  const result = inPage<Tracked>(filmTrackScript('lower-third', [0], []), { __film: { track: () => ({}) } })
  assert.equal(result.ok, false)
  assert.equal(result.why, 'no timeline registered as lower-third')
})
