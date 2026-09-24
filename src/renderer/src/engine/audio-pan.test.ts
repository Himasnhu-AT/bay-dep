/**
 * The preview's half of pan: every routing carries `panGains(item.pan)` — the same numbers export
 * writes into its `pan` filter (`main/export/pan-render.test.ts` pins that side and renders it).
 * The Web Audio nodes those numbers are set on cannot run under Node; a running app is the only
 * check of them.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { audioRoutingAt } from './audio'
import { panGains } from '@shared/audio-gain'
import type { Asset, Item, Project, Timeline } from '@shared/project'

function asset(id: string, kind: Asset['kind']): Asset {
  return {
    id, kind, name: id, path: `/m/${id}`, durationUs: 60_000_000, width: kind === 'video' ? 1920 : null,
    height: kind === 'video' ? 1080 : null, fps: 30, hasAudio: true, hasVideo: kind === 'video',
    posterPath: null, waveformPath: null, createdAt: 0
  }
}

function clip(id: string, assetId: string, trackId: string, extra: Partial<Item> = {}): Item {
  return {
    id, assetId, trackId, from: 0, durationInFrames: 90, sourceStartUs: 0,
    layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
    volume: 1, fadeInFrames: 0, fadeOutFrames: 0, speed: 1, ...extra
  }
}

function fixture(videoPan: number | undefined, musicPan: number | undefined): { project: Project; timeline: Timeline } {
  const timeline: Timeline = {
    id: 'tl', name: 'T', fps: 30, width: 1920, height: 1080, background: '#000',
    tracks: [
      { id: 'v1', kind: 'video', name: 'V1', locked: false, muted: false, hidden: false,
        items: [clip('V', 'shot', 'v1', videoPan === undefined ? {} : { pan: videoPan })] },
      { id: 'a1', kind: 'audio', name: 'A1', locked: false, muted: false, hidden: false,
        items: [clip('M', 'bed', 'a1', musicPan === undefined ? {} : { pan: musicPan })] }
    ]
  }
  return {
    timeline,
    project: {
      id: 'p', name: 'p', version: 1, createdAt: 0, updatedAt: 0, activeTimelineId: 'tl',
      assets: [asset('shot', 'video'), asset('bed', 'audio')], timelines: [timeline]
    }
  }
}

test('each clip is routed with its own pan gains, from the one law', () => {
  for (const [videoPan, musicPan] of [[-1, 1], [-0.5, 0.25], [0.7, -0.3], [undefined, 0]] as const) {
    const { project, timeline } = fixture(videoPan, musicPan)
    const routed = audioRoutingAt(project, timeline, 30)
    const video = routed.find((r) => r.item.id === 'V')
    const music = routed.find((r) => r.item.id === 'M')
    assert.ok(video && music, 'both clips sound at frame 30')
    assert.deepEqual(video.pan, panGains(videoPan), `video at pan ${videoPan}`)
    assert.deepEqual(music.pan, panGains(musicPan), `music at pan ${musicPan}`)
  }
})

test('a pan moves the channels and leaves the level alone — gain is the same with and without it', () => {
  const centred = audioRoutingAt(...args(fixture(undefined, undefined)), 30)
  const panned = audioRoutingAt(...args(fixture(-0.8, 0.8)), 30)
  for (const id of ['V', 'M']) {
    const a = centred.find((r) => r.item.id === id)
    const b = panned.find((r) => r.item.id === id)
    assert.equal(a?.gain, b?.gain, `${id}'s gain`)
    // Positive control: the pan itself did change.
    assert.notDeepEqual(a?.pan, b?.pan, `${id}'s pan`)
  }
})

function args({ project, timeline }: { project: Project; timeline: Timeline }): [Project, Timeline] {
  return [project, timeline]
}
