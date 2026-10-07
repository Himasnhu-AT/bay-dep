/**
 * The effect catalog as a whole: every effect file is in the index, every declaration is one the
 * inspector, the agent's tool and the compositor can all use, and a stack that should cost nothing
 * resolves to nothing.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { hexToRgb } from '../grade'
import { describeCatalog, EFFECT_KINDS, EFFECTS, effectSpec, takesEffects } from './index'
import { checkParams, defaultParams, makeEffect } from './edit'
import { effectDraws, effectParamAt, effectParamPath, parseEffectParamPath, resolveEffects, resolveParams } from './resolve'
import type { Effect } from './spec'

const HERE = dirname(fileURLToPath(import.meta.url))
/** Files beside the catalog that are machinery, not effects. */
const NOT_EFFECTS = new Set(['index.ts', 'spec.ts', 'resolve.ts', 'edit.ts', 'math.ts'])

test('every effect file is in the index, under the kind its file is named for', () => {
  const files = readdirSync(HERE)
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts') && !NOT_EFFECTS.has(name))
    .map((name) => name.replace(/\.ts$/, ''))
    .sort()
  assert.ok(files.length >= 10, `expected the catalog's files, found ${files.length}`)
  assert.deepEqual([...EFFECT_KINDS].sort(), files, 'an effect file missing from index.ts is an effect nobody can add')
  assert.equal(new Set(EFFECT_KINDS).size, EFFECT_KINDS.length, 'two effects share a kind')
})

test('every parameter declares a usable range and a default inside it', () => {
  for (const spec of EFFECTS) {
    assert.match(spec.kind, /^[a-z]+(-[a-z]+)*$/, spec.kind)
    assert.ok(spec.label.length > 0 && spec.description.length > 40, `${spec.kind} needs a description that says when to use it`)
    assert.ok(Object.keys(spec.params).length > 0, `${spec.kind} has no parameters`)
    for (const [name, param] of Object.entries(spec.params)) {
      const where = `${spec.kind}.${name}`
      // A property path must be able to name it (`effects[id].name`).
      assert.match(name, /^[a-z][A-Za-z0-9]*$/, where)
      assert.ok(param.label.length > 0 && param.description.length > 0, where)
      if (param.type === 'number') {
        assert.ok(param.min < param.max && param.step > 0, `${where} range`)
        assert.ok(param.default >= param.min && param.default <= param.max, `${where} default ${param.default} is outside ${param.min}..${param.max}`)
      } else if (param.type === 'color') {
        assert.ok(hexToRgb(param.default), `${where} default ${param.default} is not a hex colour`)
      } else if (param.type === 'point') {
        assert.ok(param.default.every((v) => v >= 0 && v <= 1), `${where} default`)
      }
    }
    // The defaults are what "add this effect" stores, so they must be values the tool would accept.
    assert.deepEqual(checkParams(spec, defaultParams(spec)), defaultParams(spec), `${spec.kind} defaults`)
  }
})

test('a freshly added effect draws: the defaults are never the identity', () => {
  // An effect dragged onto a clip that then looks no different reads as a broken effect.
  for (const spec of EFFECTS) {
    assert.equal(spec.isIdentity(resolveParams(spec, defaultParams(spec))), false, `${spec.kind} at its defaults does nothing`)
    assert.equal(effectDraws(makeEffect(spec.kind, undefined, 'fx_1')), true, spec.kind)
  }
})

/** The value of each effect's "off" parameter, where it has one. */
const OFF: Record<string, Record<string, number | boolean>> = {
  'directional-blur': { length: 0 },
  'zoom-blur': { amount: 0 },
  sharpen: { amount: 0 },
  glow: { amount: 0 },
  'chromatic-aberration': { amount: 0 },
  pixelate: { size: 1 },
  glitch: { amount: 0 },
  duotone: { amount: 0 },
  tint: { amount: 0 },
  flip: { horizontal: false, vertical: false }
}

test('an effect at its off value, switched off, or absent resolves to no pass at all', () => {
  assert.equal(resolveEffects(undefined), null)
  assert.equal(resolveEffects([]), null)
  for (const [kind, off] of Object.entries(OFF)) {
    const spec = effectSpec(kind)
    assert.ok(spec, kind)
    const identity: Effect = { id: 'fx_off', kind, params: { ...defaultParams(spec), ...off } }
    assert.equal(resolveEffects([identity]), null, `${kind} at ${JSON.stringify(off)} must not run a pass`)
    // The pair: the same effect one step off its identity does run.
    const on: Effect = { id: 'fx_on', kind, params: defaultParams(spec) }
    assert.equal(resolveEffects([on])?.active.length, 1, `${kind} at its defaults must run`)
    assert.equal(resolveEffects([{ ...on, enabled: false }]), null, `${kind} switched off must not run`)
    assert.equal(resolveEffects([{ ...on, enabled: true }])?.active.length, 1)
  }
  // Every effect either has an off value above or says it has none.
  for (const spec of EFFECTS) {
    if (OFF[spec.kind]) continue
    assert.ok(['mirror', 'chroma-key'].includes(spec.kind), `${spec.kind} has no off value listed in this test`)
  }
  // A whole stack of nothing is nothing — not an empty list the compositor would still set up for.
  const idle = Object.entries(OFF).map(([kind, off], i): Effect => ({ id: `fx_${i}`, kind, params: off }))
  assert.equal(resolveEffects(idle), null)
})

test('the stack is drawn in the order it is stored', () => {
  const stack: Effect[] = [
    makeEffect('chroma-key', undefined, 'fx_a'),
    makeEffect('glow', undefined, 'fx_b'),
    { ...makeEffect('pixelate', undefined, 'fx_c'), enabled: false },
    makeEffect('flip', undefined, 'fx_d')
  ]
  assert.deepEqual(resolveEffects(stack)?.active.map((e) => e.id), ['fx_a', 'fx_b', 'fx_d'])
  assert.deepEqual(resolveEffects([...stack].reverse())?.active.map((e) => e.id), ['fx_d', 'fx_b', 'fx_a'])
})

test('a stored value that cannot be drawn falls back per parameter, and an unknown effect is reported', () => {
  const glow = effectSpec('glow')
  assert.ok(glow)
  const params = resolveParams(glow, { amount: Number.NaN, radius: 1e9, threshold: -4, color: 'not a colour', extra: 1 })
  assert.equal(params.amount, 0.6, 'a NaN reads as the default, not as NaN in a uniform')
  assert.equal(params.radius, 200, 'clamped to the range, which bounds the shader loop')
  assert.equal(params.threshold, 0)
  assert.deepEqual(params.color, [1, 1, 1])
  assert.equal('extra' in params, false)
  // One bad value must not take the effect down with it.
  assert.equal(resolveEffects([{ id: 'fx', kind: 'glow', params: { amount: Number.NaN } }])?.active.length, 1)

  // A kind from a newer build: skipped, and said so, while the effects it does know still draw.
  const mixed = resolveEffects([
    { id: 'fx_new', kind: 'lens-flare', params: {} },
    makeEffect('flip', undefined, 'fx_flip')
  ])
  assert.deepEqual(mixed?.active.map((e) => e.kind), ['flip'])
  assert.equal(mixed?.issues.length, 1)
  assert.match(mixed?.issues[0] ?? '', /lens-flare/)
  // Switched off, an unknown effect is nobody's problem.
  assert.equal(resolveEffects([{ id: 'fx_new', kind: 'lens-flare', enabled: false, params: {} }]), null)
  // Alone, it is still something to report — null would have hidden it.
  assert.equal(resolveEffects([{ id: 'fx_new', kind: 'lens-flare', params: {} }])?.issues.length, 1)
})

test('a parameter is addressable by a path that survives reordering', () => {
  const stack = [makeEffect('glow', { amount: 0.9 }, 'fx_1a2b'), makeEffect('zoom-blur', undefined, 'fx_3c4d')]
  const path = effectParamPath('fx_1a2b', 'amount')
  assert.equal(path, 'effects[fx_1a2b].amount')
  assert.deepEqual(parseEffectParamPath(path), { effectId: 'fx_1a2b', param: 'amount' })
  assert.equal(effectParamAt(stack, path)?.value, 0.9)
  assert.equal(effectParamAt([...stack].reverse(), path)?.value, 0.9)
  assert.deepEqual(effectParamAt(stack, 'effects[fx_3c4d].centre')?.value, [0.5, 0.5])
  // Paths that name nothing.
  assert.equal(effectParamAt(stack, 'effects[fx_1a2b].nope'), null)
  assert.equal(effectParamAt(stack, 'effects[fx_zzzz].amount'), null)
  assert.equal(parseEffectParamPath('layout.left'), null)
  // Every parameter of every effect has such a path.
  for (const spec of EFFECTS) {
    const effect = makeEffect(spec.kind, undefined, 'fx_x')
    for (const name of Object.keys(spec.params)) {
      assert.ok(effectParamAt([effect], effectParamPath('fx_x', name)), `${spec.kind}.${name}`)
    }
  }
})

test('the catalog text an agent reads names every effect and every parameter with its range', () => {
  const text = describeCatalog()
  for (const spec of EFFECTS) {
    const line = text.split('\n').find((candidate) => candidate.startsWith(`${spec.kind} — `))
    assert.ok(line, `${spec.kind} is missing from the catalog text`)
    for (const [name, param] of Object.entries(spec.params)) {
      assert.ok(line.includes(name), `${spec.kind}.${name}`)
      if (param.type === 'number') assert.ok(line.includes(`${param.min}..${param.max}`), `${spec.kind}.${name} range`)
    }
  }
})

test('effects go on picture clips and nothing else', () => {
  for (const kind of ['video', 'image', 'gif', 'html', 'brf']) assert.equal(takesEffects(kind), true, kind)
  for (const kind of ['text', 'audio', 'lut', 'font', undefined]) assert.equal(takesEffects(kind), false, String(kind))
})
