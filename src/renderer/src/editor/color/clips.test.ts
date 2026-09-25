import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Asset, AssetKind, Item, Project, Timeline, Track } from '@shared/project'
import { colorClips, gradePatch, hasLook, lookForProject } from './clips'

function asset(id: string, kind: AssetKind): Asset {
  return {
    id,
    kind,
    name: `${id}.file`,
    path: `/m/${id}`,
    durationUs: 60_000_000,
    width: 1920,
    height: 1080,
    fps: 30,
    hasAudio: kind === 'video' || kind === 'audio',
    hasVideo: kind !== 'audio',
    posterPath: null,
    waveformPath: null,
    createdAt: 0
  }
}

function clip(id: string, assetId: string, trackId: string, from: number, over: Partial<Item> = {}): Item {
  return {
    id,
    assetId,
    trackId,
    from,
    durationInFrames: 30,
    sourceStartUs: 0,
    layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
    volume: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    speed: 1,
    ...over
  }
}

function track(id: string, kind: Track['kind'], items: Item[]): Track {
  return { id, kind, name: id.toUpperCase(), locked: false, muted: false, hidden: false, items }
}

function fixture(tracks: Track[]): { project: Project; timeline: Timeline } {
  const timeline: Timeline = { id: 'tl', name: 'T', fps: 30, width: 1920, height: 1080, background: '#000', tracks, transitions: [] }
  const project: Project = {
    id: 'p',
    name: 'p',
    version: 1,
    assets: [asset('shot', 'video'), asset('still', 'image'), asset('title', 'text'), asset('music', 'audio')],
    timelines: [timeline],
    activeTimelineId: 'tl',
    createdAt: 0,
    updatedAt: 0
  }
  return { project, timeline }
}

test('the strip lists picture clips in time order, numbered, top track first at the same time', () => {
  const { project, timeline } = fixture([
    track('v1', 'video', [clip('late', 'shot', 'v1', 60), clip('early', 'shot', 'v1', 0)]),
    track('v2', 'video', [clip('over', 'still', 'v2', 0)])
  ])
  const clips = colorClips(project, timeline)
  assert.deepEqual(clips.map((entry) => entry.item.id), ['over', 'early', 'late'])
  assert.deepEqual(clips.map((entry) => entry.number), [1, 2, 3])
  assert.equal(clips[0]?.trackName, 'V2')
})

test('text and sound are not on the strip, because a grade cannot draw on them', () => {
  const { project, timeline } = fixture([
    track('v1', 'video', [clip('shot', 'shot', 'v1', 0), clip('caption', 'title', 'v1', 30)]),
    track('a1', 'audio', [clip('bed', 'music', 'a1', 0), clip('dialogue', 'shot', 'a1', 30)])
  ])
  // Positive control: the same asset kind on a video track is listed.
  assert.deepEqual(colorClips(project, timeline).map((entry) => entry.item.id), ['shot'])
})

test('a clip is marked adjusted only when its look changes the picture', () => {
  assert.equal(hasLook({}), false, 'no grade, no adjustments')
  assert.equal(hasLook({ grade: { saturation: 1 } }), false, 'an identity grade draws untouched')
  assert.equal(hasLook({ grade: { saturation: 0.5 } }), true)
  assert.equal(
    hasLook({ adjustments: { brightness: 1.2, contrast: 1, saturate: 1, hueRotate: 0, blur: 0, grayscale: 0, sepia: 0, invert: 0 } }),
    true
  )
  const { project, timeline } = fixture([
    track('v1', 'video', [clip('plain', 'shot', 'v1', 0), clip('warm', 'shot', 'v1', 30, { grade: { temperature: 400 } })])
  ])
  assert.deepEqual(colorClips(project, timeline).map((entry) => entry.adjusted), [false, true])
})

test('pasting a grade carries the grade and adjustments, keeps the blend mode, and pastes "none" as removal', () => {
  const warm = { temperature: 400 }
  const target = clip('t', 'shot', 'v1', 0, { grade: { saturation: 0.2 }, blendMode: 'screen', volume: 0.5 })
  const patch = gradePatch({ grade: warm }, target)
  assert.deepEqual(patch.grade, warm)
  assert.notEqual(patch.grade, warm, 'a copy, so a later edit of the source clip does not reach the pasted one')
  assert.ok(!('blendMode' in patch), 'the blend mode is the target\'s own')
  assert.ok(!('volume' in patch), 'nothing but the look')
  // A clip with no look, copied and pasted, takes the look off — as Paste Attributes does.
  const cleared = gradePatch({}, target)
  assert.ok('grade' in cleared && cleared.grade === undefined, 'grade removed, not left as it was')
  assert.ok('adjustments' in cleared && cleared.adjustments === undefined)
})

test('a copied LUT this project does not have is left out of the paste; one it has is kept', () => {
  const look = { grade: { temperature: 400, lut: { assetId: 'cube', intensity: 0.5 } } }
  // Copied in another project: nothing here is called "cube".
  const elsewhere = lookForProject(look, { assets: [asset('shot', 'video')] })
  assert.equal(elsewhere.droppedLut, 'cube')
  assert.deepEqual(elsewhere.look.grade, { temperature: 400 }, 'the rest of the grade still pastes')
  // An asset with that id that is not a LUT is not the LUT.
  assert.equal(lookForProject(look, { assets: [asset('cube', 'video')] }).droppedLut, 'cube')
  // A LUT-only grade leaves no grade behind, not an empty one.
  assert.equal(lookForProject({ grade: { lut: { assetId: 'cube', intensity: 1 } } }, { assets: [] }).look.grade, undefined)
  // The positive control: in the project that has the LUT, the look pastes whole.
  const here = lookForProject(look, { assets: [asset('cube', 'lut')] })
  assert.equal(here.droppedLut, null)
  assert.deepEqual(here.look.grade, look.grade)
})
