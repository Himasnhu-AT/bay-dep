/**
 * Relinking missing media: which siblings one located file finds, when a located file is
 * probably the wrong one, and what the project becomes.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { applyRelinks, dirnameOf, relinkMismatch, siblingCandidates } from './relink'
import type { Asset, Project } from './project'

function asset(id: string, over: Partial<Asset> = {}): Asset {
  return {
    id,
    kind: 'video',
    name: id,
    path: `/Old/Shoot/${id}.mov`,
    durationUs: 10_000_000,
    width: 1920,
    height: 1080,
    fps: 25,
    hasAudio: true,
    hasVideo: true,
    posterPath: null,
    waveformPath: null,
    createdAt: 100,
    ...over
  }
}

test('dirname keeps the root and handles either separator', () => {
  assert.equal(dirnameOf('/Old/Shoot/a.mov'), '/Old/Shoot')
  assert.equal(dirnameOf('/a.mov'), '/')
  assert.equal(dirnameOf('C:\\Shoot\\a.mov'), 'C:\\Shoot')
  assert.equal(dirnameOf('a.mov'), '')
})

test('one located file finds its missing siblings from the same original folder, by name', () => {
  const missing = [
    asset('a'),
    asset('b'),
    // Same file name, different original folder: not a sibling, however similar.
    asset('c', { path: '/Elsewhere/b.mov' }),
    // A font lives in the project, never relinked.
    asset('f', { kind: 'font', path: '/Old/Shoot/f.ttf' })
  ]
  const found = siblingCandidates(missing, { assetId: 'a', oldPath: '/Old/Shoot/a.mov', newPath: '/New/Shoot/a.mov' })
  assert.deepEqual(found, [{ assetId: 'b', path: '/New/Shoot/b.mov' }])
})

test('a file found in its own folder has no siblings to look for', () => {
  const found = siblingCandidates([asset('a'), asset('b')], {
    assetId: 'a',
    oldPath: '/Old/Shoot/a.mov',
    newPath: '/Old/Shoot/a-renamed.mov'
  })
  assert.deepEqual(found, [])
})

test('a plausible replacement passes, and each implausible one says why', () => {
  const old = asset('a')
  // Positive control: the same media, re-encoded a few frames longer.
  assert.equal(relinkMismatch(old, asset('p', { durationUs: 10_200_000 })), null)

  const audio = relinkMismatch(old, asset('p', { kind: 'audio', hasVideo: false }))
  assert.match(audio ?? '', /was a video file, and this is an audio file/)

  const short = relinkMismatch(old, asset('p', { durationUs: 3_000_000 }))
  assert.match(short ?? '', /was 10 s long, and this file is 3 s/)

  const silent = relinkMismatch(old, asset('p', { hasAudio: false }))
  assert.match(silent ?? '', /had sound, and this file has none/)

  const broken = relinkMismatch(old, asset('p', { error: 'moov atom not found', path: '/New/a.mov' }))
  assert.match(broken ?? '', /a\.mov could not be read: moov atom not found/)
})

test('a still and a GIF are interchangeable, but a still is not a video', () => {
  const still = asset('s', { kind: 'image', durationUs: 0, hasAudio: false })
  assert.equal(relinkMismatch(still, asset('p', { kind: 'gif', durationUs: 0, hasAudio: false })), null)
  assert.notEqual(relinkMismatch(still, asset('p', { durationUs: 0, hasAudio: false })), null)
})

function projectWith(assets: Asset[], placements: [string, string][]): Project {
  return {
    assets,
    timelines: [{ tracks: [{ items: placements.map(([id, assetId]) => ({ id, assetId })) }] }]
  } as unknown as Project
}

test('relinking points every placement at the probed asset and keeps the chosen name and date', () => {
  const project = projectWith(
    [asset('old', { name: 'Interview (Jane)', createdAt: 42 })],
    [
      ['i1', 'old'],
      ['i2', 'old']
    ]
  )
  const probed = asset('new', { path: '/New/Shoot/old.mov', durationUs: 10_100_000, createdAt: 999, name: 'old.mov' })
  const moved = applyRelinks(project, [{ assetId: 'old', replacement: probed }])

  assert.equal(moved, 2)
  assert.deepEqual(project.assets.map((a) => [a.id, a.name, a.path, a.createdAt, a.durationUs]), [
    ['new', 'Interview (Jane)', '/New/Shoot/old.mov', 42, 10_100_000]
  ])
  const items = project.timelines[0]!.tracks[0]!.items
  assert.deepEqual(items.map((item) => item.assetId), ['new', 'new'])
})

test('a file already in the project absorbs the missing asset instead of being added twice', () => {
  const project = projectWith(
    [asset('old'), asset('there', { path: '/New/Shoot/old.mov' })],
    [
      ['i1', 'old'],
      ['i2', 'there']
    ]
  )
  applyRelinks(project, [{ assetId: 'old', replacement: asset('there', { path: '/New/Shoot/old.mov' }) }])
  assert.deepEqual(project.assets.map((a) => a.id), ['there'])
  assert.deepEqual(project.timelines[0]!.tracks[0]!.items.map((item) => item.assetId), ['there', 'there'])
})
