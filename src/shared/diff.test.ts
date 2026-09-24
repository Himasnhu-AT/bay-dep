/**
 * The change summaries shown after an agent turn. Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Adjustments, Asset, Item, Project, TextStyle, Transition } from './project'
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
    'Added “broll.mp4” on V1, 00:00:05:00–00:00:07:00',
    'Removed “interview.mp4” from V1, 00:00:00:00–00:00:05:00'
  ])
})

test('a clip is compared by id: moved is moved, not removed and re-added', () => {
  const before = project([item('i1', 'a1', 0, 150)])
  const after = project([item('i1', 'a1', 30, 150)])
  assert.deepEqual(texts(describeChanges(before, after)), ['Moved “interview.mp4” 00:00:00:00 → 00:00:01:00'])
})

test('trims, fades, volume and speed each read as what changed', () => {
  const before = project([item('i1', 'a1', 0, 150)])
  const after = project([item('i1', 'a1', 0, 90, { fadeInFrames: 12, volume: 0.5, speed: 2 })])
  assert.deepEqual(texts(describeChanges(before, after)), [
    'Trimmed “interview.mp4” to 00:00:00:00–00:00:03:00',
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
    'Added marker “Hook” at 00:00:01:00'
  ])
})

test('captions read as the clips they became, not also as imported text assets', () => {
  // The first live run listed every caption twice: "Imported “Caption: …”" and "Added …".
  const before = project([])
  const text = asset('t1', 'Caption: Hello', { kind: 'text', text: 'Hello', path: null })
  const after = project([item('c1', 't1', 0, 30)], { assets: [...before.assets, text] })
  assert.deepEqual(texts(describeChanges(before, after)), ['Added “Hello” on V1, 00:00:00:00–00:00:01:00'])
})

test('a long turn is summarised with a count rather than a wall of lines', () => {
  const before = project([])
  const after = project(Array.from({ length: 30 }, (_, i) => item(`i${i}`, 'a1', i * 10, 10)))
  const lines = describeChanges(before, after)
  assert.equal(lines.length, 14)
  assert.equal(lines[13]!.text, '…and 17 more changes')
})

test('renaming a track is one line, not a move of every clip on it', () => {
  const before = project([item('i1', 'a1', 0, 150)])
  const after = structuredClone(before)
  after.timelines[0]!.tracks[0]!.name = 'Interview'
  assert.deepEqual(texts(describeChanges(before, after)), ['Renamed track V1 to Interview'])
})

test('track flags, background and marker edits are each reported', () => {
  const before = project([], {})
  before.timelines[0]!.markers = [{ id: 'm', frame: 30, label: 'Hook' }]
  const after = structuredClone(before)
  const timeline = after.timelines[0]!
  timeline.tracks[0]!.muted = true
  timeline.tracks[0]!.locked = true
  timeline.background = '#ffffff'
  timeline.markers![0]!.frame = 60
  assert.deepEqual(texts(describeChanges(before, after)), [
    'Background #000 → #ffffff',
    'Muted track V1',
    'Locked track V1',
    'Moved marker “Hook” 00:00:01:00 → 00:00:02:00'
  ])
})

test('a clip moved to another track is still reported as moved', () => {
  const before = project([item('i1', 'a1', 0, 150)])
  before.timelines[0]!.tracks.push({ id: 'v2', kind: 'video', name: 'V2', locked: false, muted: false, hidden: false, items: [] })
  const after = structuredClone(before)
  const [moved] = after.timelines[0]!.tracks[0]!.items.splice(0, 1)
  after.timelines[0]!.tracks[1]!.items.push({ ...moved!, trackId: 'v2' })
  assert.deepEqual(texts(describeChanges(before, after)), ['Moved “interview.mp4” from V1 to V2'])
})

// ---------------------------------------------------------------------------
// The rest of the vocabulary: every kind of change the card can report.
// ---------------------------------------------------------------------------

/** Two clips that meet at frame 150, so a transition has a junction to sit on. */
const junction = (transitions: Transition[] = []): Project => {
  const p = project([item('i1', 'a1', 0, 150), item('i2', 'a2', 150, 150)])
  p.timelines[0]!.transitions = transitions
  return p
}

const dissolve: Transition = { id: 'tr1', kind: 'cross-dissolve', fromItemId: 'i1', toItemId: 'i2', durationInFrames: 10 }

test('a transition added, changed and removed each reads as such — and one left alone is silent', () => {
  assert.deepEqual(texts(describeChanges(junction(), junction([dissolve]))), ['Added a cross-dissolve (10 frames)'])
  assert.deepEqual(
    texts(describeChanges(junction([dissolve]), junction([{ ...dissolve, kind: 'wipe', durationInFrames: 12 }]))),
    ['Changed a transition to wipe (12 frames)']
  )
  assert.deepEqual(texts(describeChanges(junction([dissolve]), junction())), ['Removed a cross-dissolve'])
  // Positive control for the three above: the same transition on both sides is no change.
  assert.deepEqual(describeChanges(junction([dissolve]), junction([{ ...dissolve }])), [])
})

test('renaming the project is reported with the new name', () => {
  const before = project([])
  assert.deepEqual(texts(describeChanges(before, { ...before, name: 'Final cut' })), ['Renamed the project to “Final cut”'])
})

test('a slip is reported; a left trim that also moves the in-point is a trim, not a slip', () => {
  const before = project([item('i1', 'a1', 0, 150)])
  const slipped = project([item('i1', 'a1', 0, 150, { sourceStartUs: 2_500_000 })])
  assert.deepEqual(texts(describeChanges(before, slipped)), ['Slipped “interview.mp4” to start 2.50s into its source'])
  // Trimming the head moves `from` and the in-point together; that is one edit, a trim.
  const trimmed = project([item('i1', 'a1', 30, 120, { sourceStartUs: 1_000_000 })])
  assert.deepEqual(texts(describeChanges(before, trimmed)), ['Trimmed “interview.mp4” to 00:00:01:00–00:00:05:00'])
})

test('each property of a clip’s picture reports its own line, and only its own', () => {
  const base = item('i1', 'a1', 0, 150)
  const cases: [string, Partial<Item>][] = [
    ['Repositioned “interview.mp4”', { layout: { ...base.layout, left: 100 } }],
    ['Cropped “interview.mp4”', { crop: { left: 0.1, top: 0, right: 0, bottom: 0 } }],
    ['Adjusted the look of “interview.mp4”', { adjustments: { brightness: 1.2 } as Adjustments }],
    ['Blend mode of “interview.mp4”: normal → screen', { blendMode: 'screen' }],
    ['Restyled the text of “interview.mp4”', { text: { fontFamily: 'Helvetica' } as TextStyle }],
    ['Changed the content of “interview.mp4”', { variables: { headline: 'Hello' } }]
  ]
  for (const [line, change] of cases) {
    const after = project([{ ...base, ...change }])
    assert.deepEqual(texts(describeChanges(project([base]), after)), [line])
  }
})

test('a blend mode set back to normal names both ends', () => {
  const before = project([item('i1', 'a1', 0, 150, { blendMode: 'multiply' })])
  const after = project([item('i1', 'a1', 0, 150)])
  assert.deepEqual(texts(describeChanges(before, after)), ['Blend mode of “interview.mp4”: multiply → normal'])
})

test('media removed from the pool is reported; a text asset going with its caption is not', () => {
  const before = project([])
  const after = project([], { assets: [before.assets[0]!] })
  assert.deepEqual(texts(describeChanges(before, after)), ['Removed “broll.mp4” from the media'])

  const text = asset('t1', 'Caption: Hello', { kind: 'text', text: 'Hello', path: null })
  const withCaption = project([], { assets: [...before.assets, text] })
  assert.deepEqual(describeChanges(withCaption, before), [], 'the text asset is bookkeeping')
})

test('changing a caption’s words reads as the old words and the new', () => {
  const text = asset('t1', 'Caption: Hello', { kind: 'text', text: 'Hello', path: null })
  const before = project([item('c1', 't1', 0, 30)], { assets: [text] })
  const after = project([item('c1', 't1', 0, 30)], { assets: [{ ...text, text: 'Goodbye' }] })
  assert.deepEqual(texts(describeChanges(before, after)), ['Changed the text of “Hello” to “Goodbye”'])
})

test('a frame-rate change is reported with both rates', () => {
  const before = project([])
  const after = structuredClone(before)
  after.timelines[0]!.fps = 25
  assert.deepEqual(texts(describeChanges(before, after)), ['Frame rate 30 → 25'])
})

test('fourteen changes are all shown; the fifteenth turns the last line into a count', () => {
  const many = (n: number): Project => project(Array.from({ length: n }, (_, i) => item(`i${i}`, 'a1', i * 10, 10)))
  const fourteen = describeChanges(project([]), many(14))
  assert.equal(fourteen.length, 14)
  assert.ok(fourteen.every((line) => !line.text.includes('more changes')), 'fourteen fit, so none is summarised')
  assert.equal(fourteen[13]!.text, 'Added “interview.mp4” on V1, 00:00:04:10–00:00:04:20')

  const fifteen = describeChanges(project([]), many(15))
  assert.equal(fifteen.length, 14)
  assert.equal(fifteen[12]!.text, 'Added “interview.mp4” on V1, 00:00:04:00–00:00:04:10', 'thirteen real lines')
  assert.equal(fifteen[13]!.text, '…and 2 more changes')
})
