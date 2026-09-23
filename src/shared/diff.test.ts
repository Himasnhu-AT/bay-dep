/**
 * The change summaries shown after an agent turn. Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Asset, Item, Project } from './project'
import { describeChanges } from './diff'

const asset = (id: string, name: string, extra: Partial<Asset> = {}): Asset => ({
  id,
  kind: 'video',
  name,
  path: `/m/${name}`,
  durationUs: 60_000_000,
  width: 1920,
  height: 1080,
  fps: 30,
  hasAudio: true,
  hasVideo: true,
  posterPath: null,
  waveformPath: null,
  createdAt: 0,
  ...extra
})

const item = (id: string, assetId: string, from: number, duration: number, extra: Partial<Item> = {}): Item => ({
  id,
  assetId,
  trackId: 'v1',
  from,
  durationInFrames: duration,
  sourceStartUs: 0,
  layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
  volume: 1,
  fadeInFrames: 0,
  fadeOutFrames: 0,
  speed: 1,
  ...extra
})

function project(items: Item[], extra: Partial<Project> = {}): Project {
  return {
    id: 'p',
    name: 'Cut',
    version: 1,
    assets: [asset('a1', 'interview.mp4'), asset('a2', 'broll.mp4')],
    timelines: [
      {
        id: 'tl',
        name: 'Timeline 1',
        fps: 30,
        width: 1920,
        height: 1080,
        background: '#000',
        tracks: [{ id: 'v1', kind: 'video', name: 'V1', locked: false, muted: false, hidden: false, items }]
      }
    ],
    activeTimelineId: 'tl',
    createdAt: 0,
    updatedAt: 0,
    ...extra
  }
}

const texts = (lines: { text: string }[]): string[] => lines.map((line) => line.text)

test('no change, no lines — the card does not appear for a turn that only read', () => {
  const p = project([item('i1', 'a1', 0, 150)])
  assert.deepEqual(describeChanges(p, structuredClone(p)), [])
})

test('an added clip and a removed one are named with their track and time', () => {
  const before = project([item('i1', 'a1', 0, 150)])
  const after = project([item('i2', 'a2', 150, 60)])
  assert.deepEqual(texts(describeChanges(before, after)), [
    'Added “broll.mp4” on V1, 0:05:00–0:07:00',
    'Removed “interview.mp4” from V1, 0:00:00–0:05:00'
  ])
})

test('a clip is compared by id: moved is moved, not removed and re-added', () => {
  const before = project([item('i1', 'a1', 0, 150)])
  const after = project([item('i1', 'a1', 30, 150)])
  assert.deepEqual(texts(describeChanges(before, after)), ['Moved “interview.mp4” 0:00:00 → 0:01:00'])
})

test('trims, fades, volume and speed each read as what changed', () => {
  const before = project([item('i1', 'a1', 0, 150)])
  const after = project([item('i1', 'a1', 0, 90, { fadeInFrames: 12, volume: 0.5, speed: 2 })])
  assert.deepEqual(texts(describeChanges(before, after)), [
    'Trimmed “interview.mp4” to 0:00:00–0:03:00',
    'Fade in on “interview.mp4”: 0 → 12 frames',
    'Volume of “interview.mp4”: 100% → 50%',
    'Speed of “interview.mp4”: 1× → 2×'
  ])
})

test('imports, canvas changes and markers are reported', () => {
  const before = project([])
  const after = project([], {
    assets: [...before.assets, asset('a3', 'logo.png', { kind: 'image' })],
    timelines: [{ ...before.timelines[0]!, width: 1080, height: 1920, markers: [{ id: 'm', frame: 30, label: 'Hook' }] }]
  })
  assert.deepEqual(texts(describeChanges(before, after)), [
    'Imported “logo.png”',
    'Canvas 1920×1080 → 1080×1920',
    'Added marker “Hook” at 0:01:00'
  ])
})

test('captions read as the clips they became, not also as imported text assets', () => {
  // The first live run listed every caption twice: "Imported “Caption: …”" and "Added …".
  const before = project([])
  const text = asset('t1', 'Caption: Hello', { kind: 'text', text: 'Hello', path: null })
  const after = project([item('c1', 't1', 0, 30)], { assets: [...before.assets, text] })
  assert.deepEqual(texts(describeChanges(before, after)), ['Added “Hello” on V1, 0:00:00–0:01:00'])
})

test('a long turn is summarised with a count rather than a wall of lines', () => {
  const before = project([])
  const after = project(Array.from({ length: 30 }, (_, i) => item(`i${i}`, 'a1', i * 10, 10)))
  const lines = describeChanges(before, after)
  assert.equal(lines.length, 14)
  assert.equal(lines[13]!.text, '…and 17 more changes')
})
