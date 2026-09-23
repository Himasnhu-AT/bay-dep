/**
 * The preview's routing of J/L cuts and ducking — the half that can be checked without a browser.
 *
 * What this pins is that the preview *asks* the shared gain function rather than deciding for
 * itself, and that a detached sound is played from its own element at the right source time.
 * Export's half is rendered and measured in `main/export/audio-render.test.ts`; the real mixer
 * is metered by `test/app/audio-finish.mjs`. Each covers one path, and says which.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { audioRoutingAt } from './audio'
import { itemAudioGainAt } from '@shared/audio-gain'
import type { Asset, Item, Project, Timeline, Track } from '@shared/project'

const FPS = 30

function asset(id: string): Asset {
  return {
    id,
    kind: 'video',
    name: `${id}.mp4`,
    path: `/m/${id}.mp4`,
    durationUs: 60_000_000,
    width: 1920,
    height: 1080,
    fps: FPS,
    hasAudio: true,
    hasVideo: true,
    posterPath: null,
    waveformPath: null,
    createdAt: 0
  }
}

function clip(id: string, assetId: string, trackId: string, from: number, duration: number, sourceStartUs: number, extra: Partial<Item> = {}): Item {
  return {
    id,
    assetId,
    trackId,
    from,
    durationInFrames: duration,
    sourceStartUs,
    layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
    volume: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    speed: 1,
    ...extra
  }
}

function track(id: string, kind: Track['kind'], items: Item[]): Track {
  return { id, kind, name: id, locked: false, muted: false, hidden: false, items }
}

/**
 * V1: A (0–90) then B (90–150) with a 15-frame J lead reading from 2 s. A2: a music bed ducked
 * under V1, with a fade-out. A dissolve would take B's lead away, so there is none on this cut.
 */
function fixture(): { project: Project; timeline: Timeline } {
  const timeline: Timeline = {
    id: 'tl',
    name: 'T',
    fps: FPS,
    width: 1920,
    height: 1080,
    background: '#000',
    tracks: [
      track('v1', 'video', [
        clip('A', 'shot', 'v1', 0, 90, 5_000_000, { fadeOutFrames: 6 }),
        clip('B', 'shot', 'v1', 90, 60, 2_000_000, { audioLeadFrames: 15, fadeInFrames: 3 })
      ]),
      track('a2', 'audio', [
        clip('M', 'bed', 'a2', 0, 200, 0, {
          fadeOutFrames: 20,
          duck: { keyTrackId: 'v1', amountDb: 9, attackFrames: 6, releaseFrames: 12 }
        })
      ])
    ],
    transitions: []
  }
  return {
    project: { id: 'p', name: 'p', version: 1, assets: [asset('shot'), asset('bed')], timelines: [timeline], activeTimelineId: 'tl', createdAt: 0, updatedAt: 0 },
    timeline
  }
}

test('every routed gain is the shared gain, frame for frame', () => {
  const { project, timeline } = fixture()
  let compared = 0
  for (let frame = 0; frame < 200; frame += 1) {
    for (const routed of audioRoutingAt(project, timeline, frame)) {
      assert.equal(routed.gain, itemAudioGainAt(project, timeline, routed.item, frame), `${routed.item.id} at ${frame}`)
      compared += 1
    }
  }
  assert.ok(compared > 300, `the sweep must actually compare something (${compared})`)
})

test("a J-cut's sound is routed under the previous shot, from its own element, at the handle's source time", () => {
  const { project, timeline } = fixture()
  const at80 = audioRoutingAt(project, timeline, 80).find((r) => r.item.id === 'B')
  assert.ok(at80, 'B must sound 10 frames before its picture')
  assert.ok(at80.detached, 'as a detached sound')
  assert.equal(at80.asset.kind, 'audio', 'from an <audio> stand-in, not the picture element')
  assert.notEqual(at80.asset.id, 'shot', 'with an id of its own, so the pool gives it its own element')
  assert.equal(at80.asset.path, '/m/shot.mp4', 'over the same file')
  // 2.0 s in-point, 10 frames earlier.
  assert.ok(Math.abs(at80.detached.mediaSeconds - (2 - 10 / FPS)) < 1e-6, `source ${at80.detached.mediaSeconds}`)
  assert.equal(at80.detached.claim, null, 'nothing to claim while its picture is not drawn')
  // Positive control: the frame before the lead, it is not routed at all.
  assert.equal(audioRoutingAt(project, timeline, 74).find((r) => r.item.id === 'B'), undefined)
})

test('once its picture is drawn, the detached sound keeps its element and silences the picture element', () => {
  const { project, timeline } = fixture()
  const at100 = audioRoutingAt(project, timeline, 100).find((r) => r.item.id === 'B')
  assert.ok(at100?.detached, 'still detached inside its own span — no seam at the picture cut')
  assert.equal(at100.asset.id, audioRoutingAt(project, timeline, 80).find((r) => r.item.id === 'B')?.asset.id, 'the same element as the lead')
  assert.deepEqual(at100.detached.claim, { asset: project.assets[0], slot: 0 }, 'the drawn picture element is claimed')
})

test('an item without J/L offsets is routed exactly as before: its own element, no stand-in', () => {
  const { project, timeline } = fixture()
  const a = audioRoutingAt(project, timeline, 40).find((r) => r.item.id === 'A')
  assert.ok(a)
  assert.equal(a.detached, undefined)
  assert.equal(a.asset.id, 'shot')
})

test('the bed is ducked while V1 sounds, including under B\'s lead', () => {
  const { project, timeline } = fixture()
  const bed = (frame: number): number =>
    audioRoutingAt(project, timeline, frame).find((r) => r.item.id === 'M')?.gain ?? Number.NaN
  const down = 10 ** (-9 / 20)
  assert.ok(Math.abs(bed(40) - down) < 1e-12, `under A: ${bed(40)}`)
  assert.ok(Math.abs(bed(80) - down) < 1e-12, `under B's lead: ${bed(80)}`)
  assert.equal(bed(170), 1, 'up again after the release')
})
