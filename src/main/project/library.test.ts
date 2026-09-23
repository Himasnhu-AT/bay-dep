/**
 * New-project naming and posters. Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Asset } from '@shared/project'
import { MAX_POSTER_BYTES, posterFor, uniqueProjectName } from './library'

test('the first new project is plainly named, and later ones count up', () => {
  assert.equal(uniqueProjectName([]), 'Untitled project')
  assert.equal(uniqueProjectName(['Untitled project']), 'Untitled project 2')
  assert.equal(uniqueProjectName(['Untitled project', 'Untitled project 2']), 'Untitled project 3')
})

test('a gap in the sequence is reused rather than skipped past', () => {
  assert.equal(uniqueProjectName(['Untitled project', 'Untitled project 3']), 'Untitled project 2')
})

test('names collide case-insensitively, as files do on macOS', () => {
  // Otherwise "Untitled project" would be chosen beside "untitled project.bay" and overwrite it.
  assert.equal(uniqueProjectName(['untitled project']), 'Untitled project 2')
  // Positive control: an unrelated name takes nothing.
  assert.equal(uniqueProjectName(['Holiday edit']), 'Untitled project')
})

const asset = (id: string, posterPath: string | null, error?: string): Asset => ({
  id,
  kind: 'video',
  name: id,
  path: `/m/${id}.mp4`,
  durationUs: 1,
  width: 1,
  height: 1,
  fps: 30,
  hasAudio: false,
  hasVideo: true,
  posterPath,
  waveformPath: null,
  createdAt: 0,
  ...(error ? { error } : {})
})

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0])

test('the poster is the first readable one, inlined as a data URL', async () => {
  const read = async (path: string): Promise<Uint8Array> => {
    if (path === '/p/b.jpg') return jpeg
    throw new Error('ENOENT')
  }
  // `a` has no poster, `gone` is missing on disk, `b` is the one.
  const poster = await posterFor(
    { assets: [asset('a', null), asset('gone', '/p/gone.jpg'), asset('b', '/p/b.jpg')] },
    read
  )
  assert.equal(poster, `data:image/jpeg;base64,${Buffer.from(jpeg).toString('base64')}`)
})

test('an asset with no recorded poster gets one from the locator', async () => {
  // A saved .bay almost always records posterPath: null — posters are made per session. Without
  // the locator, almost no project would have a thumbnail; this is what the first version did.
  const located: string[] = []
  const poster = await posterFor(
    { assets: [asset('clip', null)] },
    async (path) => (path === '/cache/clip.jpg' ? jpeg : new Uint8Array()),
    async (a) => {
      located.push(a.id)
      return `/cache/${a.id}.jpg`
    }
  )
  assert.deepEqual(located, ['clip'])
  assert.match(poster ?? '', /^data:image\/jpeg;base64,/)
  // Positive control: without a locator, the same project has no poster.
  assert.equal(await posterFor({ assets: [asset('clip', null)] }, async () => jpeg), undefined)
})

test('a locator that throws is a blank tile, not a lost project', async () => {
  const poster = await posterFor({ assets: [asset('clip', null)] }, async () => jpeg, async () => {
    throw new Error('ffmpeg missing')
  })
  assert.equal(poster, undefined)
})

test('no readable poster is a blank tile, never a failure', async () => {
  const fail = async (): Promise<Uint8Array> => {
    throw new Error('EACCES')
  }
  assert.equal(await posterFor({ assets: [asset('a', '/p/a.jpg')] }, fail), undefined)
  assert.equal(await posterFor({ assets: [] }, fail), undefined)
})

test('an asset that failed to import, or an oversized file, is skipped', async () => {
  const big = new Uint8Array(MAX_POSTER_BYTES + 1)
  const read = async (path: string): Promise<Uint8Array> => (path === '/p/big.jpg' ? big : jpeg)
  const poster = await posterFor(
    { assets: [asset('broken', '/p/broken.jpg', 'unreadable'), asset('big', '/p/big.jpg'), asset('ok', '/p/ok.png')] },
    read
  )
  assert.match(poster ?? '', /^data:image\/png;base64,/)
})
