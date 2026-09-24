import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SUBTITLE_STYLES } from '@shared/subtitles'
import { describeSubtitleStyle, hasModelFor, subtitleArgs } from './subtitleOptions'

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

test('the description stops naming a colour once another highlight is picked', () => {
  // The specimen names its colour, so the replacement has something to replace.
  assert.match(spotlight.description, /sky blue/)
  assert.equal(describeSubtitleStyle(spotlight, null), spotlight.description)
  assert.equal(describeSubtitleStyle(spotlight, spotlight.accent.toLowerCase()), spotlight.description, 'the default, however spelled')
  const picked = describeSubtitleStyle(spotlight, '#FF3366')
  assert.doesNotMatch(picked, /sky blue/)
  assert.match(picked, /the highlight colour you picked/)
  // Every design that names its colour declares which words those are, so none can go stale.
  for (const style of SUBTITLE_STYLES) {
    for (const colour of ['sky blue', 'yellow', 'red', 'green', 'mint', 'blue']) {
      const word = new RegExp(`\\b${colour}\\b`)
      if (word.test(style.description)) {
        assert.ok(style.accentName?.includes(colour), `${style.name} names "${colour}" without declaring it`)
        assert.doesNotMatch(describeSubtitleStyle(style, '#123456'), word)
      }
    }
  }
})
