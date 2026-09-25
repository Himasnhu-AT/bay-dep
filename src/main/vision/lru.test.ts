import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ByteLru } from './lru'

const sized = (budget: number): ByteLru<string> => new ByteLru<string>(budget, (_key, value) => value.length)

test('the least recently used entry goes first once the bytes pass the budget', () => {
  const lru = sized(10)
  lru.set('a', 'xxxx')
  lru.set('b', 'xxxx')
  assert.equal(lru.get('a'), 'xxxx', 'reading a makes b the oldest')
  lru.set('c', 'xxxx')
  assert.equal(lru.get('b'), undefined, 'b was evicted')
  assert.equal(lru.get('a'), 'xxxx')
  assert.equal(lru.get('c'), 'xxxx')
  assert.equal(lru.bytes, 8)
  assert.ok(lru.bytes <= 10)
})

test('replacing an entry counts its bytes once; an entry larger than the budget is not kept', () => {
  const lru = sized(10)
  lru.set('a', 'xxxx')
  lru.set('a', 'xxxxxx')
  assert.equal(lru.bytes, 6)
  lru.set('huge', 'x'.repeat(11))
  assert.equal(lru.get('huge'), undefined)
  assert.equal(lru.get('a'), 'xxxxxx', 'a too-large entry evicts nothing')
})

test('clear empties it and its byte count', () => {
  const lru = sized(10)
  lru.set('a', 'xx')
  lru.clear()
  assert.equal(lru.size, 0)
  assert.equal(lru.bytes, 0)
  assert.equal(lru.get('a'), undefined)
})
