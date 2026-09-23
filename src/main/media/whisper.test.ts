/**
 * Choosing a whisper.cpp model. Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pickWhisperModel } from './whisper'

const models = [
  '/m/ggml-tiny.en.bin',
  '/m/ggml-base.en.bin',
  '/m/ggml-base.bin',
  '/m/ggml-large-v3.bin',
  '/m/for-tests-ggml-tiny.bin',
  '/m/notes.txt'
]

test('English prefers the English-only model of the preferred size', () => {
  assert.equal(pickWhisperModel(models, 'en'), '/m/ggml-base.en.bin')
})

test('another language, or auto-detect, never gets an English-only model', () => {
  // A .en model given French transcribes it as English nonsense, with no error.
  assert.equal(pickWhisperModel(models, 'fr'), '/m/ggml-base.bin')
  assert.equal(pickWhisperModel(models, 'auto'), '/m/ggml-base.bin')
  assert.equal(pickWhisperModel(['/m/ggml-base.en.bin'], 'fr'), null)
})

test('test fixtures and non-models are never chosen', () => {
  assert.equal(pickWhisperModel(['/m/for-tests-ggml-tiny.bin', '/m/notes.txt'], 'en'), null)
  // Positive control: a real model beside them is.
  assert.equal(pickWhisperModel(['/m/for-tests-ggml-tiny.bin', '/m/ggml-tiny.bin'], 'en'), '/m/ggml-tiny.bin')
})

test('with only a large model, it is used rather than nothing', () => {
  assert.equal(pickWhisperModel(['/m/ggml-large-v3.bin'], 'en'), '/m/ggml-large-v3.bin')
})
