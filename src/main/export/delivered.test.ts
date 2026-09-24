/**
 * The export's read-back, against real files from the vendored ffmpeg: the findings an agent
 * reads after `track_export` come from ffprobe on the delivered bytes, not from what the encoder
 * was asked to do. Each refusal is paired with the clean file beside it.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NO_VENDORED_FFMPEG, vendoredTools } from '../ffmpeg/vendor'
import { deliveredFindings } from './delivered'

const FFMPEG = vendoredTools()?.ffmpeg ?? ''
const SKIP = FFMPEG ? false : NO_VENDORED_FFMPEG
const dir = mkdtempSync(join(tmpdir(), 'bay-delivered-'))

function make(name: string, withAudio: boolean, seconds: number): string {
  const out = join(dir, name)
  execFileSync(FFMPEG, [
    '-v', 'error', '-y',
    '-f', 'lavfi', '-i', `color=c=gray:s=64x64:r=25:d=${seconds}`,
    ...(withAudio ? ['-f', 'lavfi', '-i', `sine=frequency=440:duration=${seconds}`] : []),
    '-c:v', 'mjpeg',
    ...(withAudio ? ['-c:a', 'pcm_s16le'] : []),
    out
  ])
  return out
}

const TWO_SECONDS = { video: true, audio: true, durationUs: 2_000_000, fps: 30 }

test('a clean file with picture and sound has no findings', { skip: SKIP }, async () => {
  assert.deepEqual(await deliveredFindings(make('clean.mov', true, 2), TWO_SECONDS), [])
})

test('a file without the sound the timeline has is blocking', { skip: SKIP }, async () => {
  const path = make('silent.mov', false, 2)
  const found = await deliveredFindings(path, TWO_SECONDS)
  assert.deepEqual(found.map((f) => f.severity), ['blocking'])
  assert.match(found[0]!.message, /no audio stream/)
  // The same file for a silent timeline is fine.
  assert.deepEqual(await deliveredFindings(path, { ...TWO_SECONDS, audio: false }), [])
})

test('a file a second short of its range is blocking', { skip: SKIP }, async () => {
  const found = await deliveredFindings(make('short.mov', true, 1), TWO_SECONDS)
  assert.equal(found.length, 1)
  assert.match(found[0]!.message, /range exported is 2\.00s/)
})

test('an unreadable file and a missing one are blocking, in words', { skip: SKIP }, async () => {
  const garbage = join(dir, 'garbage.mp4')
  writeFileSync(garbage, Buffer.alloc(4096, 7))
  const unreadable = await deliveredFindings(garbage, TWO_SECONDS)
  assert.equal(unreadable.length, 1)
  assert.match(unreadable[0]!.message, /could not be read back/)
  const missing = await deliveredFindings(join(dir, 'nothing-here.mp4'), TWO_SECONDS)
  assert.match(missing[0]!.message, /no file/)
})
