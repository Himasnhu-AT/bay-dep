/**
 * The speech-length estimator against hand-counted text. The rates are the published figures the
 * module header names, spelt out here as literals so a changed constant fails by name.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  detectLanguage,
  englishWordSyllables,
  estimateSpeech,
  integerSyllables,
  numberSyllables,
  spanishWordSyllables
} from './speech-duration'

test('the published rates: 60 English syllables are 13.04s normal, 10.71s fast, 14.29s slow', () => {
  const sixty = Array.from({ length: 60 }, () => 'cat').join(' ')
  const normal = estimateSpeech(sixty, { language: 'en' })
  assert.equal(normal.units, 60)
  assert.equal(normal.unit, 'syllables')
  assert.equal(normal.seconds, 13.04)
  assert.equal(estimateSpeech(sixty, { language: 'en', pace: 'fast' }).seconds, 10.71)
  assert.equal(estimateSpeech(sixty, { language: 'en', pace: 'slow' }).seconds, 14.29)
  assert.deepEqual(normal.range, { slow: 14.29, fast: 10.71 })
})

test('English words: hand-counted syllables, including the silent-e, -ed, -es and hiatus cases', () => {
  const words: Record<string, number> = {
    the: 1, over: 2, lazy: 2, table: 2, make: 1, free: 1, jumped: 1, wanted: 2, boxes: 2, makes: 1,
    judges: 2, idea: 3, video: 3, create: 2, quiet: 2, radio: 3, special: 2, nation: 2, yellow: 2,
    people: 2, timeline: 2, something: 2, going: 2, player: 2, area: 3, introducing: 4, available: 4
  }
  const wrong = Object.entries(words).filter(([w, n]) => englishWordSyllables(w) !== n)
  assert.deepEqual(wrong.map(([w, n]) => `${w}: ${englishWordSyllables(w)} not ${n}`), [])
})

test('a realistic voiceover line lands within two syllables of a hand count', () => {
  // Hand-counted: 24 + 14 = 38 syllables.
  const text =
    'Every morning, millions of people open their laptops and start the same fight with their inbox. ' +
    'Today we are introducing a calmer way to work.'
  const estimate = estimateSpeech(text)
  assert.equal(estimate.language, 'en')
  assert.equal(estimate.detected, true)
  assert.ok(Math.abs(estimate.units - 38) <= 2, `counted ${estimate.units}`)
  assert.ok(Math.abs(estimate.seconds - 38 / 4.6) < 0.5, `${estimate.seconds}s`)
  assert.equal(estimate.breakdown.pauses, 0, 'the syllable rates already include phrasing pauses')
})

test('numbers are counted as they are read aloud, not skipped', () => {
  assert.equal(integerSyllables('0'), 2)
  assert.equal(integerSyllables('100'), 3) // one hun-dred
  assert.equal(integerSyllables('1000000'), 3) // one mil-lion
  assert.equal(numberSyllables('2026'), 5) // twen-ty twen-ty-six
  assert.equal(numberSyllables('1999'), 5) // nine-teen nine-ty-nine
  assert.equal(numberSyllables('2005'), 4) // twen-ty oh five
  assert.equal(numberSyllables('1,200'), 6) // one thou-sand two hun-dred
  assert.equal(numberSyllables('45%'), 5) // for-ty-five per-cent
  assert.equal(numberSyllables('$20'), 4) // twen-ty dol-lars
  assert.equal(numberSyllables('3.5'), 3) // three point five
  // The observable: a sentence with a figure takes longer than the same sentence without it.
  const without = estimateSpeech('We sold units last year.', { language: 'en' })
  const withNumber = estimateSpeech('We sold 1,200 units last year.', { language: 'en' })
  assert.equal(withNumber.units - without.units, 6)
  assert.ok(withNumber.breakdown.numbers > 0)
})

test('acronyms: short or vowel-less ones are spelt out, word-like ones are read as words', () => {
  const api = estimateSpeech('API', { language: 'en' })
  assert.equal(api.units, 3)
  assert.equal(estimateSpeech('WWW', { language: 'en' }).units, 9) // dou-ble-u ×3
  assert.equal(estimateSpeech('NASA', { language: 'en' }).units, 2)
  assert.equal(estimateSpeech('HTML', { language: 'en' }).units, 4)
})

test('Chinese: OpenCreator’s character rate plus punctuation pauses', () => {
  // 15 characters (13 Han + two marks) / 4.2 = 3.571; comma 0.22×0.30 + stop 0.28×0.30 = 0.15.
  const zh = estimateSpeech('你好，这是当前音色的试听效果。')
  assert.equal(zh.language, 'zh')
  assert.equal(zh.unit, 'characters')
  assert.equal(zh.units, 15)
  assert.equal(zh.seconds, 3.72)
  assert.equal(zh.breakdown.pauses, 0.15)
  // Pace: fast is 1.25× the rate, slow 0.8×.
  assert.ok(Math.abs(zh.range.fast - (15 / (4.2 * 1.25) + 0.15)) < 0.011)
  assert.ok(Math.abs(zh.range.slow - (15 / (4.2 * 0.8) + 0.15)) < 0.011)
})

test('Latin words inside Chinese are English syllables, not letters', () => {
  // 用 做 视 频 = 4 characters at 4.2/s; "video" = 3 syllables at 4.6/s → 0.952 + 0.652.
  const mixed = estimateSpeech('用 video 做视频')
  assert.equal(mixed.language, 'zh')
  assert.equal(mixed.seconds, 1.6)
  // Counting the letters as characters would have said 9/4.2 = 2.14s.
  assert.ok(mixed.seconds < 9 / 4.2 - 0.3)
})

test('German: characters at 11.8/s with pause weights', () => {
  // 25 non-space characters / 11.8 = 2.119; comma 0.22×0.24; question 0.28×0.24 → 2.24.
  const de = estimateSpeech('Guten Morgen, wie geht es dir?', { language: 'de' })
  assert.equal(de.unit, 'characters')
  assert.equal(de.units, 25)
  assert.equal(de.seconds, 2.24)
})

test('Spanish: vowel nuclei, with strong-vowel and stressed í/ú hiatus', () => {
  const words: Record<string, number> = { hola: 2, que: 1, bien: 1, ciudad: 2, día: 2, país: 2, leer: 2, poeta: 3, cuidado: 3, teléfono: 4, muy: 1 }
  const wrong = Object.entries(words).filter(([w, n]) => spanishWordSyllables(w) !== n)
  assert.deepEqual(wrong.map(([w, n]) => `${w}: ${spanishWordSyllables(w)} not ${n}`), [])
  const es = estimateSpeech('Hola, ¿cómo estás? Me llamo Ana y vivo en la ciudad.')
  assert.equal(es.language, 'es')
  assert.equal(es.ratePerSecond, 5.9)
})

test('language detection, and an explicit language overrides it', () => {
  assert.equal(detectLanguage('こんにちは、世界'), 'ja')
  assert.equal(detectLanguage('안녕하세요 여러분'), 'ko')
  assert.equal(detectLanguage('Привет, как дела?'), 'ru')
  assert.equal(detectLanguage('Wir sehen uns später in München.'), 'de')
  assert.equal(detectLanguage('Nos vemos en la playa con los amigos de la ciudad.'), 'es')
  assert.equal(detectLanguage('See you at the beach later.'), 'en')
  const forced = estimateSpeech('See you at the beach later.', { language: 'es' })
  assert.equal(forced.language, 'es')
  assert.equal(forced.detected, false)
})

test('a script bay has no profile for is detected as other and priced by its length, never as zero', () => {
  const samples: Record<string, string> = {
    hindi: 'नमस्ते दोस्तों, आज हम वीडियो एडिटिंग के बारे में बात करेंगे।',
    arabic: 'مرحبا بالجميع، اليوم سنتحدث عن تحرير الفيديو.',
    greek: 'Γεια σας σε όλους, σήμερα θα μιλήσουμε για το μοντάζ βίντεο.',
    thai: 'สวัสดีทุกคน วันนี้เราจะพูดถึงการตัดต่อวิดีโอ'
  }
  for (const [name, text] of Object.entries(samples)) {
    assert.equal(detectLanguage(text), 'other', name)
    const estimate = estimateSpeech(text)
    assert.equal(estimate.language, 'other', name)
    // Each sample is one spoken sentence of 8–11 words: some seconds (the generic estimate is
    // rough, and long for scripts written with many marks), not zero.
    assert.ok(estimate.seconds > 2 && estimate.seconds < 12, `${name}: ${estimate.seconds}s`)
    assert.match(estimate.notes.join(' '), /no speech profile for.*rough/, name)
    // Called English by the caller, it is still not free: the letters are counted, not dropped.
    const forced = estimateSpeech(text, { language: 'en' })
    assert.ok(forced.seconds > 2, `${name} as en: ${forced.seconds}s`)
    assert.match(forced.notes.join(' '), /outside the English alphabet/, name)
  }
  // Positive control: English with one accented word is still English, with no such note.
  assert.equal(detectLanguage('We edited the café scene today.'), 'en')
  assert.doesNotMatch(estimateSpeech('We edited the café scene today.').notes.join(' '), /outside/)
})

test('mixed Chinese and English counts both halves', () => {
  const english = 'machine learning and artificial intelligence in production systems'
  const mixed = `我们今天讲一讲 ${english}`
  assert.equal(detectLanguage(mixed), 'en', 'mostly Latin letters: the English path')
  const plain = estimateSpeech(english, { language: 'en' })
  const both = estimateSpeech(mixed, { language: 'en' })
  // Seven Han characters are seven syllables at the English rate.
  assert.equal(both.units, plain.units + 7)
  assert.ok(Math.abs(both.seconds - plain.seconds - 7 / 4.6) < 0.02, `${both.seconds} vs ${plain.seconds}`)
})

test('an unknown language gets the generic estimate and says so; a known one does not', () => {
  const fr = estimateSpeech('Bonjour tout le monde, comment allez-vous ?', { language: 'fr' })
  assert.equal(fr.language, 'other')
  assert.match(fr.notes.join(' '), /no speech profile for "fr".*rough/)
  assert.ok(fr.seconds > 1 && fr.seconds < 6, `${fr.seconds}s`)
  const en = estimateSpeech('Hello everyone, how are you?', { language: 'en-GB' })
  assert.equal(en.language, 'en')
  assert.doesNotMatch(en.notes.join(' '), /no speech profile/)
})

test('speed divides the time; empty text is zero seconds', () => {
  const text = 'The quick brown fox jumps over the lazy dog.'
  const one = estimateSpeech(text, { language: 'en' })
  assert.equal(one.units, 11)
  assert.equal(one.seconds, 2.39)
  assert.equal(estimateSpeech(text, { language: 'en', speed: 2 }).seconds, 1.2)
  assert.equal(estimateSpeech(text, { language: 'en', speed: 0 }).speed, 1, 'a nonsensical speed is ignored, not divided by')
  assert.equal(estimateSpeech('   ').seconds, 0)
})
