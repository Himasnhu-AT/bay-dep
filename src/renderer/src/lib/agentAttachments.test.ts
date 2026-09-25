/**
 * The composer's attachments: what may be added, how many, and what crosses IPC.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Asset } from '@shared/project'
import { validateAttachments } from '@shared/agent-attachments'
import { pendingFromAsset, pendingFromFile, roomFor, toInput } from './agentAttachments'

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
