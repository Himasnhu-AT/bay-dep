/**
 * The composer's attachments: what may be added, how many, and what crosses IPC.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Asset } from '@shared/project'
import { validateAttachments } from '@shared/agent-attachments'
import { deliverMessage, pendingFromAsset, pendingFromFile, picturesSent, roomFor, toInput } from './agentAttachments'

const asset = (kind: Asset['kind'], path: string | null = '/Users/x/take.mov'): Asset =>
  ({ id: 'a1', kind, name: 'take', path, durationUs: 1_000_000, width: 1920, height: 1080, fps: 30, hasAudio: true, hasVideo: true, posterPath: null, waveformPath: null, createdAt: 0 }) as Asset

test('six fit; the seventh is left out and the user is told how many', () => {
  assert.deepEqual(roomFor(0, 6), { take: 6, error: null })
  assert.deepEqual(roomFor(4, 3), { take: 2, error: 'A message can carry at most 6 attachments; 1 was left out.' })
  assert.deepEqual(roomFor(6, 2), { take: 0, error: 'A message can carry at most 6 attachments; 2 were left out.' })
})

test('a pasted image gets a readable name; a PDF is refused by name', () => {
  const pasted = pendingFromFile(new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], 'image.png', { type: 'image/png' }), 'Pasted image 1')
  assert.ok(pasted.ok)
  assert.equal(pasted.pending.name, 'Pasted image 1.png')
  assert.equal(pasted.pending.kind, 'image')
  const pdf = pendingFromFile(new File(['%PDF'], 'brief.pdf', { type: 'application/pdf' }))
  assert.equal(pdf.ok, false)
  assert.match(!pdf.ok ? pdf.error : '', /“brief\.pdf” is not an image or a video/)
})

test('pictures and video attach from the media bin; sound and graphics do not', () => {
  const video = pendingFromAsset(asset('video'))
  assert.ok(video.ok)
  assert.deepEqual(video.pending.source, { type: 'asset', assetId: 'a1', path: '/Users/x/take.mov' })
  assert.ok(pendingFromAsset(asset('gif')).ok)
  const audio = pendingFromAsset(asset('audio'))
  assert.equal(audio.ok, false)
  assert.match(!audio.ok ? audio.error : '', /only pictures and video can be attached/)
  assert.equal(pendingFromAsset(asset('brf')).ok, false)
  assert.equal(pendingFromAsset(asset('video', null)).ok, false)
})

test('what the composer sends is what main accepts: bytes for a file, id and path for an asset', async () => {
  const file = pendingFromFile(new File([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1])], 'shot.jpg', { type: 'image/jpeg' }))
  const bin = pendingFromAsset(asset('video'))
  assert.ok(file.ok && bin.ok)
  const inputs = [await toInput(file.pending), await toInput(bin.pending)]
  assert.ok(inputs[0]?.source === 'bytes' && inputs[0].data instanceof Uint8Array && inputs[0].data.byteLength === 5)
  const checked = validateAttachments(inputs)
  assert.ok(checked.ok, !checked.ok ? checked.error : '')
})

/** A delivery whose steps each succeed unless told otherwise, recording what happened. */
function steps(fail: { start?: string; read?: string; send?: string } = {}) {
  const given: string[][] = []
  const problems: string[] = []
  let sent = 0
  return {
    given,
    problems,
    sent: () => sent,
    steps: {
      start: async () => (fail.start ? { ok: false as const, error: fail.start } : { ok: true as const }),
      toInputs: async (list: readonly string[]) => {
        if (fail.read) throw new Error(fail.read)
        return list.map((name) => ({ source: 'asset' as const, kind: 'image' as const, name, assetId: name, path: `/${name}` }))
      },
      send: async () => {
        sent += 1
        return fail.send ? { ok: false, error: fail.send } : { ok: true }
      },
      giveBack: (list: string[]) => given.push(list),
      problem: (message: string) => problems.push(message)
    }
  }
}

test('every way a message can fail gives its attachments back and says why; a sent one keeps nothing', async () => {
  const startFails = steps({ start: 'claude was not found' })
  assert.equal(await deliverMessage(['a.png', 'b.mov'], startFails.steps), false)
  assert.deepEqual(startFails.given, [['a.png', 'b.mov']])
  assert.deepEqual(startFails.problems, ['claude was not found'])
  assert.equal(startFails.sent(), 0)

  const readFails = steps({ read: 'NotFoundError: the file was moved' })
  assert.equal(await deliverMessage(['a.png'], readFails.steps), false)
  assert.deepEqual(readFails.given, [['a.png']])
  assert.match(readFails.problems[0]!, /An attachment could not be read \(NotFoundError: the file was moved\)\. Remove it and attach the file again\./)
  assert.equal(readFails.sent(), 0)

  const refused = steps({ send: 'b.mov has no video in it' })
  assert.equal(await deliverMessage(['b.mov'], refused.steps), false)
  assert.deepEqual(refused.given, [['b.mov']])
  assert.deepEqual(refused.problems, ['b.mov has no video in it'])

  // Positive control: nothing fails, nothing is given back.
  const fine = steps()
  assert.equal(await deliverMessage(['a.png'], fine.steps), true)
  assert.deepEqual(fine.given, [])
  assert.deepEqual(fine.problems, [])
  assert.equal(fine.sent(), 1)

  // A text-only message that fails has nothing to give back, but still says why.
  const textOnly = steps({ start: 'no binary' })
  await deliverMessage([], textOnly.steps)
  assert.deepEqual(textOnly.given, [])
  assert.deepEqual(textOnly.problems, ['no binary'])
})

test('pictures sent are counted from the user turns of the log', () => {
  const view = { kind: 'image' as const, name: 'x', thumb: null }
  assert.equal(
    picturesSent([
      { kind: 'user', id: '1', text: 'a', attachments: [view, view] },
      { kind: 'assistant', id: '2', text: 'b' },
      { kind: 'user', id: '3', text: 'c' },
      { kind: 'user', id: '4', text: 'd', attachments: [view] }
    ]),
    3
  )
})
