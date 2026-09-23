/**
 * J/L cuts and ducking in the one gain function preview and export share.
 *
 * These pin the arithmetic; `main/export/audio-render.test.ts` renders the same cases through
 * the real ffmpeg and measures them, and `engine/audio-finish.test.ts` checks the preview's
 * routing asks this function rather than deciding for itself.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Asset, Item, Project, Timeline, Track } from './project'
import { framesToUs } from './project'
import { audibleSpan, duckDepth, duckGainAt, itemAudioGainAt, resolveAudioOffsets } from './audio-gain'

const FPS = 30

function asset(id: string, seconds: number, hasAudio = true): Asset {
  return {
    id,
    kind: 'video',
    name: id,
    path: `/m/${id}.mp4`,
    durationUs: seconds * 1_000_000,
    width: 1920,
    height: 1080,
    fps: FPS,
    hasAudio,
    hasVideo: true,
    posterPath: null,
    waveformPath: null,
    createdAt: 0
  }
}

function clip(id: string, trackId: string, from: number, duration: number, sourceFrames: number, extra: Partial<Item> = {}): Item {
  return {
    id,
    assetId: 'src',
    trackId,
    from,
    durationInFrames: duration,
    sourceStartUs: framesToUs(sourceFrames, FPS),
    layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
    volume: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    speed: 1,
    ...extra
  }
}

function track(id: string, items: Item[], muted = false): Track {
  return { id, kind: 'audio', name: id, locked: false, muted, hidden: false, items }
}

function world(tracks: Track[], assets: Asset[] = [asset('src', 60)], transitions: Timeline['transitions'] = []): { project: Project; timeline: Timeline } {
  const timeline: Timeline = {
    id: 'tl',
    name: 'T',
    fps: FPS,
    width: 1920,
    height: 1080,
    background: '#000',
    tracks,
    transitions
  }
  return {
    project: { id: 'p', name: 'p', version: 1, assets, timelines: [timeline], activeTimelineId: 'tl', createdAt: 0, updatedAt: 0 },
    timeline
  }
}

// ---------------------------------------------------------------------------
// J/L cuts
// ---------------------------------------------------------------------------

test('a J-cut sounds from `from - lead`, and not a frame before', () => {
  const b = clip('b', 'a1', 90, 60, 300, { audioLeadFrames: 15 })
  const { project, timeline } = world([track('a1', [b])])
  assert.deepEqual(audibleSpan(project, timeline, b), { firstFrame: 75, endFrame: 150 })
  assert.equal(itemAudioGainAt(project, timeline, b, 74), 0, 'silent before the lead')
  assert.equal(itemAudioGainAt(project, timeline, b, 75), 1, 'full level from the lead on')
  assert.equal(itemAudioGainAt(project, timeline, b, 89), 1, 'under the previous picture')
  // Positive control: without the lead the same frames are silent, so the lead is what did it.
  const plain = { ...b, audioLeadFrames: undefined }
  const bare = world([track('a1', [plain])])
  assert.equal(itemAudioGainAt(bare.project, bare.timeline, plain, 80), 0)
})

test('an L-cut sounds past the picture end by the trail, then stops', () => {
  const a = clip('a', 'a1', 0, 90, 0, { audioTrailFrames: 10 })
  const { project, timeline } = world([track('a1', [a])])
  assert.deepEqual(audibleSpan(project, timeline, a), { firstFrame: 0, endFrame: 100 })
  assert.equal(itemAudioGainAt(project, timeline, a, 99), 1)
  assert.equal(itemAudioGainAt(project, timeline, a, 100), 0)
})

test("fades belong to the sound's edges, so a lead fades in where it starts, not at the picture", () => {
  const b = clip('b', 'a1', 90, 60, 300, { audioLeadFrames: 15, fadeInFrames: 4 })
  const { project, timeline } = world([track('a1', [b])])
  assert.equal(itemAudioGainAt(project, timeline, b, 75), 0, 'the first sounding frame is the fade start')
  assert.equal(itemAudioGainAt(project, timeline, b, 77), 0.5)
  assert.equal(itemAudioGainAt(project, timeline, b, 79), 1, 'full level well before the picture cut')
  assert.equal(itemAudioGainAt(project, timeline, b, 90), 1, 'no second fade at the picture cut')
})

test('a lead is clamped to the footage before the in-point, and the clamp names both numbers', () => {
  // 8 frames of source before the in-point.
  const b = clip('b', 'a1', 90, 60, 8, { audioLeadFrames: 15 })
  const { project, timeline } = world([track('a1', [b])])
  const offsets = resolveAudioOffsets(project, timeline, b)
  assert.equal(offsets.leadFrames, 8)
  assert.match(offsets.clamped.join(' '), /8 frames, not 15/)
  assert.match(offsets.clamped.join(' '), /before this clip's in-point/)
  // Positive control: with room, nothing is clamped and nothing is said.
  const roomy = { ...b, sourceStartUs: framesToUs(300, FPS) }
  const ok = world([track('a1', [roomy])])
  assert.deepEqual(resolveAudioOffsets(ok.project, ok.timeline, roomy), { leadFrames: 15, trailFrames: 0, clamped: [] })
})

test('a trail is clamped to the footage after the out-point', () => {
  // 60 s source, clip reads 59.5 s .. 60 s: nothing after the out-point.
  const a = clip('a', 'a1', 0, 15, 60 * FPS - 15, { audioTrailFrames: 10 })
  const { project, timeline } = world([track('a1', [a])])
  const offsets = resolveAudioOffsets(project, timeline, a)
  assert.equal(offsets.trailFrames, 0)
  assert.match(offsets.clamped.join(' '), /0 frames, not 10/)
})

test('a lead cannot start before frame 0', () => {
  const b = clip('b', 'a1', 6, 60, 300, { audioLeadFrames: 15 })
  const { project, timeline } = world([track('a1', [b])])
  const offsets = resolveAudioOffsets(project, timeline, b)
  assert.equal(offsets.leadFrames, 6)
  assert.match(offsets.clamped.join(' '), /starts at frame 6/)
})

test('a transition on the cut wins over a J/L offset at that end, and says so', () => {
  const a = clip('a', 'a1', 0, 90, 0, { audioTrailFrames: 12 })
  const b = clip('b', 'a1', 90, 60, 300, { audioLeadFrames: 15 })
  const { project, timeline } = world([track('a1', [a, b])], undefined, [
    { id: 'x', kind: 'cross-dissolve', fromItemId: 'a', toItemId: 'b', durationInFrames: 10 }
  ])
  const inOffsets = resolveAudioOffsets(project, timeline, b)
  assert.equal(inOffsets.leadFrames, 0)
  assert.match(inOffsets.clamped.join(' '), /transition on this clip's in-point/)
  assert.equal(resolveAudioOffsets(project, timeline, a).trailFrames, 0)
  // The span is the transition's, not the lead's: 5 frames before the cut, not 15.
  assert.equal(audibleSpan(project, timeline, b).firstFrame, 85)
  assert.equal(itemAudioGainAt(project, timeline, b, 80), 0)
})

test('malformed offsets read as none rather than as NaN frames', () => {
  for (const bad of [Number.NaN, -4, Number.POSITIVE_INFINITY]) {
    const b = clip('b', 'a1', 90, 60, 300, { audioLeadFrames: bad })
    const { project, timeline } = world([track('a1', [b])])
    assert.equal(resolveAudioOffsets(project, timeline, b).leadFrames, 0, String(bad))
    assert.equal(audibleSpan(project, timeline, b).firstFrame, 90, String(bad))
  }
})

// ---------------------------------------------------------------------------
// Ducking
// ---------------------------------------------------------------------------

test('duckDepth: full inside the key, ramps linearly either side, zero outside', () => {
  const span = { firstFrame: 60, endFrame: 100 }
  assert.equal(duckDepth(53, span, 6, 6), 0)
  assert.equal(duckDepth(54, span, 6, 6), 0, 'the attack starts at zero')
  assert.equal(duckDepth(57, span, 6, 6), 0.5)
  assert.equal(duckDepth(60, span, 6, 6), 1, 'fully down by the time the key starts')
  assert.equal(duckDepth(99, span, 6, 6), 1)
  assert.equal(duckDepth(100, span, 6, 6), 1, 'the release starts at the key end')
  assert.equal(duckDepth(103, span, 6, 6), 0.5)
  assert.equal(duckDepth(106, span, 6, 6), 0)
  assert.equal(duckDepth(59, span, 0, 0), 0, 'no attack is a step')
})

function ducked(extra: { muted?: boolean; keyAudio?: boolean; amountDb?: number } = {}) {
  const music = clip('m', 'music', 0, 300, 0, {
    duck: { keyTrackId: 'dialogue', amountDb: extra.amountDb ?? 12, attackFrames: 6, releaseFrames: 6 }
  })
  const line = { ...clip('d', 'dialogue', 60, 40, 0), assetId: 'voice' }
  return {
    music,
    ...world(
      [track('music', [music]), track('dialogue', [line], extra.muted ?? false)],
      [asset('src', 60), asset('voice', 60, extra.keyAudio ?? true)]
    )
  }
}

test('a ducked item sits amountDb down while the key sounds, and at unity elsewhere', () => {
  const { project, timeline, music } = ducked()
  const floor = 10 ** (-12 / 20)
  assert.equal(itemAudioGainAt(project, timeline, music, 30), 1)
  assert.ok(Math.abs(itemAudioGainAt(project, timeline, music, 80) - floor) < 1e-12)
  assert.ok(Math.abs(20 * Math.log10(itemAudioGainAt(project, timeline, music, 80)) + 12) < 1e-9)
  const mid = itemAudioGainAt(project, timeline, music, 57)
  assert.ok(Math.abs(mid - (1 - 0.5 * (1 - floor))) < 1e-12, `half way down the attack, got ${mid}`)
  assert.equal(itemAudioGainAt(project, timeline, music, 150), 1, 'back up after the release')
})

test('a muted key, and a key with no sound, duck nothing — beside a key that does', () => {
  const muted = ducked({ muted: true })
  assert.equal(duckGainAt(muted.project, muted.timeline, muted.music, 80), 1)
  const silent = ducked({ keyAudio: false })
  assert.equal(duckGainAt(silent.project, silent.timeline, silent.music, 80), 1)
  const live = ducked()
  assert.ok(duckGainAt(live.project, live.timeline, live.music, 80) < 0.3, 'the positive control ducks')
})

test("a key's own J-cut lead ducks the music too", () => {
  const { project, timeline, music } = ducked()
  const dialogue = timeline.tracks[1]!
  dialogue.items = [{ ...dialogue.items[0]!, audioLeadFrames: 20, sourceStartUs: framesToUs(300, FPS) }]
  // The line now sounds from 40; the attack ends there.
  assert.ok(duckGainAt(project, timeline, music, 45) < 0.3)
  assert.equal(duckGainAt(project, timeline, music, 33), 1)
})

test('a non-finite or non-positive amount ducks nothing, rather than silencing with NaN', () => {
  for (const amountDb of [Number.NaN, 0, -6]) {
    const { project, timeline, music } = ducked({ amountDb })
    assert.equal(itemAudioGainAt(project, timeline, music, 80), 1, String(amountDb))
  }
})
