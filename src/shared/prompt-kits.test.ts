/**
 * Prompt kits: each one fills to a request the generate tools accept, and the filler refuses in
 * words that name what would work. Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fillPromptKit, PROMPT_KITS, promptKitsGuide, templateSlots } from './prompt-kits'
import { findModel, validateGeneration } from './generation'

/** A value for every slot, so defaults and required ones are both exercised. */
const allSlots = (id: string): Record<string, string> =>
  Object.fromEntries(PROMPT_KITS.find((k) => k.id === id)!.slots.map((s) => [s.id, `the ${s.id.replace(/_/g, ' ')} value`]))

test('there are about fifteen kits, of both kinds, with distinct ids', () => {
  assert.ok(PROMPT_KITS.length >= 14, `${PROMPT_KITS.length} kits`)
  const ids = PROMPT_KITS.map((k) => k.id)
  assert.equal(new Set(ids).size, ids.length)
  for (const id of ids) assert.match(id, /^[a-z0-9]+(-[a-z0-9]+)*$/)
  assert.ok(PROMPT_KITS.some((k) => k.kind === 'image') && PROMPT_KITS.some((k) => k.kind === 'video'))
})

test('every kit declares exactly the slots its template uses', () => {
  for (const kit of PROMPT_KITS) {
    assert.deepEqual(templateSlots(kit.template).sort(), kit.slots.map((s) => s.id).sort(), kit.id)
    for (const slot of kit.slots) assert.ok(slot.description.length > 3, `${kit.id}.${slot.id} says what goes in it`)
    assert.ok(kit.avoid.length > 0, `${kit.id} keeps something out`)
  }
})

test('every kit fills — with every slot, and with only the required ones — to a request the generate tool accepts', () => {
  for (const kit of PROMPT_KITS) {
    const required = Object.fromEntries(kit.slots.filter((s) => s.default === undefined).map((s) => [s.id, 'something specific']))
    for (const values of [allSlots(kit.id), required]) {
      const filled = fillPromptKit(kit.id, values)
      assert.ok(filled.ok, `${kit.id}: ${filled.ok ? '' : filled.error}`)
      assert.equal(filled.tool, kit.kind === 'image' ? 'generate_image' : 'generate_video')
      assert.doesNotMatch(filled.request.prompt, /\[[a-z_]+\]/, `${kit.id} left a slot unfilled`)
      const checked = validateGeneration({ ...filled.request }, kit.kind)
      assert.ok(checked.ok, `${kit.id}: ${checked.ok ? '' : checked.errors.join(' ')}`)
    }
  }
})

test('the exclusions go where the model reads them: a negative prompt field, or the prompt itself', () => {
  const video = fillPromptKit('drone-orbit', { subject: 'a lighthouse' })
  const image = fillPromptKit('talking-head-background', { room: 'a small studio' })
  assert.ok(video.ok && image.ok)
  assert.equal(findModel(video.request.model)?.negativePrompt, true, 'the specimen model takes a negative prompt')
  assert.match(video.request.negativePrompt ?? '', /on-screen text/)
  assert.doesNotMatch(video.request.prompt, /Avoid:/)
  assert.notEqual(findModel(image.request.model)?.negativePrompt, true, 'the specimen model takes none')
  assert.equal(image.request.negativePrompt, undefined)
  assert.match(image.request.prompt, /Avoid: on-screen text/)
})

test('values fill their slots and defaults fill the rest, and the result says which', () => {
  const filled = fillPromptKit('drone-orbit', { subject: 'a red lighthouse', direction: 'left' })
  assert.ok(filled.ok)
  assert.match(filled.request.prompt, /circles a red lighthouse at a constant speed/)
  assert.match(filled.request.prompt, /travelling to the screen left/)
  assert.match(filled.request.prompt, /about 4 metres/, 'height took its default')
  assert.deepEqual(filled.defaultsApplied.sort(), ['height', 'radius'])
  assert.deepEqual(filled.credit && { basedOn: filled.credit.basedOn, author: filled.credit.author }, {
    basedOn: 'OpenCreator template drone-orbit-subject',
    author: 'Higgsfield.AI Team'
  })
})

test('an unknown kit, an unknown slot, a missing slot or an empty value is refused naming what works', () => {
  const noKit = fillPromptKit('drone-orbitt', {})
  assert.equal(noKit.ok, false)
  assert.match(noKit.ok ? '' : noKit.error, /no prompt kit "drone-orbitt".*drone-orbit/)

  const noSlot = fillPromptKit('drone-orbit', { subject: 'x', altitude: '9' })
  assert.match(noSlot.ok ? '' : noSlot.error, /no slot "altitude".*subject \(required\), height \(default "4"\)/)

  const missing = fillPromptKit('drone-orbit', { height: '9' })
  assert.match(missing.ok ? '' : missing.error, /needs "subject"/)

  const empty = fillPromptKit('drone-orbit', { subject: '  ' })
  assert.match(empty.ok ? '' : empty.error, /"subject" must be non-empty text/)

  // Positive control: the nearest legal call.
  assert.ok(fillPromptKit('drone-orbit', { subject: 'x' }).ok)
})

test('with a reference, a Kling request leaves the aspect ratio to the picture and still validates', () => {
  const kit = PROMPT_KITS.find((k) => k.id === 'animate-still')!
  assert.equal(findModel(kit.model)?.aspectFromReference, true, 'the specimen is a model that refuses an aspect with a reference')
  const withRef = fillPromptKit('animate-still', { motion: 'steam rising' }, { withReference: true })
  const without = fillPromptKit('animate-still', { motion: 'steam rising' })
  assert.ok(withRef.ok && without.ok)
  assert.equal(withRef.request.aspectRatio, undefined)
  assert.equal(without.request.aspectRatio, kit.aspectRatio)
  assert.match(withRef.reference ?? '', /picture to animate/)
  const checked = validateGeneration({ ...withRef.request, referencePath: '/pictures/poster.png' }, 'video')
  assert.ok(checked.ok, checked.ok ? '' : checked.errors.join(' '))
  // And the reason it matters: the same request with the aspect kept is refused.
  assert.equal(validateGeneration({ ...without.request, referencePath: '/pictures/poster.png' }, 'video').ok, false)
})

test('credits name an https source; the guide lists every kit and credit', () => {
  const guide = promptKitsGuide()
  for (const kit of PROMPT_KITS) {
    assert.ok(guide.includes(`\`${kit.id}\``), `${kit.id} is in the guide`)
    if (kit.credit) {
      assert.match(kit.credit.url, /^https:\/\//, kit.id)
      assert.match(kit.credit.basedOn, /^OpenCreator template /, kit.id)
      assert.ok(guide.includes(kit.credit.author), `${kit.id}'s author is credited in the guide`)
    }
  }
  assert.ok(PROMPT_KITS.filter((k) => k.credit).length >= 3)
})
