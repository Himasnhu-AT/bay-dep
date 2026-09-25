/**
 * The tokenizer's rules, on a vocabulary small enough to reason about by hand. The real
 * `tokenizer.json` is checked against reference ids in `model.test.ts` (skipped loudly without
 * the model); this file needs nothing downloaded.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { canonicalize, EOS_ID, loadTokenizer, TEXT_TOKENS } from './tokenizer'

test('canonicalize: lowercase, punctuation dropped without a space, whitespace collapsed', () => {
  // The Rust engine's cases, which were checked against the Python SiglipTokenizer.
  assert.equal(canonicalize('The Bank of England!'), 'the bank of england')
  assert.equal(canonicalize('  spaced   out  '), 'spaced out')
  assert.equal(canonicalize('state-owned'), 'stateowned')
  assert.equal(canonicalize('200,000,000,000'), '200000000000')
  assert.equal(canonicalize(''), '')
  assert.equal(canonicalize('!!!'), '')
  // Letters beyond ASCII are letters.
  assert.equal(canonicalize('Zürich Café'), 'zürich café')
})

// ▁ is SentencePiece's word marker. Scores are log-probabilities: higher is likelier.
const vocab: [string, number][] = [
  ['<pad>', 0],
  ['</s>', 0],
  ['<unk>', 0],
  ['▁', -2],
  ['a', -3],
  ['▁dog', -4],
  ['▁do', -5],
  ['g', -5],
  ['▁d', -6],
  ['o', -6],
  ['▁red', -4],
  ['re', -5]
]
const tok = loadTokenizer({ model: { type: 'Unigram', unk_id: 2, vocab } })

test('Unigram picks the segmentation with the best total score, not the greedy longest match', () => {
  // "▁dog" as one piece scores -4; "▁do"+"g" is -10; "▁d"+"o"+"g" is -17.
  assert.deepEqual(tok.pieces('dog'), ['▁dog'])
  // Positive control that the scores are what decide: with "▁dog" made unlikely the split changes.
  const worse = loadTokenizer({ model: { type: 'Unigram', unk_id: 2, vocab: vocab.map(([p, s]) => [p, p === '▁dog' ? -20 : s]) } })
  assert.deepEqual(worse.pieces('dog'), ['▁do', 'g'])
})

test('input is canonicalised before tokenising: capitals and punctuation make the same ids', () => {
  assert.deepEqual(tok.encode('A Dog!'), tok.encode('a dog'))
  assert.deepEqual(tok.pieces('a dog'), ['▁', 'a', '▁dog'])
})

test('ids end with </s> and pad to exactly 64 with </s>', () => {
  const ids = tok.encode('a dog')
  assert.equal(ids.length, TEXT_TOKENS)
  assert.deepEqual(ids.slice(0, 4), [3, 4, 5, EOS_ID])
  assert.ok(ids.slice(4).every((id) => id === EOS_ID))
  assert.deepEqual(tok.encode('').slice(0, 2), [EOS_ID, EOS_ID])
})

test('a text past 63 pieces is cut, and still ends with </s>', () => {
  const ids = tok.encode('dog '.repeat(100))
  assert.equal(ids.length, TEXT_TOKENS)
  assert.equal(ids[TEXT_TOKENS - 1], EOS_ID)
  assert.equal(ids[TEXT_TOKENS - 2], 5)
})

test('characters no piece covers become one <unk>, however many there are', () => {
  const pieces = tok.encode('dog xyz')
  // "▁dog", then "▁" (known) and x, y, z (unknown) fused to one <unk>.
  assert.deepEqual(pieces.slice(0, 4), [5, 3, 2, EOS_ID])
})

test('a file that is not a Unigram model is refused, saying how to repair it', () => {
  assert.throws(() => loadTokenizer({ model: { type: 'BPE', vocab: [] } }), /Settings › Visual search/)
  assert.throws(() => loadTokenizer('{}'), /not a SentencePiece Unigram model/)
})
