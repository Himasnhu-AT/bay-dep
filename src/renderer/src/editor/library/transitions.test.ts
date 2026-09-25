/**
 * The Effects Library's transitions: a click puts one on a cut without ⌘T, on the cut the user
 * pointed at, and on an audio track when it is an audio transition.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { activeTimeline, type Asset, type Item, type Project, type Timeline } from '@shared/project'
import { emptyProject, useEditor } from '@/store/editor'
import { applyTransition, targetJunction } from './transitions'

function shot(id: string): Asset {
  return {
    id, kind: 'video', name: `${id}.mp4`, path: `/m/${id}.mp4`, durationUs: 60_000_000,
    width: 1920, height: 1080, fps: 30, hasAudio: true, hasVideo: true, posterPath: null,
    waveformPath: null, createdAt: 0
  }
}

// Each clip starts 5 s into its 60 s source, so every cut has handles either side.
function clip(id: string, trackId: string, from: number, duration: number): Item {
  return {
    id, assetId: id, trackId, from, durationInFrames: duration, sourceStartUs: 5_000_000,
    layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
    volume: 1, fadeInFrames: 0, fadeOutFrames: 0, speed: 1
  }
}

/** V1: A 0–60, B 60–120, C 120–180. A1: M 0–90, N 90–180. Playhead 100. */
function load(): void {
  const project: Project = emptyProject()
  const timeline = project.timelines[0]!
  const video = timeline.tracks.find((t) => t.kind === 'video')!
  const audio = timeline.tracks.find((t) => t.kind === 'audio')!
  for (const id of ['A', 'B', 'C', 'M', 'N']) project.assets.push(shot(id))
  video.items.push(clip('A', video.id, 0, 60), clip('B', video.id, 60, 60), clip('C', video.id, 120, 60))
  audio.items.push(clip('M', audio.id, 0, 90), clip('N', audio.id, 90, 90))
  useEditor.getState().setProject(project, { resetHistory: true })
  useEditor.setState({ selection: [], playhead: 100, toast: null, screen: 'editor' })
}

const s = () => useEditor.getState()
const tl = (): Timeline => activeTimeline(s().project)!

test('with nothing selected, the cut nearest the playhead on a track of that kind', () => {
  load()
  assert.equal(targetJunction(s().project, tl(), 100, 'video', [])?.cutFrame, 120)
  assert.equal(targetJunction(s().project, tl(), 100, 'audio', [])?.cutFrame, 90)
})

test('two selected clips that meet name their own cut, however far the playhead is', () => {
  load()
  assert.equal(targetJunction(s().project, tl(), 170, 'video', ['A', 'B'])?.cutFrame, 60)
  // One selected clip only prefers its track; it does not pick a cut by itself.
  assert.equal(targetJunction(s().project, tl(), 170, 'video', ['A'])?.cutFrame, 120)
})

test('applying adds the transition on the target cut as one undo step, and says where', () => {
  load()
  const pastBefore = s().past.length
  const done = applyTransition('iris', 'video', 'Iris')
  assert.equal(done?.cutFrame, 120)
  const stored = tl().transitions ?? []
  assert.equal(stored.length, 1)
  assert.equal(stored[0]!.kind, 'iris')
  assert.equal(stored[0]!.fromItemId, 'B')
  assert.equal(stored[0]!.toItemId, 'C')
  assert.equal(s().past.length, pastBefore + 1)
  assert.match(s().toast?.text ?? '', /Iris added to the cut at .* on V1/)
})

test('applying to a cut that has one changes its kind in place, keeping its id and length', () => {
  load()
  applyTransition('cross-dissolve', 'video', 'Cross Dissolve')
  const first = tl().transitions![0]!
  applyTransition('push', 'video', 'Push')
  const after = tl().transitions!
  assert.equal(after.length, 1)
  assert.equal(after[0]!.id, first.id)
  assert.equal(after[0]!.kind, 'push')
  assert.equal(after[0]!.durationInFrames, first.durationInFrames)
  assert.equal(after[0]!.direction, 'left', 'a travelling kind gets a direction')
})

test('an audio transition goes on the audio track’s cut, not the picture’s', () => {
  load()
  const done = applyTransition('cross-dissolve', 'audio', 'Cross-fade')
  assert.equal(done?.cutFrame, 90)
  assert.equal(tl().transitions![0]!.fromItemId, 'M')
})

test('no cut, or no room, is a message — and nothing is stored', () => {
  load()
  // A lone clip: no cut anywhere on V1 once B and C are gone.
  const bare = structuredClone(s().project)
  const v = activeTimeline(bare)!.tracks.find((t) => t.kind === 'video')!
  v.items = v.items.filter((i) => i.id === 'A')
  s().setProject(bare, { resetHistory: true })
  assert.equal(applyTransition('iris', 'video', 'Iris'), null)
  assert.match(s().toast?.text ?? '', /no cut/)
  assert.equal((tl().transitions ?? []).length, 0)

  // Clips that use their whole source have nothing to blend: the refusal names the side.
  load()
  const full = structuredClone(s().project)
  for (const item of activeTimeline(full)!.tracks.flatMap((t) => t.items)) {
    item.sourceStartUs = 0
    item.durationInFrames = 1800
  }
  const vt = activeTimeline(full)!.tracks.find((t) => t.kind === 'video')!
  vt.items = [vt.items[0]!, { ...vt.items[1]!, from: 1800 }]
  s().setProject(full, { resetHistory: true })
  assert.equal(applyTransition('iris', 'video', 'Iris'), null)
  assert.match(s().toast?.text ?? '', /footage/)
  assert.equal((tl().transitions ?? []).length, 0)
})
