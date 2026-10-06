/**
 * Where an effect dragged from the library lands: the clip under the pointer, a reason when that
 * clip cannot take one, and nothing over a gap.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Asset, Item, Project, Timeline, Track } from '@shared/project'
import { EFFECT_KINDS } from '@shared/effects/index'
import { decodeEffectDrag, effectDropTarget, encodeEffectDrag } from './effectDrag'

function asset(id: string, kind: Asset['kind']): Asset {
  return {
    id, kind, name: id, path: `/m/${id}`, durationUs: 0, width: 1920, height: 1080, fps: 30,
    hasAudio: kind === 'audio', hasVideo: kind !== 'audio', posterPath: null, waveformPath: null, createdAt: 0
  }
}

function clip(id: string, trackId: string, from: number, assetId: string): Item {
  return {
    id, assetId, trackId, from, durationInFrames: 50, sourceStartUs: 0,
    layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
    volume: 1, fadeInFrames: 0, fadeOutFrames: 0, speed: 1
  }
}

const track = (id: string, kind: Track['kind'], items: Item[], locked = false): Track =>
  ({ id, kind, name: id.toUpperCase(), items, locked, muted: false, hidden: false }) as Track

const timeline = {
  id: 'tl', name: 'T', fps: 30, width: 1920, height: 1080,
  tracks: [
    track('v1', 'video', [clip('shot', 'v1', 0, 'video'), clip('title', 'v1', 100, 'text')]),
    track('v2', 'video', [clip('held', 'v2', 0, 'video')], true),
    track('a1', 'audio', [clip('music', 'a1', 0, 'audio')])
  ]
} as unknown as Timeline
const project = { assets: [asset('video', 'video'), asset('text', 'text'), asset('audio', 'audio')] } as unknown as Project

test('a drop lands on the clip under the pointer, by half-open frame range', () => {
  const at = (frame: number) => effectDropTarget(project, timeline, 'v1', frame)
  assert.deepEqual(at(0), { ok: true, item: timeline.tracks[0]?.items[0] })
  assert.deepEqual(at(49), { ok: true, item: timeline.tracks[0]?.items[0] })
  // Frame 50 is the first frame after the clip: a gap, which is not a guess at the nearest clip.
  assert.equal(at(50), null)
  assert.equal(at(75), null)
  assert.equal(effectDropTarget(project, timeline, 'nope', 10), null)
})

test('a clip that cannot take an effect says why instead of taking it', () => {
  const title = effectDropTarget(project, timeline, 'v1', 120)
  assert.ok(title && !title.ok)
  assert.match(title.reason, /Title tab/)
  const locked = effectDropTarget(project, timeline, 'v2', 10)
  assert.ok(locked && !locked.ok)
  assert.match(locked.reason, /V2 is locked/)
  const sound = effectDropTarget(project, timeline, 'a1', 10)
  assert.ok(sound && !sound.ok)
  assert.match(sound.reason, /clips with a picture/)
})

test('the payload carries a catalog effect and nothing else decodes', () => {
  for (const kind of EFFECT_KINDS) assert.equal(decodeEffectDrag(encodeEffectDrag(kind))?.kind, kind)
  assert.equal(decodeEffectDrag(encodeEffectDrag('glow'))?.label, 'Glow')
  assert.equal(decodeEffectDrag(encodeEffectDrag('lens-flare')), null)
  assert.equal(decodeEffectDrag(''), null)
  assert.equal(decodeEffectDrag('{"kind":7}'), null)
})
