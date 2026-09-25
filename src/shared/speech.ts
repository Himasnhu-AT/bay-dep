/**
 * Speech generation — a voiceover from text — as the `speech` kind of `@shared/generation`.
 *
 * Same contract as images and video: a catalog of models with the values each option may take,
 * a validator that **refuses** what a model does not take and names what it does, a rough cost,
 * and a request main re-validates before anything is sent. It lives in its own module because
 * its options (voice, style, speed) share nothing with a picture's, and so the image/video
 * catalog stays as it was.
 *
 * API shapes were checked against the providers' docs in September 2026:
 * - OpenAI `POST /v1/audio/speech` — `model`, `input` (≤ 4096 characters), `voice`,
 *   `instructions` (not on tts-1), `response_format`, `speed` 0.25–4.0; the body is the audio.
 * - Gemini `POST /v1beta/interactions` — `model`, `input[].content[]` text with a
 *   `speech_metadata` annotation carrying the style, `generation_config.speech_config[].voice`;
 *   the audio is base64 in `steps[].content[]` (`type: "audio"`), WAV at 24 kHz. No speed option:
 *   pace is asked for in the style.
 * - ElevenLabs `POST /v1/text-to-speech/{voice_id}` with `xi-api-key`, `model_id`,
 *   `voice_settings.speed`; the body is the audio. No style instructions on these models.
 *
 * The six style presets follow OpenCreator's Smart Dubbing styles (Apache-2.0), re-worded for bay.
 * Costs are list prices at the time of writing, as estimates for the agent to weigh — never a bill.
 */

import { PROVIDERS, type GenerationProvider, type GenerationRequest } from './generation'
import { estimateSpeech, type SpeechEstimate, type SpeechPace } from './speech-duration'

export type SpeechStyle = 'natural' | 'professional' | 'warm' | 'energetic' | 'calm' | 'storytelling'

export const SPEECH_STYLES: Record<SpeechStyle, { instructions: string; pace: SpeechPace }> = {
  natural: {
    instructions: 'Read this in an even, conversational voice, saying every word clearly at a relaxed, steady pace.',
    pace: 'normal'
  },
  professional: {
    instructions: 'Deliver this like an assured presenter: polished, confident and precise, never stiff.',
    pace: 'normal'
  },
  warm: {
    instructions: 'Sound friendly and kind, as if talking to someone you like, and take your time.',
    pace: 'normal'
  },
  energetic: {
    instructions: 'Bring bright, upbeat energy and forward momentum, while keeping each word crisp and easy to follow.',
    pace: 'fast'
  },
  calm: {
    instructions: 'Keep the voice quiet, even and reassuring, and let the pauses breathe.',
    pace: 'slow'
  },
  storytelling: {
    instructions: 'Tell it like a story: vary the rhythm, lean on the words that matter, and pause where a listener would wait.',
    pace: 'slow'
  }
}

export const SPEECH_STYLE_IDS = Object.keys(SPEECH_STYLES) as SpeechStyle[]

export interface SpeechModelSpec {
  id: string
  provider: GenerationProvider
  label: string
  /** The voices a call may name. With `voicePattern`, these are suggestions and any id matching it is taken. */
  voices: readonly string[]
  /** An account's own voices (ElevenLabs) are ids in this shape. */
  voicePattern?: RegExp
  defaultVoice: string
  /** Takes a style preset or custom instructions. */
  instructions: boolean
  /** Speed multiplier range; absent when the model takes no speed. */
  speed?: { min: number; max: number }
  /** The longest text one call may carry. */
  maxChars: number
  /** USD per second of audio, or per 1000 characters of text. */
  cost: { per: 'second' | 'kchar'; usd: number }
}

const OPENAI_VOICES = ['alloy', 'ash', 'ballad', 'cedar', 'coral', 'echo', 'fable', 'marin', 'nova', 'onyx', 'sage', 'shimmer', 'verse'] as const

const GEMINI_VOICES = [
  'Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede', 'Callirrhoe', 'Autonoe',
  'Enceladus', 'Iapetus', 'Umbriel', 'Algieba', 'Despina', 'Erinome', 'Algenib', 'Rasalgethi',
  'Laomedeia', 'Achernar', 'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird',
  'Zubenelgenubi', 'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat'
] as const

/** ElevenLabs premade voices at the time of writing: George, Rachel, Sarah, Brian, Adam, Lily, Daniel, Charlotte. */
const ELEVENLABS_VOICES = [
  'JBFqnCBsd6RMkjVDRZzb',
  '21m00Tcm4TlvDq8ikWAM',
  'EXAVITQu4vr4xnJE9KZ5',
  'nPczCjzI2devNBz1zQrb',
  'pNInz6obpgDQGcFmaJgB',
  'pFZP5JQG7iQjIQuC4Bku',
  'onwK4e9ZLuTAKqWW03F9',
  'XB0fDUnXU5powFXDhCwa'
] as const

export const SPEECH_MODELS: readonly SpeechModelSpec[] = [
  {
    id: 'gpt-4o-mini-tts',
    provider: 'openai',
    label: 'GPT-4o mini TTS',
    voices: OPENAI_VOICES,
    defaultVoice: 'marin',
    instructions: true,
    speed: { min: 0.25, max: 4 },
    maxChars: 4096,
    // OpenAI's own estimate: $0.015 per minute of audio.
    cost: { per: 'second', usd: 0.00025 }
  },
  {
    id: 'gemini-3.8-flash-tts',
    provider: 'gemini',
    label: 'Gemini 3.8 Flash TTS',
    voices: GEMINI_VOICES,
    defaultVoice: 'Kore',
    instructions: true,
    // No documented limit; bay's own cap, well inside one request.
    maxChars: 5000,
    // $9 per 1M audio tokens at 25 tokens per second (list price through 2026).
    cost: { per: 'second', usd: 0.000225 }
  },
  {
    id: 'gemini-3.8-flash-lite-tts',
    provider: 'gemini',
    label: 'Gemini 3.8 Flash-Lite TTS',
    voices: GEMINI_VOICES,
    defaultVoice: 'Kore',
    instructions: true,
    maxChars: 5000,
    cost: { per: 'second', usd: 0.00015 }
  },
  {
    id: 'eleven_multilingual_v2',
    provider: 'elevenlabs',
    label: 'ElevenLabs Multilingual v2',
    voices: ELEVENLABS_VOICES,
    voicePattern: /^[A-Za-z0-9]{20}$/,
    defaultVoice: 'JBFqnCBsd6RMkjVDRZzb',
    instructions: false,
    speed: { min: 0.7, max: 1.2 },
    maxChars: 10000,
    cost: { per: 'kchar', usd: 0.1 }
  },
  {
    id: 'eleven_flash_v2_5',
    provider: 'elevenlabs',
    label: 'ElevenLabs Flash v2.5',
    voices: ELEVENLABS_VOICES,
    voicePattern: /^[A-Za-z0-9]{20}$/,
    defaultVoice: 'JBFqnCBsd6RMkjVDRZzb',
    instructions: false,
    speed: { min: 0.7, max: 1.2 },
    maxChars: 40000,
    cost: { per: 'kchar', usd: 0.05 }
  }
]

/** The longest custom instructions bay sends. */
export const SPEECH_INSTRUCTIONS_MAX = 1000

export function findSpeechModel(id: string): SpeechModelSpec | undefined {
  return SPEECH_MODELS.find((m) => m.id === id)
}

/** The model list the `generate_speech` description carries, derived from `SPEECH_MODELS`. */
export function describeSpeechModels(): string {
  return (
    SPEECH_MODELS.map((m) => {
      const parts = [
        PROVIDERS[m.provider].label,
        m.voicePattern ? `voice: an ElevenLabs voice id (default ${m.defaultVoice})` : `voice ${m.voices.join('/')} (default ${m.defaultVoice})`,
        m.instructions ? 'style or instructions' : 'no style/instructions',
        m.speed ? `speed ${m.speed.min}–${m.speed.max}` : 'no speed',
        `≤${m.maxChars} chars`,
        m.cost.per === 'second' ? `~$${(m.cost.usd * 60).toFixed(4).replace(/0+$/, '')}/min` : `~$${m.cost.usd}/1k chars`
      ]
      return `${m.id} (${parts.join('; ')})`
    }).join('. ') + '.'
  )
}

/** The instructions sent for a request: the preset's, then any custom ones. */
export function speechInstructions(request: Pick<GenerationRequest, 'style' | 'instructions'>): string | undefined {
  const preset = request.style && request.style in SPEECH_STYLES ? SPEECH_STYLES[request.style as SpeechStyle].instructions : ''
  const custom = request.instructions?.trim() ?? ''
  const joined = [preset, custom].filter(Boolean).join(' ')
  return joined || undefined
}

export type SpeechValidation =
  | {
      ok: true
      request: GenerationRequest
      model: SpeechModelSpec
      estimatedCostUsd: number
      defaultsApplied: string[]
      estimate: SpeechEstimate
    }
  | { ok: false; errors: string[] }

const round4 = (n: number): number => Math.round(n * 10000) / 10000

/**
 * The fastest a voice plausibly reads, in non-space characters a second (brisk English is about
 * 15). Prices never assume a text is quicker to say than this.
 */
export const SPEECH_FLOOR_CHARS_PER_SECOND = 20

export function speechCost(model: SpeechModelSpec, characters: number, seconds: number): number {
  return round4(model.cost.per === 'second' ? model.cost.usd * seconds : (model.cost.usd * characters) / 1000)
}

/**
 * Checks a speech call. Accepts the tool's arguments (`text`) or a request main re-validates
 * (`prompt`), so the check is the same on both sides. Every error names what would be accepted.
 */
export function validateSpeech(input: Record<string, unknown>): SpeechValidation {
  const errors: string[] = []
  const modelId = typeof input.model === 'string' ? input.model : ''
  const model = findSpeechModel(modelId)
  const choices = SPEECH_MODELS.map((m) => `${m.id} (${m.provider})`).join(', ')
  if (!model) return { ok: false, errors: [`There is no speech model "${modelId}". generate_speech takes: ${choices}.`] }
  if (input.provider !== undefined && input.provider !== model.provider) {
    errors.push(`${model.id} is a ${PROVIDERS[model.provider].label} model, not "${String(input.provider)}". Leave provider out, or pass "${model.provider}".`)
  }

  const rawText = typeof input.text === 'string' ? input.text : typeof input.prompt === 'string' ? input.prompt : ''
  const text = rawText.trim()
  if (!text) errors.push('text is empty. Pass the exact words to be spoken.')
  else if (text.length > model.maxChars) {
    const longer = SPEECH_MODELS.filter((m) => m.maxChars >= text.length).map((m) => m.id)
    errors.push(
      `text is ${text.length} characters; ${model.id} takes at most ${model.maxChars}. Split it into several calls` +
        (longer.length > 0 ? `, or use ${longer.join(', ')}.` : '.')
    )
  }

  const defaultsApplied: string[] = []
  let voice = model.defaultVoice
  if (input.voice === undefined || input.voice === null || input.voice === '') {
    defaultsApplied.push(`voice=${model.defaultVoice}`)
  } else {
    const given = String(input.voice)
    const listed = model.voices.find((v) => v.toLowerCase() === given.toLowerCase())
    if (listed) voice = listed
    else if (model.voicePattern?.test(given)) voice = given
    else {
      errors.push(
        model.voicePattern
          ? `"${given}" is not an ElevenLabs voice id (20 letters and digits). Use one from the account's voice library, or a premade one: ${model.voices.join(', ')}.`
          : `${model.id} has no voice "${given}". Voices: ${model.voices.join(', ')}.`
      )
    }
  }

  let style: SpeechStyle | undefined
  let instructions: string | undefined
  const takers = SPEECH_MODELS.filter((m) => m.instructions).map((m) => m.id).join(', ')
  if (input.style !== undefined && input.style !== null) {
    if (!model.instructions) errors.push(`${model.id} takes no style. Leave it out, or use a model that does: ${takers}.`)
    else if (!(String(input.style) in SPEECH_STYLES)) errors.push(`There is no style "${String(input.style)}". Styles: ${SPEECH_STYLE_IDS.join(', ')}.`)
    else style = String(input.style) as SpeechStyle
  }
  if (input.instructions !== undefined && input.instructions !== null && input.instructions !== '') {
    if (!model.instructions) errors.push(`${model.id} takes no instructions. Leave them out, or use a model that does: ${takers}.`)
    else if (typeof input.instructions !== 'string') errors.push('instructions must be a string.')
    else if (input.instructions.length > SPEECH_INSTRUCTIONS_MAX) {
      errors.push(`instructions are ${input.instructions.length} characters; bay sends at most ${SPEECH_INSTRUCTIONS_MAX}. Say how to read it in a sentence or two.`)
    } else instructions = input.instructions.trim()
  }
  if (model.instructions && style === undefined && instructions === undefined && errors.length === 0) {
    style = 'natural'
    defaultsApplied.push('style=natural')
  }

  let speed: number | undefined
  if (input.speed !== undefined && input.speed !== null) {
    const value = Number(input.speed)
    if (!model.speed) {
      const able = SPEECH_MODELS.filter((m) => m.speed).map((m) => m.id).join(', ')
      errors.push(`${model.id} takes no speed. Ask for the pace in instructions ("speak slowly"), or use a model that takes speed: ${able}.`)
    } else if (!Number.isFinite(value) || value < model.speed.min || value > model.speed.max) {
      errors.push(`${model.id} takes speed from ${model.speed.min} to ${model.speed.max}, not ${String(input.speed)}.`)
    } else speed = value
  }

  const language = typeof input.language === 'string' && input.language ? input.language : undefined

  if (errors.length > 0) return { ok: false, errors }

  const pace: SpeechPace = style ? SPEECH_STYLES[style].pace : 'normal'
  const estimated = estimateSpeech(text, { ...(language ? { language } : {}), pace, speed: speed ?? 1 })
  // A price is never zero for words a provider will speak and bill. The estimator can still come
  // up short (emoji, symbols, a script it reads roughly), and a zero-second estimate of a
  // per-second model walks through the spend guard for free. So no estimate goes below this.
  const floor = Math.round(([...text.replace(/\s+/g, '')].length / SPEECH_FLOOR_CHARS_PER_SECOND / (speed ?? 1)) * 100) / 100
  const estimate =
    estimated.seconds >= floor
      ? estimated
      : {
          ...estimated,
          seconds: floor,
          notes: [...estimated.notes, `The estimate was raised to ${floor}s, bay's floor of ${SPEECH_FLOOR_CHARS_PER_SECOND} characters a second, so the cost is not understated.`]
        }
  const request: GenerationRequest = {
    provider: model.provider,
    model: model.id,
    kind: 'speech',
    prompt: text,
    voice,
    ...(style ? { style } : {}),
    ...(instructions ? { instructions } : {}),
    ...(speed !== undefined ? { speed } : {}),
    ...(language ? { language } : {}),
    estimatedSeconds: estimate.seconds
  }
  return { ok: true, request, model, estimatedCostUsd: speechCost(model, text.length, estimate.seconds), defaultsApplied, estimate }
}

/**
 * The estimate for a `generate_speech` or `apply_dub` call as the agent wrote it, for the agent
 * panel's tool card; null for any other tool, or a call the catalog would refuse. A dub is the sum
 * of its lines, each priced the way `apply_dub` prices it.
 */
export function estimateSpeechToolCallUsd(tool: string, args: Record<string, unknown>): number | null {
  if (tool === 'generate_speech') {
    const checked = validateSpeech(args)
    return checked.ok ? checked.estimatedCostUsd : null
  }
  if (tool !== 'apply_dub' || !Array.isArray(args.translations)) return null
  const options: Record<string, unknown> = {}
  for (const key of ['model', 'voice', 'style', 'instructions', 'speed', 'language'] as const) {
    if (args[key] !== undefined) options[key] = args[key]
  }
  const translations = args.translations
  let total = 0
  for (const line of translations as unknown[]) {
    const text = (line as { text?: unknown } | null)?.text
    if (typeof text !== 'string') return null
    const checked = validateSpeech({ ...options, text })
    if (!checked.ok) return null
    total += checked.estimatedCostUsd
  }
  return translations.length > 0 ? round4(total) : null
}
