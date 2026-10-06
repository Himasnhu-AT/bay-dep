/**
 * Changing an effect stack: what is refused, what the refusal tells the caller, and the nearest
 * legal call beside each refusal — a checker that refused everything would pass a list of
 * refusals alone.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EFFECT_KINDS, MAX_EFFECTS } from './index'
import { applyEffectOps, EffectEditError, makeEffect } from './edit'
import type { Effect } from './spec'

function ids(): () => string {
  let n = 0
  return () => `fx_${(n += 1)}`
}

function refusal(current: Effect[] | undefined, operations: unknown): string {
  try {
    applyEffectOps(current, operations, ids())
  } catch (error) {
    if (error instanceof EffectEditError) return error.message
    throw error
  }
  assert.fail(`expected ${JSON.stringify(operations)} to be refused`)
}

const apply = (current: Effect[] | undefined, operations: unknown): Effect[] => applyEffectOps(current, operations, ids()).effects

test('a number outside its range is refused with the range; the bounds themselves are accepted', () => {
  const message = refusal(undefined, [{ op: 'add', kind: 'glow', params: { amount: 2.5 } }])
  assert.match(message, /glow\.amount/)
  assert.match(message, /from 0 to 2/, 'the refusal must say what would have been accepted')
  assert.match(message, /got 2\.5/)
  assert.match(message, /^operations\[0\]/, 'and which operation it was')
  // The pair: the largest and smallest legal values go through and are stored as given.
  assert.equal(apply(undefined, [{ op: 'add', kind: 'glow', params: { amount: 2 } }])[0]?.params.amount, 2)
  assert.equal(apply(undefined, [{ op: 'add', kind: 'glow', params: { amount: 0 } }])[0]?.params.amount, 0)

  assert.match(refusal(undefined, [{ op: 'add', kind: 'pixelate', params: { size: 0 } }]), /pixelate\.size must be a number from 1 to 400 \(px\)/)
  for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, '0.5', null]) {
    assert.match(refusal(undefined, [{ op: 'add', kind: 'glow', params: { amount: bad } }]), /glow\.amount must be a number from 0 to 2/, String(bad))
  }
})

test('colours, points and switches are refused in their own terms, and accepted when well formed', () => {
  assert.match(refusal(undefined, [{ op: 'add', kind: 'chroma-key', params: { color: 'green' } }]), /chroma-key\.color must be a hex colour such as "#00B140"/)
  assert.equal(apply(undefined, [{ op: 'add', kind: 'chroma-key', params: { color: '#00ff00' } }])[0]?.params.color, '#00FF00')

  const point = refusal(undefined, [{ op: 'add', kind: 'zoom-blur', params: { centre: [0.5, 1.2] } }])
  assert.match(point, /zoom-blur\.centre must be a point \[x, y\], each from 0 to 1/)
  assert.match(refusal(undefined, [{ op: 'add', kind: 'zoom-blur', params: { centre: 0.5 } }]), /zoom-blur\.centre must be a point/)
  assert.deepEqual(apply(undefined, [{ op: 'add', kind: 'zoom-blur', params: { centre: [0, 1] } }])[0]?.params.centre, [0, 1])

  assert.match(refusal(undefined, [{ op: 'add', kind: 'flip', params: { vertical: 1 } }]), /flip\.vertical must be true or false/)
  assert.equal(apply(undefined, [{ op: 'add', kind: 'flip', params: { vertical: true } }])[0]?.params.vertical, true)
})

test('an unknown effect or parameter is refused naming the real ones', () => {
  const kind = refusal(undefined, [{ op: 'add', kind: 'gaussian-blur' }])
  for (const real of EFFECT_KINDS) assert.ok(kind.includes(real), `the refusal must list ${real}`)
  const param = refusal(undefined, [{ op: 'add', kind: 'sharpen', params: { strength: 1 } }])
  assert.match(param, /sharpen has no parameter "strength"/)
  assert.match(param, /amount 0\.\.3/)
  assert.match(param, /radius 0\.5\.\.10px/)
  // The pair.
  assert.equal(apply(undefined, [{ op: 'add', kind: 'sharpen', params: { amount: 1 } }])[0]?.kind, 'sharpen')
})

test('add stores every parameter, so a later change to a default cannot change a picture already made', () => {
  const [effect] = apply(undefined, [{ op: 'add', kind: 'glitch', params: { amount: 0.8 } }])
  assert.deepEqual(effect, { id: 'fx_1', kind: 'glitch', params: { amount: 0.8, blockSize: 40, hold: 3, rgbSplit: 8, seed: 0 } })
  assert.equal('enabled' in (effect ?? {}), false, 'on is stored as absence')
  assert.equal(apply(undefined, [{ op: 'add', kind: 'glitch', enabled: false }])[0]?.enabled, false)
})

test('add goes last unless an index says where; move, update, remove and clear do what they say', () => {
  const base = apply(undefined, [
    { op: 'add', kind: 'chroma-key' },
    { op: 'add', kind: 'glow' },
    { op: 'add', kind: 'flip', index: 0 }
  ])
  assert.deepEqual(base.map((e) => e.kind), ['flip', 'chroma-key', 'glow'])
  const glow = base[2]?.id ?? ''
  const flip = base[0]?.id ?? ''

  assert.deepEqual(apply(base, [{ op: 'move', effectId: glow, toIndex: 0 }]).map((e) => e.kind), ['glow', 'flip', 'chroma-key'])
  assert.deepEqual(apply(base, [{ op: 'move', effectId: flip, toIndex: 2 }]).map((e) => e.kind), ['chroma-key', 'glow', 'flip'])
  assert.deepEqual(apply(base, [{ op: 'remove', effectId: glow }]).map((e) => e.kind), ['flip', 'chroma-key'])
  assert.deepEqual(apply(base, [{ op: 'clear' }]), [])

  // update merges: the parameters not named keep what they had.
  const updated = apply(base, [{ op: 'update', effectId: glow, params: { amount: 1.5 } }])[2]
  assert.equal(updated?.params.amount, 1.5)
  assert.equal(updated?.params.radius, 16)
  // Off and back on; on is stored as absence so the document is what it was.
  const off = apply(base, [{ op: 'update', effectId: glow, enabled: false }])
  assert.equal(off[2]?.enabled, false)
  assert.deepEqual(apply(off, [{ op: 'update', effectId: glow, enabled: true }]), base)

  // The input is never changed in place: the store's undo snapshot shares it.
  assert.equal(base[2]?.params.amount, 0.6)
})

test('an effect is found by id or an unambiguous prefix, and a miss names what the clip has', () => {
  const base = [makeEffect('glow', undefined, 'fx_ab12'), makeEffect('flip', undefined, 'fx_ab99'), makeEffect('tint', undefined, 'fx_zz01')]
  assert.equal(apply(base, [{ op: 'remove', effectId: 'fx_zz' }]).length, 2)
  const ambiguous = refusal(base, [{ op: 'remove', effectId: 'fx_ab' }])
  assert.match(ambiguous, /matches 2 effects/)
  const missing = refusal(base, [{ op: 'update', effectId: 'fx_nope', enabled: false }])
  assert.match(missing, /No effect "fx_nope" on this clip/)
  for (const effect of base) assert.ok(missing.includes(effect.id) && missing.includes(effect.kind), `the refusal must offer ${effect.id}`)
  assert.match(refusal(undefined, [{ op: 'remove', effectId: 'fx_ab12' }]), /This clip has no effects/)
  assert.match(refusal(base, [{ op: 'remove' }]), /effectId is required/)
})

test('a batch is all or nothing, and the refusal names the operation that failed', () => {
  const base = [makeEffect('glow', undefined, 'fx_keep')]
  const message = refusal(base, [
    { op: 'add', kind: 'flip' },
    { op: 'update', effectId: 'fx_keep', params: { radius: 9999 } }
  ])
  assert.match(message, /^operations\[1\]: glow\.radius must be a number from 0\.5 to 200/)
  assert.deepEqual(base, [makeEffect('glow', undefined, 'fx_keep')], 'the stack given was not touched')
})

test('malformed operations are refused with what to send', () => {
  assert.match(refusal(undefined, []), /operations must be a non-empty list/)
  assert.match(refusal(undefined, 'add glow'), /operations must be a non-empty list/)
  assert.match(refusal(undefined, [{ op: 'apply', kind: 'glow' }]), /"op" must be one of add, update, move, remove, clear/)
  assert.match(refusal(undefined, ['glow']), /must be an object with an "op"/)
  const base = [makeEffect('glow', undefined, 'fx_1a')]
  assert.match(refusal(base, [{ op: 'update', effectId: 'fx_1a' }]), /needs params, enabled, or both/)
  assert.match(refusal(base, [{ op: 'move', effectId: 'fx_1a', toIndex: 1 }]), /toIndex must be a whole number from 0 .* to 0/)
  assert.match(refusal(base, [{ op: 'add', kind: 'flip', index: 2 }]), /index must be a whole number from 0 .* to 1/)
  assert.equal(apply(base, [{ op: 'add', kind: 'flip', index: 1 }]).length, 2)
})

test('a clip takes a bounded number of effects', () => {
  const full = Array.from({ length: MAX_EFFECTS }, (_, i) => makeEffect('flip', undefined, `fx_${i}`))
  assert.match(refusal(full, [{ op: 'add', kind: 'glow' }]), new RegExp(`at most ${MAX_EFFECTS} effects`))
  assert.equal(apply(full.slice(1), [{ op: 'add', kind: 'glow' }]).length, MAX_EFFECTS)
  // Removing one first, in the same batch, makes room.
  assert.equal(apply(full, [{ op: 'remove', effectId: 'fx_0' }, { op: 'add', kind: 'glow' }]).length, MAX_EFFECTS)
})

test('an effect from a newer build can be switched off or removed, but not given parameters', () => {
  const base: Effect[] = [{ id: 'fx_new', kind: 'lens-flare', params: { strength: 2 } }]
  assert.match(refusal(base, [{ op: 'update', effectId: 'fx_new', params: { strength: 1 } }]), /which this build of bay does not have/)
  assert.equal(apply(base, [{ op: 'update', effectId: 'fx_new', enabled: false }])[0]?.enabled, false)
  assert.deepEqual(apply(base, [{ op: 'remove', effectId: 'fx_new' }]), [])
})
