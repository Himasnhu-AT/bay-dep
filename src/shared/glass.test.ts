/**
 * `<glass>` as data: the schema, the presets, and the JSX element that produces it.
 *
 * The preset numbers are pinned as literals copied from quick-liquid 0.1.2's `MATERIAL_PRESETS`
 * rather than read through `GLASS_PRESETS`, so a typo in the copy fails here instead of being
 * carried into both sides of the assertion.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evaluateBrf, parseBrf, type DrawOp } from './brf'
import { GLASS_MATERIALS, GLASS_SAFE, resolveGlass } from './glass'
import { loadBrf, renderBrf } from './brf-code'

const doc = (layer: Record<string, unknown>) => ({ brf: 1, duration: 2, layers: [layer] })
const pane = (extra: Record<string, unknown> = {}) => ({ type: 'glass', x: 100, y: 100, w: 400, h: 200, radius: 24, ...extra })
const faultsOf = (layer: Record<string, unknown>) => {
  const parsed = parseBrf(doc(layer))
  return parsed.ok ? [] : parsed.faults
}
const glassOp = (layer: Record<string, unknown>, t = 1): Extract<DrawOp, { kind: 'glass' }> => {
  const parsed = parseBrf(doc(layer))
  assert.ok(parsed.ok, parsed.ok ? '' : JSON.stringify(parsed.faults))
  const op = evaluateBrf(parsed.doc, t, 1920, 1080).find((o) => o.kind === 'glass')
  assert.ok(op && op.kind === 'glass', 'the glass layer produced no glass op')
  return op
}

test('a glass layer with each material is accepted, and one with no material too', () => {
  for (const material of GLASS_MATERIALS) assert.deepEqual(faultsOf(pane({ material })), [], material)
  assert.deepEqual(faultsOf(pane()), [])
})

test('an unknown material is refused, naming every valid one and the likely intent', () => {
  // Positive control above: the same layer with a real material passes.
  const faults = faultsOf(pane({ material: 'frosted' }))
  assert.equal(faults.length, 1)
  assert.equal(faults[0]!.at, 'layers[0].material')
  for (const material of GLASS_MATERIALS) assert.match(faults[0]!.message, new RegExp(`\\b${material}\\b`), `names ${material}`)
  const typo = faultsOf(pane({ material: 'thicc' }))
  assert.match(typo[0]!.message, /did you mean "thick"/)
})

test('glass needs a size, and takes no fill — a misspelt prop is named', () => {
  assert.ok(faultsOf({ type: 'glass', x: 0, y: 0, material: 'thin' }).some((f) => /needs "w" and "h"/.test(f.message)))
  const fill = faultsOf(pane({ fill: '#fff' }))
  assert.equal(fill[0]?.at, 'layers[0].fill')
  const typo = faultsOf(pane({ tintOpactiy: 0.2 }))
  assert.match(typo[0]!.message, /did you mean "tintOpacity"/)
})

test('each number past its safe range is refused with what goes wrong there; inside it passes', () => {
  const cases: [keyof typeof GLASS_SAFE, number, number][] = [
    ['blur', 41, 40],
    ['tintOpacity', 0.61, 0.6],
    ['saturation', 2.6, 2.5],
    ['refraction', 61, 60],
    ['bezel', 121, 120],
    ['edgeHighlight', 1.1, 1]
  ]
  for (const [key, bad, good] of cases) {
    assert.deepEqual(faultsOf(pane({ [key]: good })), [], `${key} ${good} is inside the range`)
    const faults = faultsOf(pane({ [key]: bad }))
    assert.equal(faults.length, 1, `${key} ${bad}`)
    assert.equal(faults[0]!.at, `layers[0].${key}`)
    assert.ok(faults[0]!.message.includes(GLASS_SAFE[key].past), `${key}: says what looks wrong`)
  }
  // Keyed values are checked key by key.
  assert.equal(faultsOf(pane({ blur: [[0, 10], [1, 55]] })).length, 1)
  assert.deepEqual(faultsOf(pane({ blur: [[0, 10], [1, 30]] })), [])
  // `blur` stays unlimited on other layers: only glass has a frost.
  assert.deepEqual(parseBrf(doc({ type: 'rect', w: 10, h: 10, fill: '#fff', blur: 60 })).ok, true)
})

test('a tint is a colour or quick-liquid\'s "r, g, b"; anything else is refused', () => {
  assert.deepEqual(faultsOf(pane({ tint: '#102030' })), [])
  assert.deepEqual(faultsOf(pane({ tint: '20, 40, 40' })), [])
  assert.equal(faultsOf(pane({ tint: 'teal-ish' }))[0]?.at, 'layers[0].tint')
  assert.equal(faultsOf(pane({ tint: '300, 0, 0' }))[0]?.at, 'layers[0].tint')
})

test('a "$name" tint must name a declared var holding a colour, or the pane would go white', () => {
  const withVars = (vars: Record<string, unknown>, tint: string) => {
    const parsed = parseBrf({ brf: 1, duration: 2, vars, layers: [pane({ tint })] })
    return parsed.ok ? [] : parsed.faults
  }
  assert.deepEqual(withVars({ glassTint: '#0B0B0F' }, '$glassTint'), [], 'a declared colour passes')
  assert.deepEqual(withVars({ glassTint: '20, 40, 40' }, '$glassTint'), [], 'so does "r, g, b"')
  const missing = withVars({ glassTint: '#0B0B0F' }, '$glasTint')
  assert.equal(missing[0]?.at, 'layers[0].tint')
  assert.match(missing[0]!.message, /\$glasTint.*does not declare/)
  const notColour = withVars({ glassTint: 7 }, '$glassTint')
  assert.match(notColour[0]!.message, /\$glassTint is 7, not a colour/)
})

test('the presets are quick-liquid\'s numbers, and overrides win over them', () => {
  // quick-liquid 0.1.2 dist/chunk-4TLGP4GF.mjs, MATERIAL_PRESETS — copied by hand.
  const expected = {
    clear: { blur: 2, saturation: 1.55, tintOpacity: 0.03, refraction: 26, bezel: 36 },
    thin: { blur: 6, saturation: 1.5, tintOpacity: 0.05, refraction: 18, bezel: 26 },
    regular: { blur: 14, saturation: 1.7, tintOpacity: 0.09, refraction: 16, bezel: 30 },
    thick: { blur: 22, saturation: 1.8, tintOpacity: 0.13, refraction: 12, bezel: 28 },
    ultra: { blur: 30, saturation: 1.85, tintOpacity: 0.17, refraction: 10, bezel: 26 }
  }
  for (const [material, numbers] of Object.entries(expected)) {
    const look = resolveGlass(material as keyof typeof expected, {})
    for (const [key, value] of Object.entries(numbers)) assert.equal(look[key as keyof typeof numbers], value, `${material}.${key}`)
    assert.equal(look.edgeHighlight, 0.9, 'quick-liquid default edgeHighlight')
  }
  // No material is quick-liquid's most common frosted one.
  assert.equal(resolveGlass(undefined, {}).blur, 14)
  const custom = resolveGlass('clear', { blur: 9, tintOpacity: 0.3 })
  assert.equal(custom.blur, 9)
  assert.equal(custom.tintOpacity, 0.3)
  assert.equal(custom.refraction, 26, 'what was not overridden stays the preset')
  // A NaN would reach a canvas filter string and drop the whole chain: it falls back.
  assert.equal(resolveGlass('thick', { blur: Number.NaN }).blur, 22)
})

test('evaluation resolves the material into the op, the tint alpha carrying tintOpacity', () => {
  const op = glassOp(pane({ material: 'thick', tint: '20, 40, 40', tintOpacity: 0.5 }))
  assert.equal(op.look.blur, 22)
  assert.equal(op.look.tintOpacity, 0.5)
  assert.equal(op.look.tint, 'rgba(20,40,40,0.5)')
  assert.equal(op.w, 400)
  assert.equal(op.radius, 24)
  // The pane's own blur is zero: `blur` is its frost, not a blur of the pane.
  assert.equal(glassOp(pane({ blur: 30 })).blur, 0)
  assert.equal(glassOp(pane({ blur: 30 })).look.blur, 30)
  // Keyed: the frost at half way.
  assert.equal(glassOp(pane({ blur: [[0, 0], [2, 20, 'linear']] }), 1).look.blur, 10)
})

test('<glass> is a bay element in code, and a bad material there is refused by name', () => {
  const loaded = loadBrf(`export default () => (
    <scene duration={2}>
      <glass x="50%" y="50%" w="40%" h="20%" radius={32} material="ultra" />
      <text x="50%" y="50%" size="5%" fill="#0B0B0F">On glass</text>
    </scene>
  )`)
  assert.ok(loaded.ok, loaded.ok ? '' : loaded.error)
  const out = renderBrf(loaded.module, { frame: 0, fps: 30, width: 1920, height: 1080, vars: {} })
  assert.ok(out.ok, out.ok ? '' : out.error)
  assert.deepEqual(out.doc.layers.map((l) => l.type), ['glass', 'text'])

  const bad = loadBrf(`export default () => <scene duration={2}><glass w={10} h={10} material="milky" /></scene>`)
  assert.ok(bad.ok)
  const refused = renderBrf(bad.module, { frame: 0, fps: 30, width: 1920, height: 1080, vars: {} })
  assert.ok(!refused.ok)
  assert.match(refused.error, /material.*clear, thin, regular, thick, ultra/)
})

test('the guide states every safe range, its failure, and each preset row as the code has them', async () => {
  // The guide is what an agent reads; the validator is what refuses. Kept in one set of words.
  const { readFileSync } = await import('node:fs')
  const guide = readFileSync('src/main/mcp/docs/brf.md', 'utf8')
  const section = /## Glass\n([\s\S]*?)\n## /.exec(guide)?.[1]
  assert.ok(section, 'the guide has a "## Glass" section')
  for (const [key, safe] of Object.entries(GLASS_SAFE)) {
    assert.ok(section.includes(safe.past), `the guide says what goes wrong past ${key}: "${safe.past}"`)
    assert.ok(section.includes(`| \`${key}\` | ${safe.min}–${safe.max}`), `the guide gives ${key}'s range as ${safe.min}–${safe.max}`)
  }
  const { GLASS_PRESETS } = await import('./glass')
  for (const [material, p] of Object.entries(GLASS_PRESETS)) {
    const row = new RegExp(`\\| \`${material}\`[^|]*\\| ${p.blur} \\| ${p.saturation} \\| ${p.tintOpacity} \\| ${p.refraction} \\| ${p.bezel} \\|`)
    assert.match(section, row, `the ${material} row matches the preset`)
  }
})
