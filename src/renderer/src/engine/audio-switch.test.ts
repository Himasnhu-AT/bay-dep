/**
 * Does a `switch_speakers` angle's sound hop elements at the cuts? The worry: an angle's detached
 * sound plays through its picture's element where the piece is enabled and through an `<audio>`
 * stand-in where it is disabled, so every cut would be an element change — a seek, a click.
 *
 * It does not, and this pins why: the switch razors only the pictures, so the angle's sound stays
 * one clip that lines up with none of the pieces (`soundAlignedWithPicture` needs the same span),
 * and one clip that shares no picture plays from its stand-in for its whole span — the J/L rule,
 * reached by construction. The positive control beside it razors the sound too (what a manual
 * Split of the pair does) and shows the same check does see the hop, so it is not blind to it.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { audioRoutingAt } from './audio'
import { normaliseLinks } from '@shared/links'
import { applyAngleSwitch, type SwitchSegment } from '@shared/speaker-switch'
import { splitItemAt } from '@shared/split'
import { playableTimeline, type Asset, type Item, type Project, type Timeline } from '@shared/project'

const cam = (id: string): Asset => ({
  id, kind: 'video', name: id, path: `/m/${id}`, durationUs: 60_000_000, width: 1920, height: 1080, fps: 30,
  hasAudio: true, hasVideo: true, posterPath: null, waveformPath: null, createdAt: 0
})

const clip = (id: string, assetId: string, trackId: string, extra: Partial<Item> = {}): Item => ({
  id, assetId, trackId, from: 0, durationInFrames: 300, sourceStartUs: 0,
  layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
  volume: 1, fadeInFrames: 0, fadeOutFrames: 0, speed: 1, ...extra
})

function podcast(): { project: Project; timeline: Timeline } {
  const timeline: Timeline = {
    id: 'tl', name: 'T', fps: 30, width: 1920, height: 1080, background: '#000', transitions: [],
    tracks: [
      { id: 'v1', kind: 'video', name: 'V1', locked: false, muted: false, hidden: false,
        items: [clip('A', 'camA', 'v1', { audioDetached: true, linkId: 'LA' })] },
      { id: 'v2', kind: 'video', name: 'V2', locked: false, muted: false, hidden: false,
        items: [clip('B', 'camB', 'v2', { audioDetached: true, linkId: 'LB' })] },
      { id: 'a1', kind: 'audio', name: 'A1', locked: false, muted: false, hidden: false,
        items: [clip('SA', 'camA', 'a1', { linkId: 'LA' })] },
      { id: 'a2', kind: 'audio', name: 'A2', locked: false, muted: false, hidden: false,
        items: [clip('SB', 'camB', 'a2', { linkId: 'LB' })] }
    ]
  }
  const project: Project = {
    id: 'p', name: 'p', version: 1, createdAt: 0, updatedAt: 0, activeTimelineId: 'tl',
    assets: [cam('camA'), cam('camB')], timelines: [timeline]
  }
  return { project, timeline }
}

const SEGMENTS: SwitchSegment[] = [
  { angle: 0, fromFrame: 0, toFrame: 100 },
  { angle: 1, fromFrame: 100, toFrame: 200 },
  { angle: 0, fromFrame: 200, toFrame: 300 }
]

/** Which element angle A's sound plays from at each frame: its picture's, or a stand-in's. */
function elementsOfA(project: Project, timeline: Timeline, frames: number[]): string[] {
  return frames.map((frame) => {
    const routed = audioRoutingAt(project, playableTimeline(timeline), frame).find((r) => r.item.assetId === 'camA' && r.item.trackId === 'a1')
    assert.ok(routed, `A's sound is routed at frame ${frame}`)
    return routed.detached ? `stand-in ${routed.asset.id}` : `picture ${routed.asset.id}#${routed.slot}`
  })
}

test('a switched angle\'s sound stays on one stand-in across every cut, on and off screen', () => {
  const { project, timeline } = podcast()
  let n = 0
  applyAngleSwitch(timeline, ['A', 'B'], SEGMENTS, () => `p${++n}`)
  normaliseLinks(timeline, () => `L${++n}`)
  // Frames either side of both cuts: A on, off, on.
  const frames = [50, 99, 100, 150, 199, 200, 250]
  const elements = elementsOfA(project, timeline, frames)
  assert.equal(new Set(elements).size, 1, elements.join(' | '))
  assert.match(elements[0]!, /^stand-in camA~detached~SA$/)
})

test('positive control: razoring the sound with its picture does make it hop, and the check sees it', () => {
  const { project, timeline } = podcast()
  const sound = timeline.tracks[2]!
  // What a manual Split of the linked pair at each cut does: the sound is cut too.
  for (const at of [100, 200]) {
    const right = splitItemAt(sound.items[sound.items.length - 1]!, at, 30, `SA@${at}`)
    assert.ok(right)
    sound.items.push(right)
  }
  let n = 0
  applyAngleSwitch(timeline, ['A', 'B'], SEGMENTS, () => `p${++n}`)
  normaliseLinks(timeline, () => `L${++n}`)
  const elements = elementsOfA(project, timeline, [50, 150, 250])
  assert.ok(new Set(elements).size > 1, `expected a hop, got ${elements.join(' | ')}`)
  assert.match(elements[0]!, /^picture /, 'an aligned, enabled piece shares its element')
})
