/**
 * New-project naming and posters. Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Asset } from '@shared/project'
import { MAX_POSTER_BYTES, NAME_WORDS, posterFor, uniqueProjectName } from './library'

/** A deterministic `random` that replays a fixed sequence. */
const sequence = (...values: number[]): (() => number) => {
  let i = 0
  return () => values[i++ % values.length]!
}

test('a new project gets a random three-word name', () => {
  const name = uniqueProjectName([], sequence(0, 0, 0))
  assert.equal(name, `${NAME_WORDS.ADJECTIVES[0]} ${NAME_WORDS.COLOURS[0]} ${NAME_WORDS.ANIMALS[0]}`)
  // And it is random, not fixed: another draw gives another name.
  assert.notEqual(uniqueProjectName([], sequence(0.5, 0.5, 0.5)), name)
})

test('a name already taken is drawn again, case-insensitively, as macOS compares files', () => {
  const first = uniqueProjectName([], sequence(0, 0, 0))
  // The first draw collides (in lower case); the second draw is taken instead.
  const next = uniqueProjectName([first.toLowerCase()], sequence(0, 0, 0, 0.5, 0.5, 0.5))
  assert.notEqual(next.toLowerCase(), first.toLowerCase())
  assert.equal(next, uniqueProjectName([], sequence(0.5, 0.5, 0.5)))
})

test('when every draw collides it numbers the name rather than looping forever', () => {
  const only = uniqueProjectName([], sequence(0, 0, 0))
  assert.equal(uniqueProjectName([only], sequence(0, 0, 0)), `${only} 2`)
  assert.equal(uniqueProjectName([only, `${only} 2`], sequence(0, 0, 0)), `${only} 3`)
})

test('every word is safe in a filename', () => {
  for (const list of Object.values(NAME_WORDS)) {
    for (const word of list) assert.match(word, /^[A-Z][a-z]+$/, word)
  }
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
