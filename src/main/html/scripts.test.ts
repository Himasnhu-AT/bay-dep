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
import { seekScript, variablesScript } from './scripts'

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
