/**
 * Delivery of user messages: in the order they were sent, to the conversation they were written
 * to, and not at all once the user stopped — with fake runtimes and a preparation the test
 * releases by hand, so every interleaving is chosen rather than hoped for.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { AgentAttachmentInput } from '@shared/agent-attachments'
import { MessageDelivery, type DeliveryTarget, type Prepared } from './deliver'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0])
const picture = (name = 'shot.png'): AgentAttachmentInput => ({ source: 'bytes', kind: 'image', name, mime: 'image/png', data: PNG })

function fakeRuntime(label: string, sent: string[]): DeliveryTarget {
  return { send: (text) => sent.push(`${label}:${text}`) }
}

/** A preparation that waits until the test releases it, and records the signal it was given. */
function gate() {
  const pending: { release: (value: Prepared) => void; signal: AbortSignal }[] = []
  const prepare = (_inputs: readonly AgentAttachmentInput[], signal: AbortSignal): Promise<Prepared> =>
    new Promise((resolve) => pending.push({ release: resolve, signal }))
  const ok: Prepared = { ok: true, attachments: [{ path: '/att/a.png', mediaType: 'image/png', note: 'Image 1' }] }
  return { pending, prepare, ok }
}

const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

test('a text message sent while a picture is being prepared waits its turn instead of overtaking it', { timeout: 5000 }, async () => {
  const sent: string[] = []
  const runtime = fakeRuntime('A', sent)
  const { pending, prepare, ok } = gate()
  const delivery = new MessageDelivery({ runtime: () => runtime, prepare, compose: (text) => `${text}+notes` })

  const first = delivery.send('what is this?', [picture()])
  const second = delivery.send('and make it brighter')
  await tick()
  assert.deepEqual(sent, [], 'the follow-up must not arrive before the question it follows')
  assert.equal(pending.length, 1)
  pending[0]!.release(ok)
  assert.deepEqual(await first, { ok: true })
  assert.deepEqual(await second, { ok: true })
  assert.deepEqual(sent, ['A:what is this?+notes', 'A:and make it brighter'])
})

test('a conversation replaced while a message was prepared does not receive it; an unchanged one does', { timeout: 5000 }, async () => {
  const sent: string[] = []
  const a = fakeRuntime('A', sent)
  const b = fakeRuntime('B', sent)
  let current: DeliveryTarget | null = a
  const { pending, prepare, ok } = gate()
  const delivery = new MessageDelivery({ runtime: () => current, prepare, compose: (text) => text })

  const replaced = delivery.send('for A', [picture()])
  await tick()
  current = b // the user switched provider in Settings while the video was being prepared
  pending[0]!.release(ok)
  const result = await replaced
  assert.equal(result.ok, false)
  assert.match(!result.ok ? result.error : '', /replaced while this message was being prepared, so it was not sent\. Send it again/)
  assert.deepEqual(sent, [], 'neither conversation may receive it')

  // Positive control: the same flow with the conversation left alone is delivered.
  const kept = delivery.send('for B', [picture()])
  await tick()
  pending[1]!.release(ok)
  assert.deepEqual(await kept, { ok: true })
  assert.deepEqual(sent, ['B:for B'])
})

test('a stop aborts the preparation in flight and refuses what was queued behind it; the next message goes', { timeout: 5000 }, async () => {
  const sent: string[] = []
  const runtime = fakeRuntime('A', sent)
  const { pending, prepare, ok } = gate()
  const delivery = new MessageDelivery({ runtime: () => runtime, prepare, compose: (text) => text })

  const preparing = delivery.send('with a video', [picture('take.mov')])
  const queued = delivery.send('queued text')
  await tick()
  delivery.cancel()
  assert.equal(pending[0]!.signal.aborted, true, 'the preparation must be told to stop (its ffmpeg is killed)')
  pending[0]!.release(ok) // even had it finished anyway
  const [a, b] = [await preparing, await queued]
  assert.equal(a.ok, false)
  assert.equal(b.ok, false)
  assert.match(!b.ok ? b.error : '', /stopped before this message was sent/)
  assert.deepEqual(sent, [])

  assert.deepEqual(await delivery.send('after the stop'), { ok: true })
  assert.deepEqual(sent, ['A:after the stop'])
})

test('attachments are validated before anything is prepared, and a preparation that throws refuses the message', { timeout: 5000 }, async () => {
  const sent: string[] = []
  const runtime = fakeRuntime('A', sent)
  let prepared = 0
  const delivery = new MessageDelivery({
    runtime: () => runtime,
    prepare: async () => {
      prepared += 1
      throw new Error('disk full')
    },
    compose: (text) => text
  })
  const tooMany = await delivery.send('x', Array.from({ length: 7 }, () => picture()))
  assert.match(!tooMany.ok ? tooMany.error : '', /7 attachments is too many/)
  assert.equal(prepared, 0)
  const thrown = await delivery.send('x', [picture()])
  assert.match(!thrown.ok ? thrown.error : '', /could not be prepared: disk full/)
  assert.deepEqual(sent, [])
  const none = new MessageDelivery({ runtime: () => null, prepare: async () => ({ ok: true, attachments: [] }), compose: (t) => t })
  assert.match((await none.send('hi')).ok ? '' : 'refused', /refused/)
})
