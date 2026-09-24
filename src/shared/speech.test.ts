/**
 * The speech catalog's validator and findings. Every refusal is paired with the nearest legal
 * call, and every refusal is checked for what the caller needs to retry.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findingsFor, type GenerationRequest } from './generation'
import { SPEECH_MODELS, SPEECH_STYLES, speechInstructions, validateSpeech } from './speech'

function refused(input: Record<string, unknown>, pattern: RegExp): void {
  const result = validateSpeech(input)
  assert.equal(result.ok, false, `expected a refusal for ${JSON.stringify(input)}`)
  assert.match(result.ok ? '' : result.errors.join(' '), pattern)
}

function accepted(input: Record<string, unknown>) {
  const result = validateSpeech(input)
  assert.ok(result.ok, result.ok ? '' : result.errors.join(' '))
  return result
}

test('an unknown model names every speech model; a listed one is taken', () => {
  refused({ model: 'tts-9', text: 'Hi' }, /no speech model "tts-9"\. generate_speech takes: gpt-4o-mini-tts \(openai\), .*eleven_flash_v2_5 \(elevenlabs\)/)
  refused({ model: 'gpt-image-1', text: 'Hi' }, /no speech model "gpt-image-1"/)
  const ok = accepted({ model: 'gpt-4o-mini-tts', text: 'Hi there' })
  assert.equal(ok.request.kind, 'speech')
  assert.equal(ok.request.provider, 'openai')
  assert.equal(ok.request.prompt, 'Hi there')
})

test('defaults are applied and reported: the model’s voice, and the natural style where styles exist', () => {
  const openai = accepted({ model: 'gpt-4o-mini-tts', text: 'Hi' })
  assert.deepEqual(openai.defaultsApplied, ['voice=marin', 'style=natural'])
  assert.equal(openai.request.voice, 'marin')
  assert.equal(openai.request.style, 'natural')
  const eleven = accepted({ model: 'eleven_multilingual_v2', text: 'Hi' })
  assert.deepEqual(eleven.defaultsApplied, ['voice=JBFqnCBsd6RMkjVDRZzb'])
  assert.equal(eleven.request.style, undefined, 'a model with no styles gets none')
})

test('an unknown voice is refused with the model’s voices; a listed one is taken whatever its case', () => {
  refused({ model: 'gpt-4o-mini-tts', text: 'Hi', voice: 'Kore' }, /gpt-4o-mini-tts has no voice "Kore"\. Voices: alloy, ash, .*marin.*verse\./)
  assert.equal(accepted({ model: 'gpt-4o-mini-tts', text: 'Hi', voice: 'Cedar' }).request.voice, 'cedar')
  refused({ model: 'gemini-3.8-flash-tts', text: 'Hi', voice: 'marin' }, /no voice "marin"\. Voices: Zephyr, Puck/)
  assert.equal(accepted({ model: 'gemini-3.8-flash-tts', text: 'Hi', voice: 'kore' }).request.voice, 'Kore')
})

test('ElevenLabs takes any voice id of its shape, and refuses a voice name', () => {
  refused({ model: 'eleven_multilingual_v2', text: 'Hi', voice: 'Rachel' }, /"Rachel" is not an ElevenLabs voice id.*premade one: JBFqnCBsd6RMkjVDRZzb/)
  assert.equal(accepted({ model: 'eleven_multilingual_v2', text: 'Hi', voice: 'AbCdEfGhIjKlMnOpQrSt' }).request.voice, 'AbCdEfGhIjKlMnOpQrSt')
})

test('style and instructions are refused where the model takes none, and named where it does', () => {
  refused({ model: 'eleven_multilingual_v2', text: 'Hi', style: 'warm' }, /takes no style\. .*gpt-4o-mini-tts, gemini-3\.8-flash-tts/)
  refused({ model: 'eleven_flash_v2_5', text: 'Hi', instructions: 'whisper' }, /takes no instructions\. .*use a model that does: gpt-4o-mini-tts/)
  refused({ model: 'gpt-4o-mini-tts', text: 'Hi', style: 'sarcastic' }, /no style "sarcastic"\. Styles: natural, professional, warm, energetic, calm, storytelling\./)
  refused({ model: 'gpt-4o-mini-tts', text: 'Hi', instructions: 'x'.repeat(1001) }, /1001 characters; bay sends at most 1000/)
  const both = accepted({ model: 'gpt-4o-mini-tts', text: 'Hi', style: 'warm', instructions: 'Pronounce Nguyen as "win".' })
  assert.equal(both.request.style, 'warm')
  assert.equal(both.request.instructions, 'Pronounce Nguyen as "win".')
  assert.equal(speechInstructions(both.request), `${SPEECH_STYLES.warm.instructions} Pronounce Nguyen as "win".`)
  const custom = accepted({ model: 'gemini-3.8-flash-tts', text: 'Hi', instructions: 'slowly, like a bedtime story' })
  assert.equal(custom.request.style, undefined, 'custom instructions alone apply no preset')
  assert.equal(speechInstructions(custom.request), 'slowly, like a bedtime story')
})

test('speed: refused on Gemini with the models that take it, bounded where it exists', () => {
  refused({ model: 'gemini-3.8-flash-tts', text: 'Hi', speed: 1.2 }, /takes no speed\. Ask for the pace in instructions.*gpt-4o-mini-tts, eleven_multilingual_v2, eleven_flash_v2_5/)
  refused({ model: 'gpt-4o-mini-tts', text: 'Hi', speed: 5 }, /takes speed from 0\.25 to 4, not 5\./)
  refused({ model: 'eleven_multilingual_v2', text: 'Hi', speed: 1.5 }, /takes speed from 0\.7 to 1\.2, not 1\.5\./)
  assert.equal(accepted({ model: 'gpt-4o-mini-tts', text: 'Hi', speed: 1.5 }).request.speed, 1.5)
  assert.equal(accepted({ model: 'eleven_multilingual_v2', text: 'Hi', speed: 1.2 }).request.speed, 1.2)
})

test('text: empty is refused; too long names the models that take it; the limit itself is taken', () => {
  refused({ model: 'gpt-4o-mini-tts', text: '   ' }, /text is empty/)
  refused({ model: 'gpt-4o-mini-tts', text: 'a'.repeat(4097) }, /4097 characters; gpt-4o-mini-tts takes at most 4096\. Split it .*gemini-3\.8-flash-tts.*eleven_flash_v2_5/)
  accepted({ model: 'gpt-4o-mini-tts', text: 'a'.repeat(4096) })
  refused({ model: 'gpt-4o-mini-tts', provider: 'gemini', text: 'Hi' }, /OpenAI model, not "gemini"/)
})

test('cost: per second of estimated speech, or per thousand characters', () => {
  const openai = accepted({ model: 'gpt-4o-mini-tts', text: 'The quick brown fox jumps over the lazy dog.' })
  assert.equal(openai.estimate.seconds, 2.39)
  assert.equal(openai.request.estimatedSeconds, 2.39)
  assert.equal(openai.estimatedCostUsd, Math.round(2.39 * 0.00025 * 10000) / 10000)
  const eleven = accepted({ model: 'eleven_multilingual_v2', text: 'a '.repeat(500).trim() + '.' })
  assert.equal(eleven.request.prompt.length, 1000)
  assert.equal(eleven.estimatedCostUsd, 0.1)
  // Every model has a price, so none is silently free.
  for (const model of SPEECH_MODELS) assert.ok(model.cost.usd > 0, model.id)
})

test('a style’s pace reaches the estimate: energetic reads faster than calm', () => {
  const text = 'Welcome back to the channel. Today we are building something new.'
  const energetic = accepted({ model: 'gpt-4o-mini-tts', text, style: 'energetic' })
  const calm = accepted({ model: 'gpt-4o-mini-tts', text, style: 'calm' })
  assert.equal(energetic.estimate.pace, 'fast')
  assert.equal(calm.estimate.pace, 'slow')
  assert.ok(energetic.estimate.seconds < calm.estimate.seconds)
  const faster = accepted({ model: 'gpt-4o-mini-tts', text, speed: 2 })
  assert.ok(Math.abs(faster.estimate.seconds * 2 - accepted({ model: 'gpt-4o-mini-tts', text }).estimate.seconds) < 0.02)
})

test('main’s re-validation of a validated request gives back the same request', () => {
  for (const input of [
    { model: 'gpt-4o-mini-tts', text: 'Hi there', style: 'warm', instructions: 'smile', speed: 1.1 },
    { model: 'gemini-3.8-flash-tts', text: '你好，世界。', voice: 'Puck', language: 'zh' },
    { model: 'eleven_flash_v2_5', text: 'Hello again.' }
  ]) {
    const first = accepted(input)
    const again = accepted({ ...first.request })
    assert.deepEqual(again.request, first.request)
    assert.equal(again.estimatedCostUsd, first.estimatedCostUsd)
  }
})

const speechRequest: GenerationRequest = { provider: 'openai', model: 'gpt-4o-mini-tts', kind: 'speech', prompt: 'Hi', estimatedSeconds: 4 }

test('findings: audio with no stream or no length is blocking; a far-off length warns; a good one is clean', () => {
  const blocking = (probe: Parameters<typeof findingsFor>[1]) => findingsFor(speechRequest, probe).filter((f) => f.severity === 'blocking')
  const noAudio = blocking({ durationUs: 4_000_000, width: null, height: null, hasVideo: false, hasAudio: false })
  assert.equal(noAudio.length, 1)
  assert.match(noAudio[0]!.message, /no audio stream\. Nothing was imported/)
  const empty = blocking({ durationUs: 0, width: null, height: null, hasVideo: false, hasAudio: true })
  assert.match(empty[0]?.message ?? '', /no length/)
  // Positive control: sound, a length near the estimate, no picture — clean (a voiceover has none).
  assert.deepEqual(findingsFor(speechRequest, { durationUs: 4_300_000, width: null, height: null, hasVideo: false, hasAudio: true }), [])
  const long = findingsFor(speechRequest, { durationUs: 9_000_000, width: null, height: null, hasVideo: false, hasAudio: true })
  assert.deepEqual(long.map((f) => f.severity), ['warn'])
  assert.match(long[0]!.message, /Estimated 4\.0s of speech and got 9\.00s.*shorten the script/)
  // Unreadable is still blocking, through the shared path.
  assert.equal(findingsFor(speechRequest, null, 'moov atom not found')[0]!.severity, 'blocking')
})

test('the image and video findings are unchanged by the speech branch', () => {
  const video: GenerationRequest = { provider: 'gemini', model: 'veo-3.1-generate-preview', kind: 'video', prompt: 'x', durationSeconds: 8 }
  const noPicture = findingsFor(video, { durationUs: 8_000_000, width: null, height: null, hasVideo: false, hasAudio: true })
  assert.match(noPicture[0]!.message, /no video stream/)
})
