/**
 * The generation validator refuses, never narrows — and every refusal names what would be
 * accepted. Each refusal is paired with the nearest legal call, so a validator that refused
 * everything would fail here.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { MODELS, PROVIDERS, describeModels, estimateCost, findingsFor, validateGeneration, type GenerationKind } from './generation'

function refused(input: Record<string, unknown>, kind: GenerationKind, pattern: RegExp): void {
  const result = validateGeneration(input, kind)
  assert.equal(result.ok, false, `expected a refusal for ${JSON.stringify(input)}`)
  assert.match(result.ok ? '' : result.errors.join(' '), pattern)
}

function accepted(input: Record<string, unknown>, kind: GenerationKind) {
  const result = validateGeneration(input, kind)
  assert.ok(result.ok, result.ok ? '' : result.errors.join(' '))
  return result
}

test('an unknown model is refused with the models this tool takes', () => {
  refused({ model: 'dall-e-3', prompt: 'x' }, 'image', /no image model "dall-e-3"\. generate_image takes: gpt-image-1\.5 \(openai\), .*gemini-2\.5-flash-image/)
  accepted({ model: 'gpt-image-1', prompt: 'x' }, 'image')
})

test('a model of the other kind is sent to the other tool', () => {
  refused({ model: 'veo-3.1-generate-preview', prompt: 'x' }, 'image', /makes video; call generate_video/)
  accepted({ model: 'veo-3.1-generate-preview', prompt: 'x' }, 'video')
})

test('a duration the model does not take is refused with the allowed ones, not rounded', () => {
  refused({ model: 'veo-3.1-generate-preview', prompt: 'x', durationSeconds: 12 }, 'video', /does not take durationSeconds 12\. Allowed: 4, 6, 8\./)
  refused({ model: 'kling-v2-6', prompt: 'x', durationSeconds: 8 }, 'video', /Allowed: 5, 10\./)
  const ok = accepted({ model: 'kling-v2-6', prompt: 'x', durationSeconds: 10 }, 'video')
  assert.equal(ok.request.durationSeconds, 10)
})

test('an option the model does not take at all is refused, naming the options it does', () => {
  refused({ model: 'gemini-2.5-flash-image', prompt: 'x', quality: 'high' }, 'image', /does not take quality\. It takes: aspectRatio\./)
  refused({ model: 'gpt-image-1', prompt: 'x', aspectRatio: '16:9' }, 'image', /does not take aspectRatio\. It takes: size, quality\./)
  accepted({ model: 'gpt-image-1', prompt: 'x', size: '1536x1024', quality: 'high' }, 'image')
})

test('an aspect ratio outside the list is refused with the list', () => {
  refused({ model: 'veo-3.1-fast-generate-preview', prompt: 'x', aspectRatio: '1:1' }, 'video', /aspectRatio "1:1"\. Allowed: "16:9", "9:16"\./)
  accepted({ model: 'veo-3.1-fast-generate-preview', prompt: 'x', aspectRatio: '9:16' }, 'video')
})

test('Veo at 1080p needs 8 seconds, and says so; 1080p at 8 is fine', () => {
  refused({ model: 'veo-3.1-generate-preview', prompt: 'x', resolution: '1080p', durationSeconds: 6 }, 'video', /1080p and 4k only as 8-second clips: durationSeconds must be 8 with resolution 1080p, not 6/)
  accepted({ model: 'veo-3.1-generate-preview', prompt: 'x', resolution: '1080p', durationSeconds: 8 }, 'video')
  // And at 720p, 6 seconds is legal.
  accepted({ model: 'veo-3.1-generate-preview', prompt: 'x', resolution: '720p', durationSeconds: 6 }, 'video')
})

test('a reference on a model that takes none is refused; a reference that is not a picture is refused', () => {
  refused({ model: 'gpt-image-1', prompt: 'x', referencePath: '/m/clip.mp4' }, 'image', /must be a PNG, JPEG or WebP picture; "clip\.mp4" is not/)
  const ok = accepted({ model: 'gpt-image-1', prompt: 'x', referencePath: '/m/still.JPG' }, 'image')
  assert.equal(ok.request.referencePath, '/m/still.JPG')
})

test('Kling takes its frame from the reference: an aspect ratio with one is refused, without one it is not defaulted', () => {
  refused({ model: 'kling-v2-6', prompt: 'x', referencePath: '/m/a.png', aspectRatio: '16:9' }, 'video', /takes its frame from the reference picture, so aspectRatio would be ignored/)
  const withRef = accepted({ model: 'kling-v2-6', prompt: 'x', referencePath: '/m/a.png' }, 'video')
  assert.equal(withRef.request.aspectRatio, undefined)
  const without = accepted({ model: 'kling-v2-6', prompt: 'x' }, 'video')
  assert.equal(without.request.aspectRatio, '16:9')
})

test('negativePrompt on a model without one names the models that have it', () => {
  refused({ model: 'gpt-image-1', prompt: 'x', negativePrompt: 'text' }, 'image', /does not take negativePrompt\. Say what to avoid in the prompt itself/)
  accepted({ model: 'kling-v2-1-master', prompt: 'x', negativePrompt: 'text' }, 'video')
})

test('an empty or oversized prompt is refused with the limit', () => {
  refused({ model: 'gpt-image-1', prompt: '   ' }, 'image', /prompt is empty/)
  refused({ model: 'kling-v2-6', prompt: 'a'.repeat(2501) }, 'video', /2501 characters; kling-v2-6 takes at most 2500/)
  accepted({ model: 'kling-v2-6', prompt: 'a'.repeat(2500) }, 'video')
})

test('a provider that contradicts the model is refused; the right one or none is fine', () => {
  refused({ model: 'gpt-image-1', prompt: 'x', provider: 'gemini' }, 'image', /OpenAI model, not "gemini"\. Leave provider out, or pass "openai"/)
  accepted({ model: 'gpt-image-1', prompt: 'x', provider: 'openai' }, 'image')
})

test('defaults are applied and reported, and the estimate follows the option it is priced by', () => {
  const veo = accepted({ model: 'veo-3.1-generate-preview', prompt: 'x' }, 'video')
  assert.deepEqual(veo.defaultsApplied, ['aspectRatio=16:9', 'durationSeconds=8', 'resolution=720p'])
  assert.equal(veo.estimatedCostUsd, 3.2)
  const four = accepted({ model: 'veo-3.1-generate-preview', prompt: 'x', durationSeconds: 4 }, 'video')
  assert.equal(four.estimatedCostUsd, 1.6)
  const high = accepted({ model: 'gpt-image-1', prompt: 'x', quality: 'high' }, 'image')
  const low = accepted({ model: 'gpt-image-1', prompt: 'x', quality: 'low' }, 'image')
  assert.ok(high.estimatedCostUsd > low.estimatedCostUsd)
  assert.equal(estimateCost(high.model, high.request), high.estimatedCostUsd)
})

test('every model is one a provider in the catalog serves, with a default for each option it lists', () => {
  for (const model of MODELS) {
    assert.ok(PROVIDERS[model.provider], model.id)
    // With no options at all, every model validates: its defaults are among its own values.
    accepted({ model: model.id, prompt: 'x' }, model.kind)
  }
})

test('the tool description lists every model of its kind with its options', () => {
  const text = describeModels('video')
  for (const model of MODELS.filter((m) => m.kind === 'video')) assert.ok(text.includes(model.id), model.id)
  assert.equal(text.includes('gpt-image-1'), false)
  assert.match(text, /veo-3\.1-generate-preview \(Google Gemini; t2v, i2v, firstFrame; aspectRatio 16:9\/9:16; durationSeconds 4\/6\/8; resolution 720p\/1080p\/4k; ~\$0\.4–0\.6\/s; with sound\)/)
})

test('findings: no picture is blocking, missing sound and a wrong length are warnings, a good clip has none', () => {
  const request = accepted({ model: 'veo-3.1-generate-preview', prompt: 'x' }, 'video').request
  const good = { durationUs: 8_000_000, width: 1280, height: 720, hasVideo: true, hasAudio: true }
  assert.deepEqual(findingsFor(request, good), [])
  assert.deepEqual(findingsFor(request, { ...good, hasVideo: false }).map((f) => f.severity), ['blocking'])
  const warned = findingsFor(request, { ...good, hasAudio: false, durationUs: 5_000_000 })
  assert.deepEqual(warned.map((f) => f.severity), ['warn', 'warn'])
  assert.match(warned[1]!.message, /Asked for 8s and got 5\.00s/)
  const unreadable = findingsFor(request, null, 'moov atom not found')
  assert.match(unreadable[0]!.message, /cannot read \(moov atom not found\)/)
})
