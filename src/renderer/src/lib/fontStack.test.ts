import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeFontStack } from './fontStack'

test('a typed family is quoted, so a name canvas cannot parse bare still reaches it', () => {
  assert.equal(normalizeFontStack('Archivo 2'), '"Archivo 2"')
  assert.equal(normalizeFontStack('  Archivo Black  '), '"Archivo Black"')
})

test('a stack keeps its order, its quotes and its bare generic fallbacks', () => {
  assert.equal(normalizeFontStack('"Helvetica Neue", Arial, sans-serif'), '"Helvetica Neue", "Arial", sans-serif')
  assert.equal(normalizeFontStack("'Inter', system-ui"), '"Inter", system-ui')
  // Quoted, a generic keyword is a family literally named that — kept as typed.
  assert.equal(normalizeFontStack('"serif"'), '"serif"')
})

test('what cannot be a stack is refused rather than written into ctx.font', () => {
  for (const bad of ['', '   ', ',', 'Inter; color: red', 'Inter}', '""']) {
    assert.equal(normalizeFontStack(bad), null, JSON.stringify(bad))
  }
  assert.equal(normalizeFontStack('Inter'), '"Inter"', 'positive control')
})
