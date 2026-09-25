/**
 * The Generate tab's form: that what it passes is a call the tools take, that the price shows
 * before a prompt is typed, and that a missing key or a spent budget says what to do.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findModel, type GenerationSpending, type ProviderKeyStatus } from '@shared/generation'
import { checkForm, initialForm, jobStatusLine, optionValue, startBlocker, toolCall, type GenerateForm } from './generateForm'

const keys = (set: boolean): ProviderKeyStatus[] => [
  { provider: 'openai', set, persisted: true },
  { provider: 'gemini', set: false, persisted: true }
]
const spending = (over: Partial<GenerationSpending> = {}): GenerationSpending => ({ budgetUsd: 5, maxActive: 3, spentUsd: 0, active: 0, ...over })

test('an image form with a prompt is a generate_image call the catalog takes, priced by its quality', () => {
  const form: GenerateForm = { ...initialForm('image'), model: 'gpt-image-1.5', prompt: 'a lighthouse at dusk', options: { quality: 'high' } }
  const call = toolCall(form)
  assert.equal(call.tool, 'generate_image')
  assert.equal(call.args.quality, 'high')
  const checked = checkForm(form)
  assert.equal(checked.ok, true)
  // Derived from the catalog rather than a literal, so a price change moves both sides.
  const model = findModel('gpt-image-1.5')!
  assert.equal(checked.estimatedCostUsd, (model.cost.usd as Record<string, number>).high)
})

test('an empty prompt is not an error, and the price still shows for a picture', () => {
  const checked = checkForm({ ...initialForm('image'), model: 'gpt-image-1.5' })
  assert.equal(checked.ok, false)
  assert.deepEqual(!checked.ok && checked.errors, [])
  assert.equal(typeof checked.estimatedCostUsd, 'number')
})

test('speech has no price until it has words, then has one and a length', () => {
  const empty = checkForm(initialForm('speech'))
  assert.equal(empty.ok, false)
  assert.equal(empty.estimatedCostUsd, null)
  const spoken = checkForm({ ...initialForm('speech'), prompt: 'Welcome back to the channel.' })
  assert.equal(spoken.ok, true)
  assert.ok(spoken.ok && spoken.seconds! > 0)
})

test('a rule the model imposes is reported in its own words, and its legal neighbour passes', () => {
  const base: GenerateForm = { ...initialForm('video'), model: 'veo-3.1-generate-preview', prompt: 'waves' }
  const refused = checkForm({ ...base, options: { resolution: '1080p', durationSeconds: '4' } })
  assert.equal(refused.ok, false)
  assert.match(!refused.ok ? refused.errors.join(' ') : '', /8-second/)
  assert.equal(checkForm({ ...base, options: { resolution: '1080p', durationSeconds: '8' } }).ok, true)
})

test('an option the new model does not offer falls back to its default instead of being sent', () => {
  const form: GenerateForm = { ...initialForm('image'), model: 'gemini-2.5-flash-image', prompt: 'x', options: { quality: 'high', aspectRatio: '1:1' } }
  assert.equal(toolCall(form).args.quality, undefined)
  assert.equal(optionValue({ ...form, options: {} }, 'aspectRatio'), '16:9')
  assert.equal(checkForm(form).ok, true)
})

test('a missing key blocks with the way to Providers; a set key does not', () => {
  const missing = startBlocker({ provider: 'openai', keys: keys(false), spending: spending(), estimatedCostUsd: 0.05 })
  assert.equal(missing?.reason, 'no-key')
  assert.equal(missing?.providers, true)
  assert.match(missing!.text, /OpenAI/)
  assert.match(missing!.text, /Settings › Providers/)
  assert.equal(startBlocker({ provider: 'openai', keys: keys(true), spending: spending(), estimatedCostUsd: 0.05 }), null)
})

test('a spent budget names what was spent and the limit; the same call under budget passes', () => {
  const over = startBlocker({ provider: 'openai', keys: keys(true), spending: spending({ spentUsd: 4.99 }), estimatedCostUsd: 0.05 })
  assert.equal(over?.reason, 'budget')
  assert.match(over!.text, /\$4\.99 spent/)
  assert.match(over!.text, /\$5\.00/)
  assert.equal(startBlocker({ provider: 'openai', keys: keys(true), spending: spending({ spentUsd: 4.9 }), estimatedCostUsd: 0.05 }), null)
})

test('a full queue says it clears when a job finishes', () => {
  const full = startBlocker({ provider: 'openai', keys: keys(true), spending: spending({ active: 3 }), estimatedCostUsd: 0.05 })
  assert.equal(full?.reason, 'room')
  assert.match(full!.text, /when one finishes/)
})

test('a job line says where it stands, and a failure carries its reason', () => {
  const job = { id: 'j', provider: 'openai', model: 'gpt-image-1.5', kind: 'image', request: { provider: 'openai', model: 'gpt-image-1.5', kind: 'image', prompt: 'x' }, createdAt: 0, updatedAt: 0 } as const
  assert.equal(jobStatusLine({ ...job, status: 'running', progress: 0.4 }, false, 5000), 'Generating · 40% · 5s')
  assert.equal(jobStatusLine({ ...job, status: 'failed', error: 'content policy' }, false, 0), 'Failed: content policy')
  assert.equal(jobStatusLine({ ...job, status: 'done' }, true, 0), 'In the media pool')
})
