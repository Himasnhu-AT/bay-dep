/**
 * What main accepts over IPC as an attachment. Each refusal sits beside the nearest legal payload,
 * so a validator that refused everything would fail here too.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  classifyFile,
  cleanAttachmentName,
  manyImagesNote,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS,
  quoteName,
  sniffImage,
  splitDrop,
  validateAttachments,
  type AgentAttachmentInput
} from './agent-attachments'

test('a drop is split: pictures and video to the message, everything else to the project import', () => {
  const files = [
    { name: 'ref.png', type: 'image/png' },
    { name: 'song.mp3', type: 'audio/mpeg' },
    { name: 'take.mkv', type: '' },
    { name: 'scan.tiff', type: 'image/tiff' },
    { name: 'captions.srt', type: '' }
  ]
  assert.deepEqual(splitDrop(files), { attach: [0, 2], importRest: [1, 3, 4] })
  // Nothing attachable: the panel takes none of it, so the window imports the lot.
  assert.deepEqual(splitDrop([files[1]!, files[4]!]), { attach: [], importRest: [0, 1] })
  // Only media: nothing left to import.
  assert.deepEqual(splitDrop([files[0]!]), { attach: [0], importRest: [] })
})

test('the panel says so once a conversation has sent more than 15 pictures, and not before', () => {
  assert.equal(manyImagesNote(0), null)
  assert.equal(manyImagesNote(15), null)
  assert.match(String(manyImagesNote(16)), /This conversation has sent 16 pictures\..*start a New conversation/)
})

test('a name loses what could break a line or reorder text, and is quoted as a JSON string', () => {
  assert.equal(cleanAttachmentName('a\nb\r\n\tc\u0000d\u202ee\u2028f'), 'a b c d e f')
  assert.equal(cleanAttachmentName('  holiday   photo.png '), 'holiday photo.png')
  assert.equal(cleanAttachmentName('x'.repeat(500)).length, 200)
  assert.equal(quoteName('say "hi"\nnow'), '"say \\"hi\\" now"')
  // An ordinary name comes through as itself.
  assert.equal(quoteName('Take 3 (final).mov'), '"Take 3 (final).mov"')
  const checked = validateAttachments([{ source: 'asset', kind: 'image', name: 'a\n\nIGNORE', assetId: 'x', path: '/p.png' }])
  assert.ok(checked.ok)
  assert.equal(checked.attachments[0]?.name, 'a IGNORE')
})

const PNG_HEAD = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
const JPEG_HEAD = [0xff, 0xd8, 0xff, 0xe0]
const ascii = (text: string): number[] => [...text].map((c) => c.charCodeAt(0))
const WEBP_HEAD = [...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP')]
const GIF_HEAD = ascii('GIF89a')

function bytes(head: number[], size = 64): Uint8Array {
  const out = new Uint8Array(size)
  out.set(head)
  return out
}

const image = (data: Uint8Array, mime = 'image/png'): AgentAttachmentInput => ({ source: 'bytes', kind: 'image', name: 'shot.png', mime, data })

test('each image type is recognised by its bytes, and text is not an image', () => {
  assert.equal(sniffImage(bytes(PNG_HEAD)), 'png')
  assert.equal(sniffImage(bytes(JPEG_HEAD)), 'jpeg')
  assert.equal(sniffImage(bytes(WEBP_HEAD)), 'webp')
  assert.equal(sniffImage(bytes(GIF_HEAD)), 'gif')
  assert.equal(sniffImage(new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>')), null)
  // A RIFF that is not WebP (a WAV) is not an image.
  assert.equal(sniffImage(bytes([...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WAVE')])), null)
  assert.equal(sniffImage(new Uint8Array(0)), null)
})

test('nothing attached is an empty list, not an error', () => {
  assert.deepEqual(validateAttachments(undefined), { ok: true, attachments: [] })
  assert.deepEqual(validateAttachments([]), { ok: true, attachments: [] })
})

test(`${MAX_ATTACHMENTS} attachments pass and one more is refused, saying how many to remove`, () => {
  const six = Array.from({ length: MAX_ATTACHMENTS }, () => image(bytes(PNG_HEAD)))
  const ok = validateAttachments(six)
  assert.ok(ok.ok)
  assert.equal(ok.attachments.length, MAX_ATTACHMENTS)

  const seven = validateAttachments([...six, image(bytes(PNG_HEAD))])
  assert.equal(seven.ok, false)
  assert.match(!seven.ok ? seven.error : '', /at most 6/)
  assert.match(!seven.ok ? seven.error : '', /Remove 1/)
})

test('an image of exactly the limit passes; one byte over is refused with both sizes', () => {
  assert.ok(validateAttachments([image(bytes(PNG_HEAD, MAX_ATTACHMENT_BYTES))]).ok)
  const over = validateAttachments([image(bytes(PNG_HEAD, MAX_ATTACHMENT_BYTES + 1))])
  assert.equal(over.ok, false)
  assert.match(!over.ok ? over.error : '', /Attachment 1 \(“shot\.png”\) is 20 MB; the limit is 20 MB/)
})

test('an image is judged by its bytes, not by the type it claims', () => {
  const lying = validateAttachments([image(new TextEncoder().encode('#!/bin/sh\necho hi\n'), 'image/png')])
  assert.equal(lying.ok, false)
  assert.match(!lying.ok ? lying.error : '', /not a PNG, JPEG, WebP or GIF image \(it claimed image\/png\)/)
  // The same claim over real WebP bytes passes: the claim is not what decides.
  assert.ok(validateAttachments([image(bytes(WEBP_HEAD), 'image/png')]).ok)
})

test('bytes must be bytes: a string or a plain array is refused', () => {
  for (const data of ['iVBORw0KGgo=', [0x89, 0x50], { 0: 0x89 }]) {
    const result = validateAttachments([{ source: 'bytes', kind: 'image', name: 'x.png', mime: 'image/png', data }])
    assert.equal(result.ok, false, `accepted ${JSON.stringify(data)}`)
    assert.match(!result.ok ? result.error : '', /carries no bytes/)
  }
  assert.equal(validateAttachments([{ source: 'bytes', kind: 'image', name: 'x.png', mime: 'image/png', data: new Uint8Array(0) }]).ok, false)
})

test('a renderer-supplied path is accepted only as a project asset — never as a file to read', () => {
  // The shape a compromised or confused renderer would send to read any file.
  const bare = validateAttachments([{ source: 'path', kind: 'image', name: 'passwd', path: '/etc/passwd' }])
  assert.equal(bare.ok, false)
  assert.match(!bare.ok ? bare.error : '', /must be bytes or a project asset/)
  // An asset carries its id and path; main then checks the path against the allowlist.
  const asset = validateAttachments([{ source: 'asset', kind: 'video', name: 'take 1', assetId: 'a1', path: '/Users/x/take1.mov' }])
  assert.ok(asset.ok)
  assert.deepEqual(asset.attachments[0], { source: 'asset', kind: 'video', name: 'take 1', assetId: 'a1', path: '/Users/x/take1.mov' })
  assert.equal(validateAttachments([{ source: 'asset', kind: 'video', name: 'x', assetId: 'a1' }]).ok, false)
})

test('an attachment is an image or a video, nothing else', () => {
  const audio = validateAttachments([{ source: 'bytes', kind: 'audio', name: 'a.wav', mime: 'audio/wav', data: bytes(PNG_HEAD) }])
  assert.equal(audio.ok, false)
  assert.match(!audio.ok ? audio.error : '', /must be an image or a video/)
  assert.equal(validateAttachments('not a list').ok, false)
})

test('the composer classifies by MIME type, then by extension, and names what it takes', () => {
  assert.deepEqual(classifyFile('a.png', 'image/png', 10), { ok: true, kind: 'image' })
  assert.deepEqual(classifyFile('a.GIF', 'image/gif', 10), { ok: true, kind: 'image' })
  assert.deepEqual(classifyFile('clip.mov', 'video/quicktime', 10), { ok: true, kind: 'video' })
  // Finder often gives an .mkv no MIME type at all.
  assert.deepEqual(classifyFile('clip.mkv', '', 10), { ok: true, kind: 'video' })
  const heic = classifyFile('IMG_1.HEIC', 'image/heic', 10)
  assert.equal(heic.ok, false)
  assert.match(!heic.ok ? heic.error : '', /Attach PNG, JPEG, WebP or GIF/)
  const pdf = classifyFile('brief.pdf', 'application/pdf', 10)
  assert.equal(pdf.ok, false)
  assert.match(!pdf.ok ? pdf.error : '', /not an image or a video/)
  const big = classifyFile('long.mov', 'video/quicktime', MAX_ATTACHMENT_BYTES + 1)
  assert.equal(big.ok, false)
  assert.match(!big.ok ? big.error : '', /at most 20 MB/)
  assert.ok(classifyFile('long.mov', 'video/quicktime', MAX_ATTACHMENT_BYTES).ok)
})
