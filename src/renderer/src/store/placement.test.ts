/**
 * Where a clip aimed at a lane lands (`placementTrack`, and the store's `placeAsset` over it).
 *
 * The defect: a media tile dropped on a lane went onto that lane whatever was there — a still on
 * top of a clip on V1, three drops at one frame stacking three clips, a sound file on V1 becoming
 * a clip on a video track. Placement never overwrites; it finds room.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { activeTimeline, itemsOverlap, type Asset, type Item, type Project, type Timeline, type Track } from '@shared/project'
import { placementTrack } from './factory'
import { emptyProject, useEditor } from './editor'
import { placeAsset as placeAssetTool } from '@/mcp/write'

const track = (id: string, kind: Track['kind'], items: Item[] = [], locked = false): Track =>
  ({ id, name: id, kind, locked, muted: false, hidden: false, items }) as Track

const span = (id: string, from: number, duration: number): Item =>
  ({ id, from, durationInFrames: duration }) as Item

// Array order V1, V2, A1, A2; drawn top to bottom V2, V1, A1, A2.
function tl(v1: Item[] = [], v2: Item[] = [], a1: Item[] = [], a2: Item[] = []): Timeline {
  return { tracks: [track('V1', 'video', v1), track('V2', 'video', v2), track('A1', 'audio', a1), track('A2', 'audio', a2)] } as Timeline
}

test('an aimed-at lane of the right kind with room is used as given', () => {
  // Positive control: the common drop is not second-guessed. V1 is the first video track with
  // room, so aiming at V2 tells "the lane" apart from "the first with room".
  assert.equal(placementTrack(tl(), 'video', 100, 30, 'V2')?.id, 'V2')
  assert.equal(placementTrack(tl(), 'audio', 100, 30, 'A2')?.id, 'A2')
})

test('a lane with a clip in the way sends the clip to the nearest track with room', () => {
  const occupied = tl([span('speech', 150, 181)])
  const lane = occupied.tracks[0]!
  // Specimen: the span really does collide with what is on the aimed-at lane.
  assert.ok(lane.items.some((i) => itemsOverlap(i, span('x', 296, 30))))
  assert.equal(placementTrack(occupied, 'video', 296, 30, 'V1')?.id, 'V2')
  // Past the clip, V1 has room again and is used.
  assert.equal(placementTrack(occupied, 'video', 331, 30, 'V1')?.id, 'V1')
  // Nothing of the kind has room: null, and the caller adds a lane.
  assert.equal(placementTrack(tl([span('a', 0, 400)], [span('b', 0, 400)]), 'video', 296, 30, 'V1'), null)
  // A locked lane is not room either.
  const locked = { tracks: [track('V1', 'video', [], true), track('V2', 'video')] } as Timeline
  assert.equal(placementTrack(locked, 'video', 0, 30, 'V1')?.id, 'V2')
})

test('a lane of the wrong kind sends the clip to the nearest lane of the right kind', () => {
  // A sound aimed at V1 goes to A1 (directly below V1), not A2; a picture aimed at A2 goes to V1
  // (the nearer video lane), not V2.
  assert.equal(placementTrack(tl(), 'audio', 296, 30, 'V1')?.id, 'A1')
  assert.equal(placementTrack(tl(), 'video', 296, 30, 'A2')?.id, 'V1')
  // Nearest by what is drawn, not by array position: from A1, V1 is drawn directly above it while
  // V2 is next to it in the array.
  assert.equal(placementTrack(tl(), 'video', 10, 30, 'A1')?.id, 'V1')
  // An occupied nearest lane passes to the next one.
  assert.equal(placementTrack(tl([], [], [span('m', 0, 400)]), 'audio', 10, 30, 'V1')?.id, 'A2')
})

// -- through the store -----------------------------------------------------------------------

function asset(id: string, kind: Asset['kind'], hasVideo: boolean, seconds: number): Asset {
  return {
    id, kind, name: `${id}`, path: `/m/${id}`, durationUs: seconds * 1_000_000, width: hasVideo ? 1920 : null,
    height: hasVideo ? 1080 : null, fps: hasVideo ? 30 : null, hasAudio: kind !== 'image', hasVideo,
    posterPath: null, waveformPath: null, createdAt: 0
  }
}

function load(): { v1: string; a1: string } {
  const project: Project = emptyProject()
  project.assets.push(asset('clip', 'video', true, 10), asset('still', 'image', false, 0), asset('tone', 'audio', false, 2))
  const timeline = project.timelines[0]!
  const v1 = timeline.tracks.find((t) => t.kind === 'video')!
  v1.items.push({
    id: 'speech', assetId: 'clip', trackId: v1.id, from: 150, durationInFrames: 181, sourceStartUs: 0,
    layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
    volume: 1, fadeInFrames: 0, fadeOutFrames: 0, speed: 1
  })
  useEditor.getState().setProject(project, { resetHistory: true })
  useEditor.setState({ selection: [], playhead: 0, toast: null, screen: 'editor' })
  return { v1: v1.id, a1: timeline.tracks.find((t) => t.kind === 'audio')!.id }
}

const s = () => useEditor.getState()
const overlapsOnATrack = (): boolean =>
  activeTimeline(s().project)!.tracks.some((t) =>
    t.items.some((a, i) => t.items.some((b, j) => i < j && itemsOverlap(a, b)))
  )
const trackOf = (itemId: string): Track =>
  activeTimeline(s().project)!.tracks.find((t) => t.items.some((i) => i.id === itemId))!

test('a still dropped onto a clip, three times, lands three times without overlapping anything', () => {
  const { v1 } = load()
  const placed = [1, 2, 3].map(() => s().placeAsset('still', 296, v1))
  assert.ok(placed.every(Boolean))
  assert.equal(overlapsOnATrack(), false, 'no two clips share frames on one track')
  assert.equal(new Set(placed.map((id) => trackOf(id!).id)).size, 3, 'each drop found its own track')
  for (const id of placed) assert.equal(trackOf(id!).kind, 'video')
})

test('a sound dropped on V1 becomes a clip on an audio track', () => {
  const { v1, a1 } = load()
  const placed = s().placeAsset('tone', 296, v1)
  assert.ok(placed)
  assert.equal(trackOf(placed).id, a1)
})

test('place_asset with a trackId refuses a clash by name instead of moving the clip', () => {
  const { v1 } = load()
  const trackName = activeTimeline(s().project)!.tracks.find((t) => t.id === v1)!.name
  assert.throws(
    () => placeAssetTool({ assetId: 'still', atFrame: 296, trackId: v1 }),
    (error: Error) => error.message.includes('speech') && error.message.includes('150-331') && error.message.includes(trackName)
  )
  // A negative frame is checked where the store puts it (0), not where it was asked: at -160 a
  // ten-second clip would end at 140, clear of `speech`; at 0 it runs into it, and the store would
  // otherwise have moved it to another track without a word.
  assert.throws(
    () => placeAssetTool({ assetId: 'clip', atFrame: -160, trackId: v1 }),
    (error: Error) => error.message.includes('speech')
  )
  // Positive control: free time on the same track is accepted and lands there.
  const ok = placeAssetTool({ assetId: 'still', atFrame: 400, trackId: v1 }) as { trackId: string; from: number }
  assert.equal(ok.trackId, v1)
  assert.equal(ok.from, 400)
})
