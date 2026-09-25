import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Asset, AssetKind, Item, Project, Timeline, Track } from '@shared/project'
import { mixerChannels } from './channels'

function asset(id: string, kind: AssetKind, hasAudio: boolean): Asset {
  return {
    id,
    kind,
    name: id,
    path: `/m/${id}`,
    durationUs: 60_000_000,
    width: 1920,
    height: 1080,
    fps: 30,
    hasAudio,
    hasVideo: kind !== 'audio',
    posterPath: null,
    waveformPath: null,
    createdAt: 0
  }
}

function clip(id: string, assetId: string, trackId: string, over: Partial<Item> = {}): Item {
  return {
    id,
    assetId,
    trackId,
    from: 0,
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

function track(id: string, kind: Track['kind'], items: Item[], over: Partial<Track> = {}): Track {
  return { id, kind, name: id.toUpperCase(), locked: false, muted: false, hidden: false, items, ...over }
}

function fixture(tracks: Track[]): { project: Project; timeline: Timeline } {
  const timeline: Timeline = { id: 'tl', name: 'T', fps: 30, width: 1920, height: 1080, background: '#000', tracks, transitions: [] }
  const project: Project = {
    id: 'p',
    name: 'p',
    version: 1,
    assets: [asset('talk', 'video', true), asset('broll', 'video', false), asset('still', 'image', false), asset('music', 'audio', true)],
    timelines: [timeline],
    activeTimelineId: 'tl',
    createdAt: 0,
    updatedAt: 0
  }
  return { project, timeline }
}

test('a strip for every audio track and every video track that carries sound', () => {
  const { project, timeline } = fixture([
    track('v1', 'video', [clip('a', 'talk', 'v1')]),
    track('v2', 'video', [clip('b', 'broll', 'v2'), clip('c', 'still', 'v2')]),
    track('a1', 'audio', [clip('d', 'music', 'a1')]),
    track('a2', 'audio', [])
  ])
  const channels = mixerChannels(project, timeline)
  assert.deepEqual(channels.map((channel) => channel.track.id), ['v1', 'a1', 'a2'], 'silent pictures get no strip; an empty audio track does')
  assert.deepEqual(channels.map((channel) => channel.badge), ['V', 'A', 'A'])
  assert.equal(channels[0]?.soundingClips, 1)
})

test('a detached picture leaves its video track without a strip', () => {
  const detached = fixture([track('v1', 'video', [clip('a', 'talk', 'v1', { audioDetached: true })])])
  assert.equal(mixerChannels(detached.project, detached.timeline).length, 0)
  // Positive control: the same clip, not detached, sounds.
  const attached = fixture([track('v1', 'video', [clip('a', 'talk', 'v1')])])
  assert.equal(mixerChannels(attached.project, attached.timeline).length, 1)
})

test('each strip says whether the mix plays it: muted, soloed, or silenced by another solo', () => {
  const { project, timeline } = fixture([
    track('a1', 'audio', [clip('d', 'music', 'a1')], { solo: true }),
    track('a2', 'audio', [], { muted: true }),
    track('a3', 'audio', [])
  ])
  const channels = mixerChannels(project, timeline)
  assert.deepEqual(
    channels.map((channel) => [channel.track.id, channel.audible, channel.state]),
    [
      ['a1', true, 'Soloed'],
      ['a2', false, 'Muted'],
      ['a3', false, 'Silent — another track is soloed']
    ]
  )
  const plain = fixture([track('a1', 'audio', [])])
  assert.deepEqual(
    mixerChannels(plain.project, plain.timeline).map((channel) => [channel.audible, channel.state]),
    [[true, null]],
    'with no solo anywhere, an unmuted track is simply heard'
  )
})
