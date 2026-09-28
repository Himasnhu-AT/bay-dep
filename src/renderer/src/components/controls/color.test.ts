import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normaliseHex } from './color'

test('a hex is read with or without its hash, in three digits or six, and stored upper-case', () => {
  assert.equal(normaliseHex('#abc'), '#AABBCC')
  assert.equal(normaliseHex('abc'), '#AABBCC')
  assert.equal(normaliseHex(' #ff0055 '), '#FF0055')
  assert.equal(normaliseHex('FF0055'), '#FF0055')
})

test('anything that is not a hex colour is refused rather than committed', () => {
  assert.equal(normaliseHex('#ff005'), null)
  assert.equal(normaliseHex('red'), null)
  assert.equal(normaliseHex('#ggg'), null)
  assert.equal(normaliseHex(''), null)
})
