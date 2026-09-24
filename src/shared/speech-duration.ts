/**
 * How long a piece of text takes to say: an estimate for sizing a voiceover before paying for it.
 *
 * Two methods, chosen by language, because the unit a listener hears differs:
 *
 * - **Syllables** for English and Spanish. Rates, in syllables per second (slow / normal / fast):
 *   English 4.2 / 4.6 / 5.6, Spanish 4.72 / 5.9 / 7.375. These are published figures from the
 *   hypit project's speech estimator, used here as facts; the counting below is bay's own. They
 *   already include ordinary phrasing pauses, so punctuation adds nothing on this path. Numbers,
 *   symbols and acronyms are expanded to the syllables a reader actually says ("2026" is "twenty
 *   twenty-six", "API" is three letters), because a digit spelt as a digit has no syllables and an
 *   estimate that skips it is short by exactly the part a narrator stumbles over.
 * - **Characters** for Chinese, Japanese, Korean, German, Russian and Turkish, and a generic
 *   fallback for anything else. Ported from OpenCreator's statistical estimator
 *   (`runtime/krillinai/internal/service/dubbing/estimator.go`, Apache-2.0, © KrillinAI): per-
 *   language characters per second over every non-space character, plus weighted pauses for
 *   punctuation, digits and upper-case runs. Its rates carry no pace, so slow and fast are 0.8×
 *   and 1.25× normal (hypit's ratio for its non-English languages). Latin words inside CJK text
 *   are counted as English syllables instead of letters — five letters of "video" are two
 *   syllables, not five characters' worth of time.
 *
 * `speed` is a TTS speed multiplier (1 = the voice's normal rate) and divides the result.
 *
 * Pure and deterministic; both processes use it and `speech-duration.test.ts` holds it still
 * against hand-counted samples. It is an estimate: the generated file's measured length is the
 * authority, and `track_generation` reports it.
 */

export type SpeechLanguage = 'en' | 'es' | 'zh' | 'ja' | 'ko' | 'de' | 'ru' | 'tr'
export type SpeechPace = 'slow' | 'normal' | 'fast'

export const SPEECH_LANGUAGES: readonly SpeechLanguage[] = ['en', 'es', 'zh', 'ja', 'ko', 'de', 'ru', 'tr']
export const SPEECH_PACES: readonly SpeechPace[] = ['slow', 'normal', 'fast']

/** Syllables per second. */
const SYLLABLE_RATES: Record<'en' | 'es', Record<SpeechPace, number>> = {
  en: { slow: 4.2, normal: 4.6, fast: 5.6 },
  es: { slow: 4.72, normal: 5.9, fast: 7.375 }
}

interface CharProfile {
  /** Non-space characters per second at a normal pace. */
  rps: number
  pauseW: number
  numberW: number
  acronymW: number
}

/** OpenCreator's per-language profiles (see the header). */
const CHAR_PROFILES: Record<'zh' | 'ja' | 'ko' | 'de' | 'ru' | 'tr', CharProfile> = {
  zh: { rps: 4.2, pauseW: 0.3, numberW: 0.22, acronymW: 0.12 },
  ja: { rps: 4.0, pauseW: 0.28, numberW: 0.2, acronymW: 0.12 },
  ko: { rps: 4.3, pauseW: 0.28, numberW: 0.2, acronymW: 0.12 },
  de: { rps: 11.8, pauseW: 0.24, numberW: 0.25, acronymW: 0.28 },
  ru: { rps: 10.8, pauseW: 0.24, numberW: 0.24, acronymW: 0.24 },
  tr: { rps: 12.0, pauseW: 0.24, numberW: 0.24, acronymW: 0.26 }
}

const PACE_FACTOR: Record<SpeechPace, number> = { slow: 0.8, normal: 1, fast: 1.25 }

export interface SpeechEstimateOptions {
  /** A language code, or `auto` (the default) to detect it from the text. */
  language?: string
  pace?: SpeechPace
  /** TTS speed multiplier; 1 is the voice's own rate. */
  speed?: number
}

export interface SpeechEstimate {
  /** Estimated spoken seconds, to the hundredth. */
  seconds: number
  /** The same text at the slow and fast paces, at the same speed: the plausible range. */
  range: { slow: number; fast: number }
  /** The language estimated for; `other` when bay has no profile for it. */
  language: SpeechLanguage | 'other'
  /** True when the language was detected rather than given. */
  detected: boolean
  pace: SpeechPace
  speed: number
  unit: 'syllables' | 'characters'
  /** Syllables (or characters) counted. */
  units: number
  /** Units per second after pace, before speed. */
  ratePerSecond: number
  /** Where the seconds come from. Sums to `seconds` before rounding. */
  breakdown: { speech: number; pauses: number; numbers: number; acronyms: number }
  /** How it was estimated, and anything that makes it rougher than usual. */
  notes: string[]
}

// ---------------------------------------------------------------------------
// Language detection
// ---------------------------------------------------------------------------

const KANA = /[぀-ヿㇰ-ㇿ]/gu
const HAN = /[㐀-䶿一-鿿豈-﫿\u{20000}-\u{2fa1f}]/gu
const HANGUL = /[가-힯ᄀ-ᇿ㄰-㆏]/gu
const CYRILLIC = /[Ѐ-ӿ]/gu
const LATIN = /[A-Za-zÀ-ɏ]/gu
const SPANISH_MARKS = /[ñ¿¡]/iu
const GERMAN_MARKS = /[äöüß]/iu
const TURKISH_MARKS = /[ğşıİ]/u
const SPANISH_WORDS = new Set([
  'el', 'la', 'los', 'las', 'de', 'del', 'que', 'y', 'en', 'un', 'una', 'es', 'por', 'con', 'para',
  'no', 'se', 'lo', 'como', 'más', 'pero', 'su', 'al', 'este', 'esta', 'muy', 'también', 'hay'
])

function count(text: string, pattern: RegExp): number {
  return text.match(pattern)?.length ?? 0
}

export function detectLanguage(text: string): SpeechLanguage {
  const kana = count(text, KANA)
  const han = count(text, HAN)
  const hangul = count(text, HANGUL)
  const cyrillic = count(text, CYRILLIC)
  const latin = count(text, LATIN)
  if (kana > 0 && kana >= Math.max(han / 4, latin / 4)) return 'ja'
  if (hangul > latin / 4 && hangul > 0) return 'ko'
  if (han > latin / 4 && han > 0) return kana > 0 ? 'ja' : 'zh'
  if (cyrillic > latin) return 'ru'
  if (TURKISH_MARKS.test(text)) return 'tr'
  if (GERMAN_MARKS.test(text)) return 'de'
  if (SPANISH_MARKS.test(text)) return 'es'
  const words = text.toLowerCase().match(/[\p{L}]+/gu) ?? []
  const spanish = words.filter((w) => SPANISH_WORDS.has(w)).length
  if (words.length > 0 && spanish >= Math.max(2, Math.ceil(words.length * 0.18))) return 'es'
  return 'en'
}

// ---------------------------------------------------------------------------
// English syllables
// ---------------------------------------------------------------------------

/** Letters as spelt out: every letter is one syllable, except W ("dou-ble-u"). */
function spelledSyllables(letters: string): number {
  let n = 0
  for (const ch of letters.toLowerCase()) n += ch === 'w' ? 3 : 1
  return n
}

/**
 * Syllables in one English word, by rule rather than dictionary. Vowel groups, less a silent
 * final e, with the usual exceptions for -le, -ed and -es. Good to a syllable or so per word;
 * over a sentence the errors mostly cancel.
 */
export function englishWordSyllables(raw: string): number {
  const word = raw.toLowerCase().replace(/[’']/g, '').replace(/[^a-z]/g, '')
  if (!word) return 0
  if (word.length <= 3) return 1
  let w = word
  // A leading y is a consonant ("yellow", "young").
  if (w.startsWith('y')) w = w.slice(1)
  let n = (w.match(/[aeiouy]+/g) ?? []).length
  // Silent final e: "make", "hope" — but not "-le" after a consonant ("table"), or "-ee" ("free").
  if (/[^aeiou]e$/.test(w) && !/[^aeiouy]le$/.test(w)) n -= 1
  // -ed is its own syllable only after t or d ("wanted", "ended"), not "jumped" or "called".
  if (/[^aeiouytd]ed$/.test(w)) n -= 1
  // -es is its own syllable after a sibilant ("boxes", "wishes", "judges"), not "makes".
  if (/[^aeiouy]es$/.test(w) && !/(s|x|z|ch|sh|g|c)es$/.test(w) && !/[^aeiouy]les$/.test(w)) n -= 1
  // A silent e inside a compound or before a suffix: "timeline", "something", "lately", "awesome".
  if (/[aeiou][^aeiou]e(ly|ment|ful|less|ness|line|some|thing|time|where|way|work|place)/.test(w)) n -= 1
  // -ing after a vowel is a syllable of its own: "going", "being", "playing".
  if (/[aeiouy]ing$/.test(w)) n += 1
  // A y between vowels is a consonant: "player", "layer", "buyer".
  if (/[aeiou]y[aeiou]/.test(w) && !/[aeiouy]ing$/.test(w)) n += 1
  // Final -ea after a consonant: "idea", "area", "Korea" (not "plea", "flea").
  if (/[aeiouy][^aeiou]+ea$/.test(w)) n += 1
  // Two vowel sounds written as one group: "idea", "video", "create", "quiet", "science".
  n += hiatuses(w)
  return Math.max(1, n)
}

/** Vowel pairs that are two syllables, where the group count above saw one. */
function hiatuses(w: string): number {
  let extra = 0
  // "idea", "media", "piano" — but not the -cia/-tia/-sia/-gia of "special", "Asia", "Georgia".
  extra += (w.match(/[^aeiouy]ia/g) ?? []).filter((m) => !/[ctsg]ia/.test(m)).length
  // "video", "radio", "violin" — but not -tion/-sion/-cious/-gious.
  extra += (w.match(/[^aeiouy]io/g) ?? []).filter((m) => !/[tscg]io/.test(m)).length
  // "create", "theatre", "reality", "idea" handled above; "geo", "neon", "people" is not one.
  if (/(^|[^aeiou])(cre|re|the)a[^aeiu]/.test(w) && !/(read|real$|ream|reas)/.test(w)) extra += 1
  if (/[^aeiouy]eo/.test(w) && !/(eou|eop)/.test(w)) extra += 1
  // "quiet", "diet", "science", "client" — ie before t or n followed by a consonant.
  if (/([^aeiouy]|qu)ie(t|n[ct])/.test(w) && !/(friend|view)/.test(w)) extra += 1
  // "actual", "gradual", "fluent", "duet" — u then a/e/i/o, but not after q or g ("quite", "guest").
  extra += (w.match(/[^qg]u[aeo]/g) ?? []).filter((m) => !/[aeiou]/.test(m[0]!)).length
  return extra
}

const ONES = [0, 1, 1, 1, 1, 1, 1, 2, 1, 1] // zero..nine: ze-ro counted below; se-ven
const TEENS = [1, 3, 1, 2, 2, 2, 2, 3, 2, 2] // ten, e-le-ven, twelve, thir-teen, …, se-ven-teen, …
const TENS = [0, 1, 2, 2, 2, 2, 2, 3, 2, 2] // -, ten, twen-ty, thir-ty, for-ty, …, se-ven-ty, …

/** Syllables in an integer below 1000, spoken as words ("three hundred and twelve" → no "and"). */
function under1000(n: number): number {
  let s = 0
  const hundreds = Math.floor(n / 100)
  const rest = n % 100
  if (hundreds > 0) s += ONES[hundreds]! + 2 // "hun-dred"
  if (rest >= 20) s += TENS[Math.floor(rest / 10)]! + (rest % 10 > 0 ? ONES[rest % 10]! : 0)
  else if (rest >= 10) s += TEENS[rest - 10]!
  else if (rest > 0) s += ONES[rest]!
  return s
}

const SCALES = [0, 2, 2, 2, 2] // -, thou-sand, mil-lion, bil-lion, tril-lion

/** Syllables in an integer spoken as a quantity. Beyond the trillions, digit by digit. */
export function integerSyllables(digits: string): number {
  const clean = digits.replace(/^0+(?=\d)/, '')
  if (clean === '0') return 2 // ze-ro
  if (clean.length > 15) return [...clean].reduce((s, d) => s + (d === '0' ? 2 : ONES[Number(d)]!), 0)
  let n = Number(clean)
  let s = 0
  let scale = 0
  while (n > 0) {
    const group = n % 1000
    if (group > 0) s += under1000(group) + SCALES[scale]!
    n = Math.floor(n / 1000)
    scale += 1
  }
  return s
}

/** "1999" and "2026" as a year: two pairs ("nineteen ninety-nine", "twenty twenty-six"). */
function yearSyllables(year: number): number {
  const hi = Math.floor(year / 100)
  const lo = year % 100
  if (lo === 0) return integerSyllables(String(hi)) + 2 // "nineteen hundred"
  if (lo < 10) return integerSyllables(String(hi)) + 1 + ONES[lo]! // "twenty oh five"
  return integerSyllables(String(hi)) + integerSyllables(String(lo))
}

/**
 * Syllables for one numeric token as an English reader says it: years, thousands separators,
 * decimals ("three point five"), ordinals, and a currency or percent sign around it.
 */
export function numberSyllables(token: string): number {
  let s = 0
  let t = token
  if (/^[$€£¥]/.test(t)) {
    s += 2 // dol-lars, eu-ros, pounds≈1, yen≈1 — two is the common case
    t = t.slice(1)
  }
  if (/%$/.test(t)) {
    s += 2 // per-cent
    t = t.slice(0, -1)
  }
  const ordinal = /^(\d+)(st|nd|rd|th)$/i.exec(t)
  if (ordinal) return s + integerSyllables(ordinal[1]!) // "twenty-first" ≈ "twenty-one"
  const [whole = '', fraction] = t.split('.')
  const integer = whole.replace(/,/g, '')
  if (!/^\d+$/.test(integer)) return s
  const value = Number(integer)
  const yearLike = /^\d{4}$/.test(whole) && value >= 1100 && value <= 2099 && fraction === undefined && s === 0
  s += yearLike && value % 1000 >= 10 ? yearSyllables(value) : integerSyllables(integer)
  if (fraction) s += 1 + [...fraction].reduce((n, d) => n + (d === '0' ? 2 : ONES[Number(d)]!), 0) // "point" + digits
  return s
}

/** An all-capitals token: spelt out, unless it reads as a word (two vowels and 4+ letters: NASA). */
function acronymSyllables(token: string): { syllables: number; spelled: boolean } {
  const vowels = (token.match(/[AEIOU]/g) ?? []).length
  if (token.length >= 4 && vowels >= 2) return { syllables: englishWordSyllables(token), spelled: false }
  return { syllables: spelledSyllables(token), spelled: true }
}

const SYMBOL_SYLLABLES: Record<string, number> = { '&': 1, '+': 1, '@': 1, '=': 3, '#': 1 } // and, plus, at, e-quals, hash

interface SyllableCount {
  words: number
  numbers: number
  acronyms: number
}

function englishSyllables(text: string): SyllableCount {
  const out: SyllableCount = { words: 0, numbers: 0, acronyms: 0 }
  const tokens = text.match(/[$€£¥]?\d[\d,]*(?:\.\d+)?%?(?:st|nd|rd|th)?|[\p{L}]+(?:['’\-‐‑–][\p{L}]+)*|[&+@=#]/gu) ?? []
  for (const token of tokens) {
    if (/\d/.test(token)) {
      out.numbers += numberSyllables(token)
      continue
    }
    if (token in SYMBOL_SYLLABLES) {
      out.words += SYMBOL_SYLLABLES[token]!
      continue
    }
    for (const part of token.split(/[\-‐‑–]/)) {
      if (!part) continue
      if (part.length >= 2 && /^[A-Z]+s?$/.test(part) && /[A-Z]{2}/.test(part)) {
        const letters = part.replace(/s$/, '')
        out.acronyms += acronymSyllables(letters).syllables
      } else {
        out.words += englishWordSyllables(part)
      }
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Spanish syllables
// ---------------------------------------------------------------------------

const ES_DIGIT = [2, 2, 1, 1, 2, 2, 1, 2, 2, 2] // ce-ro, u-no, dos, tres, cua-tro, cin-co, seis, sie-te, o-cho, nue-ve

/** Vowel nuclei: a/e/o are strong and part company; í and ú carry their own stress. */
export function spanishWordSyllables(raw: string): number {
  let w = raw.toLowerCase().replace(/[^a-záéíóúüñ]/g, '')
  if (!w) return 0
  w = w.replace(/y$/, 'i')
  let n = 0
  let previous: 'strong' | 'weak' | 'stressed' | null = null
  for (const ch of w) {
    const kind = 'aeoáéó'.includes(ch) ? 'strong' : 'íú'.includes(ch) ? 'stressed' : 'iuü'.includes(ch) ? 'weak' : null
    if (kind === null) {
      previous = null
      continue
    }
    // A diphthong joins any vowel to an unstressed i/u; two strong vowels, or a stressed í/ú,
    // are two syllables. The silent u of "que"/"gui" joins like a weak vowel, which is right.
    const joins =
      previous !== null && !(previous === 'strong' && kind === 'strong') && previous !== 'stressed' && kind !== 'stressed'
    if (!joins) n += 1
    previous = kind
  }
  return Math.max(1, n)
}

function spanishSyllables(text: string): SyllableCount {
  const out: SyllableCount = { words: 0, numbers: 0, acronyms: 0 }
  for (const token of text.match(/\d+|[\p{L}]+/gu) ?? []) {
    if (/^\d+$/.test(token)) out.numbers += [...token].reduce((s, d) => s + ES_DIGIT[Number(d)]!, 0)
    else if (token.length >= 2 && /^[A-ZÑ]+$/.test(token)) out.acronyms += token.length
    else out.words += spanishWordSyllables(token)
  }
  return out
}

// ---------------------------------------------------------------------------
// Characters (OpenCreator's estimator, ported)
// ---------------------------------------------------------------------------

const SHORT_PAUSE = /[,，、;；:：]/gu
const LONG_PAUSE = /[.。!！?？]/gu
const HELD_PAUSE = /[…—～]/gu

interface CharTerms {
  speech: number
  pauses: number
  numbers: number
  acronyms: number
  units: number
  latinSyllables: number
}

function charTerms(text: string, profile: CharProfile, pace: SpeechPace, cjk: boolean): CharTerms {
  const rps = profile.rps * PACE_FACTOR[pace]
  let body = text
  let latinSyllables = 0
  if (cjk) {
    // Latin words inside CJK text: English syllables at the English rate, not letters.
    for (const word of text.match(/[A-Za-z]+(?:['’][A-Za-z]+)*/g) ?? []) {
      latinSyllables += /^[A-Z]{2,}$/.test(word) ? acronymSyllables(word).syllables : englishWordSyllables(word)
    }
    body = text.replace(/[A-Za-z]+(?:['’][A-Za-z]+)*/g, '')
  }
  const units = [...body.replace(/\s+/g, '')].length
  const speech = units / rps + latinSyllables / SYLLABLE_RATES.en[pace]
  const pauses =
    (count(text, SHORT_PAUSE) * 0.22 + count(text, LONG_PAUSE) * 0.28 + count(text, HELD_PAUSE) * 0.34) * profile.pauseW
  const numbers = count(text, /\d/g) * 0.12 * profile.numberW
  let acronyms = 0
  if (!cjk) for (const run of text.match(/[A-ZА-Я]{2,}/gu) ?? []) acronyms += [...run].length * 0.18 * profile.acronymW
  return { speech, pauses, numbers, acronyms, units: units + latinSyllables, latinSyllables }
}

/** OpenCreator's fallback for a language with no profile. */
function heuristicTerms(text: string, pace: SpeechPace): CharTerms {
  const factor = PACE_FACTOR[pace]
  const n = [...text.replace(/\s+/g, '')].length
  const words = (text.match(/[\p{L}\p{N}]+/gu) ?? []).length
  const digits = count(text, /\d/g)
  const letters = count(text, /\p{L}/gu)
  const speech = (n / 8.5 + words * 0.12 + letters * 0.01) / factor
  const pauses = (count(text, SHORT_PAUSE) * 0.22 + count(text, LONG_PAUSE) * 0.28 + count(text, HELD_PAUSE) * 0.34) * 0.18
  const numbers = digits * 0.08 / factor + digits * 0.12 * 0.1
  let acronyms = 0
  for (const run of text.match(/\p{Lu}{2,}/gu) ?? []) acronyms += [...run].length * 0.18 * 0.1
  return { speech, pauses, numbers, acronyms, units: n, latinSyllables: 0 }
}

// ---------------------------------------------------------------------------
// The estimate
// ---------------------------------------------------------------------------

const round2 = (n: number): number => Math.round(n * 100) / 100

function secondsAt(text: string, language: SpeechLanguage | 'other', pace: SpeechPace, speed: number): { total: number; terms: CharTerms; unit: 'syllables' | 'characters'; rate: number } {
  if (language === 'en' || language === 'es') {
    const counted = language === 'en' ? englishSyllables(text) : spanishSyllables(text)
    const rate = SYLLABLE_RATES[language][pace]
    const terms: CharTerms = {
      speech: counted.words / rate / speed,
      pauses: 0,
      numbers: counted.numbers / rate / speed,
      acronyms: counted.acronyms / rate / speed,
      units: counted.words + counted.numbers + counted.acronyms,
      latinSyllables: 0
    }
    return { total: terms.speech + terms.numbers + terms.acronyms, terms, unit: 'syllables', rate }
  }
  const raw = language === 'other' ? heuristicTerms(text, pace) : charTerms(text, CHAR_PROFILES[language], pace, language === 'zh' || language === 'ja' || language === 'ko')
  const terms: CharTerms = {
    ...raw,
    speech: raw.speech / speed,
    pauses: raw.pauses / speed,
    numbers: raw.numbers / speed,
    acronyms: raw.acronyms / speed
  }
  const rate = language === 'other' ? 8.5 * PACE_FACTOR[pace] : CHAR_PROFILES[language].rps * PACE_FACTOR[pace]
  return { total: terms.speech + terms.pauses + terms.numbers + terms.acronyms, terms, unit: 'characters', rate }
}

/**
 * Estimates the spoken length of `text`. Never throws: an unknown language falls back to the
 * generic estimate and says so in `notes`; empty text is zero seconds.
 */
export function estimateSpeech(text: string, options: SpeechEstimateOptions = {}): SpeechEstimate {
  const notes: string[] = []
  const pace: SpeechPace = options.pace && SPEECH_PACES.includes(options.pace) ? options.pace : 'normal'
  const speed = typeof options.speed === 'number' && Number.isFinite(options.speed) && options.speed > 0 ? options.speed : 1
  const asked = (options.language ?? 'auto').toLowerCase().split(/[-_]/)[0] ?? 'auto'
  let language: SpeechLanguage | 'other'
  let detected = false
  if (asked === 'auto' || asked === '') {
    language = detectLanguage(text)
    detected = true
  } else if ((SPEECH_LANGUAGES as readonly string[]).includes(asked)) {
    language = asked as SpeechLanguage
  } else {
    language = 'other'
    notes.push(`bay has no speech profile for "${options.language}", so this is a generic estimate — treat it as rough (±30%).`)
  }

  const at = secondsAt(text, language, pace, speed)
  const range = {
    slow: round2(secondsAt(text, language, 'slow', speed).total),
    fast: round2(secondsAt(text, language, 'fast', speed).total)
  }
  if (at.unit === 'syllables') {
    notes.push(`${at.terms.units} syllables at ${at.rate} per second (${pace})${speed !== 1 ? `, at speed ${speed}` : ''}; ordinary pauses are already in the rate.`)
    if (at.terms.numbers > 0) notes.push('Numbers were counted as they are read aloud; if the script says them differently, spell them out.')
  } else if (language !== 'other') {
    notes.push(`${at.terms.units} characters at ${round2(at.rate)} per second (${pace})${speed !== 1 ? `, at speed ${speed}` : ''}, plus pauses at punctuation.`)
  }
  if (!text.trim()) notes.push('The text is empty.')

  return {
    seconds: round2(at.total),
    range,
    language,
    detected,
    pace,
    speed,
    unit: at.unit,
    units: at.terms.units,
    ratePerSecond: round2(at.rate),
    breakdown: {
      speech: round2(at.terms.speech),
      pauses: round2(at.terms.pauses),
      numbers: round2(at.terms.numbers),
      acronyms: round2(at.terms.acronyms)
    },
    notes
  }
}
