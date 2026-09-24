import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SUBTITLE_STYLES } from '@shared/subtitles'
import { hasModelFor, subtitleArgs } from './subtitleOptions'

const spotlight = SUBTITLE_STYLES.find((s) => s.id === 'spotlight')!
const punch = SUBTITLE_STYLES.find((s) => s.id === 'punch')!

test('untouched options send only the clip and design, so each design keeps its own look', () => {
  // The specimen must be able to fail: two designs whose defaults differ.
  assert.notEqual(spotlight.accent, punch.accent)
  for (const style of [spotlight, punch]) {
    const args = subtitleArgs({ itemId: 'itm_1', style, language: 'en', accent: null, scale: 1, bottom: null })
    assert.deepEqual(args, { itemId: 'itm_1', style: style.id })
  }
})

test('an accent picked equal to the design default is not pinned; a different one is sent', () => {
  const same = subtitleArgs({
    itemId: 'i',
    style: spotlight,
    language: 'en',
    accent: spotlight.accent.toLowerCase(),
    scale: 1,
    bottom: spotlight.bottom
  })
  assert.equal(same['accent'], undefined)
  assert.equal(same['bottom'], undefined)
  const changed = subtitleArgs({
    itemId: 'i',
    style: spotlight,
    language: 'fr',
    accent: '#FF0000',
    scale: 1.5,
    bottom: spotlight.bottom + 10
  })
  assert.deepEqual(changed, {
    itemId: 'i',
    style: 'spotlight',
    language: 'fr',
    accent: '#FF0000',
    scale: 1.5,
    bottom: spotlight.bottom + 10
  })
})

test('English-only models serve English and nothing else', () => {
  const englishOnly = ['ggml-base.en.bin', 'ggml-tiny.en.bin']
  assert.equal(hasModelFor(englishOnly, 'en'), true)
  assert.equal(hasModelFor(englishOnly, 'fr'), false)
  assert.equal(hasModelFor([...englishOnly, 'ggml-base.bin'], 'fr'), true)
  assert.equal(hasModelFor(['notes.txt'], 'en'), false)
})
