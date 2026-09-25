import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptyProject } from '@/store/editor'
import type { Asset, Item } from '@shared/project'
import { editRows } from './indexLists'

function asset(id: string): Asset {
  return {
    id, kind: 'video', name: `${id}.mp4`, path: `/m/${id}.mp4`, durationUs: 60_000_000, width: 1920,
    height: 1080, fps: 30, hasAudio: true, hasVideo: true, posterPath: null, waveformPath: null, createdAt: 0
  }
}

function clip(id: string, trackId: string, from: number, duration: number): Item {
  return {
    id, assetId: id, trackId, from, durationInFrames: duration, sourceStartUs: 0,
    layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
    volume: 1, fadeInFrames: 0, fadeOutFrames: 0, speed: 1
  }
}

test('touching clips make one cut row naming both clips and the transition; gaps make start and end rows', () => {
  const project = emptyProject()
  const timeline = project.timelines[0]!
  const video = timeline.tracks.find((t) => t.kind === 'video')!
  const audio = timeline.tracks.find((t) => t.kind === 'audio')!
  for (const id of ['A', 'B', 'C', 'M']) project.assets.push(asset(id))
  // Out of order on purpose: rows are by time, not by the order items are stored.
  video.items.push(clip('C', video.id, 150, 30), clip('B', video.id, 60, 60), clip('A', video.id, 0, 60))
  audio.items.push(clip('M', audio.id, 60, 30))
  timeline.transitions = [{ id: 'trn', kind: 'wipe', fromItemId: 'A', toItemId: 'B', durationInFrames: 10 }]

  const rows = editRows(project, timeline)
  const described = rows.map((r) => `${r.frame} ${r.trackName} ${r.kind} ${r.from?.name ?? '-'}>${r.to?.name ?? '-'}${r.transition ? ` ${r.transition}` : ''}`)
  assert.deepEqual(described, [
    `0 ${video.name} start ->A.mp4`,
    `60 ${video.name} cut A.mp4>B.mp4 wipe`,
    `60 ${audio.name} start ->M.mp4`,
    `90 ${audio.name} end M.mp4>-`,
    `120 ${video.name} end B.mp4>-`,
    `150 ${video.name} start ->C.mp4`,
    `180 ${video.name} end C.mp4>-`
  ])
  assert.equal(new Set(rows.map((r) => r.key)).size, rows.length, 'keys are unique')
})

test('an empty timeline has no edits', () => {
  const project = emptyProject()
  assert.deepEqual(editRows(project, project.timelines[0]!), [])
})
