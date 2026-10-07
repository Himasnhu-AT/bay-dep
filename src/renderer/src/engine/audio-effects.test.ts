/**
 * The preview's half of audio effects: what `audioRoutingAt` tells the engine to play for a clip
 * with a chain (which file, where in it, which live bands, which picture element to silence), and
 * the registry that asks main for processed files (`audioBakes`).
 *
 * These are the engine's decisions, not Chromium's sound: the graph they drive is metered in the
 * running app by `test/app/audio-effects.mjs`. They are also one of the two links in the claim
 * that preview and export are the same samples: this file pins that the routing is *the processed
 * file, at the frame's source time, at the shared gain, with the plan's live bands*;
 * `main/audio-fx/preview-export-parity.test.ts` shows that rule reproduces the exported file.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Asset, Item, Project, Timeline } from '@shared/project'
import { defaultEffect, itemEffectPlan, type AudioEffect, type AudioEffectKind } from '@shared/audio-effects'
import { itemAudioGainAt } from '@shared/audio-gain'
import type { AudioBakeLookup, AudioBakeRequest, AudioBakeResult } from '@shared/audio-bake'
import { audioRoutingAt } from './audio'
import { SETTLE_MS, createAudioBakes } from './audioBakes'
import { sourceSecondsAt } from './sync'

const fx = (kind: AudioEffectKind, params: Record<string, number> = {}): AudioEffect => {
  const base = defaultEffect(kind, kind)
  return { ...base, params: { ...base.params, ...params } }
}

function media(id: string, video: boolean): Asset {
  return {
    id, kind: video ? 'video' : 'audio', name: `${id}.${video ? 'mp4' : 'wav'}`, path: `/media/${id}`, durationUs: 60_000_000,
    width: video ? 1920 : null, height: video ? 1080 : null, fps: video ? 30 : null, hasAudio: true, hasVideo: video,
    posterPath: null, waveformPath: null, createdAt: 0
  }
}
function clip(id: string, assetId: string, trackId: string, extra: Partial<Item> = {}): Item {
  return {
    id, assetId, trackId, from: 0, durationInFrames: 90, sourceStartUs: 2_000_000,
    layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
    volume: 1, fadeInFrames: 0, fadeOutFrames: 0, speed: 1, ...extra
  }
}
function scene(items: { video?: Item[]; audio?: Item[] }, trackEffects?: AudioEffect[]): { project: Project; timeline: Timeline } {
  const timeline: Timeline = {
    id: 'tl', name: 'T', fps: 30, width: 1920, height: 1080, background: '#000000', transitions: [],
    tracks: [
      { id: 'v', kind: 'video', name: 'V1', locked: false, muted: false, hidden: false, items: items.video ?? [] },
      { id: 'a', kind: 'audio', name: 'A1', locked: false, muted: false, hidden: false, items: items.audio ?? [], ...(trackEffects ? { audioEffects: trackEffects } : {}) }
    ]
  }
  return { timeline, project: { id: 'p', name: 'p', version: 1, assets: [media('shot', true), media('voice', false)], timelines: [timeline], activeTimelineId: 'tl', createdAt: 0, updatedAt: 0 } }
}

const READY: AudioBakeLookup = (path, effects) => ({ state: 'ready', key: `k${effects.length}`, path: `${path}.baked.wav` })

test('a clip with no chain, or one that does nothing, is routed exactly as it always was', () => {
  const plain = scene({ video: [clip('c', 'shot', 'v')], audio: [clip('s', 'voice', 'a')] })
  const before = audioRoutingAt(plain.project, plain.timeline, 10)
  const idle = [fx('bell', { gain: 0 }), { ...fx('compressor'), enabled: false }]
  const withIdle = scene({ video: [clip('c', 'shot', 'v', { audioEffects: idle })], audio: [clip('s', 'voice', 'a', { audioEffects: idle })] }, idle)
  let asked = 0
  const after = audioRoutingAt(withIdle.project, withIdle.timeline, 10, () => {
    asked += 1
    return { state: 'pending' }
  })
  assert.equal(after.length, 2)
  for (const [i, routed] of after.entries()) {
    assert.equal(routed.asset.id, before[i]!.asset.id)
    assert.equal(routed.slot, before[i]!.slot)
    assert.equal(routed.detached, undefined)
    assert.equal(routed.effects, undefined)
    assert.equal(routed.gain, before[i]!.gain)
  }
  assert.equal(asked, 0, 'nothing is asked of main for a chain that bakes nothing')
})

test('equaliser bands ride on the routing, in order, and change neither the file nor the element', () => {
  const chain = [fx('highpass', { frequency: 90 }), fx('bell', { frequency: 3000, gain: 4 }), fx('lowshelf')]
  const { project, timeline } = scene({ audio: [clip('s', 'voice', 'a', { audioEffects: chain })] })
  const [routed] = audioRoutingAt(project, timeline, 10, READY)
  assert.ok(routed)
  assert.equal(routed.asset.id, 'voice')
  assert.equal(routed.detached, undefined)
  assert.deepEqual(routed.effects?.map((b) => [b.type, b.frequency, b.gainDb]), [['highpass', 90, 0], ['peaking', 3000, 4]], 'the shelf at 0 dB is not a node')
})

test('once its processed file is ready a clip plays it, from its own element, at the source time of the frame', () => {
  const chain = [fx('highpass'), fx('compressor'), fx('bell', { gain: 3 })]
  const item = clip('s', 'voice', 'a', { audioEffects: chain, volume: 0.8 })
  const { project, timeline } = scene({ audio: [item] })
  const asked: string[] = []
  const lookup: AudioBakeLookup = (path, effects) => {
    asked.push(`${path}:${effects.map((e) => e.kind).join('+')}`)
    return { state: 'ready', key: 'abc', path: '/cache/abc.wav' }
  }
  const [routed] = audioRoutingAt(project, timeline, 12, lookup)
  assert.ok(routed)
  assert.deepEqual(asked, ['/media/voice:highpass+compressor'], 'asked for the stages up to the compressor, of the clip’s own file')
  assert.equal(routed.asset.path, '/cache/abc.wav')
  assert.equal(routed.asset.kind, 'audio')
  assert.notEqual(routed.asset.id, 'voice', 'an element of its own, not the source’s')
  assert.ok(routed.asset.id.includes('s') && routed.asset.id.includes('abc'), 'keyed by clip and by bake')
  assert.equal(routed.detached?.mediaSeconds, sourceSecondsAt(item, routed.asset, 12, 30), 'positioned by the same mapping as the source would be')
  assert.ok(Math.abs((routed.detached?.mediaSeconds ?? 0) - (2 + 12 / 30)) < 0.01)
  assert.equal(routed.detached?.claim, null, 'an audio file has no picture element to silence')
  assert.deepEqual(routed.effects?.map((b) => b.type), ['peaking'], 'only the band after the compressor is live')
  assert.deepEqual(routed.effects, itemEffectPlan(timeline.tracks[1], item).clip, 'the plan’s live bands, exactly')
  assert.equal(routed.gain, itemAudioGainAt(project, timeline, item, 12), 'the shared gain, untouched by the chain')
  assert.equal(routed.gain, 0.8)

  // Two clips of one file with one chain sounding at once are two elements.
  const other = clip('s2', 'voice', 'a2', { audioEffects: chain })
  timeline.tracks.push({ id: 'a2', kind: 'audio', name: 'A2', locked: false, muted: false, hidden: false, items: [other] })
  const both = audioRoutingAt(project, timeline, 12, lookup)
  assert.equal(new Set(both.map((r) => r.asset.id)).size, 2)
})

test('while the processed file is pending or failed the clip plays unprocessed, with its live bands', () => {
  const chain = [fx('gate'), fx('bell', { gain: 3 })]
  const { project, timeline } = scene({ audio: [clip('s', 'voice', 'a', { audioEffects: chain })] })
  for (const state of [{ state: 'pending' } as const, { state: 'failed', error: 'no' } as const]) {
    const [routed] = audioRoutingAt(project, timeline, 10, () => state)
    assert.ok(routed)
    assert.equal(routed.asset.id, 'voice')
    assert.equal(routed.asset.path, '/media/voice')
    assert.equal(routed.detached, undefined)
    assert.deepEqual(routed.effects?.map((b) => b.type), ['peaking'])
  }
  // And with no lookup at all — a routing test, a caller that never bakes — the same.
  const [bare] = audioRoutingAt(project, timeline, 10)
  assert.equal(bare?.asset.path, '/media/voice')
})

test('a video clip playing its processed sound has its own picture element claimed, so the unprocessed sound is not heard too', () => {
  const item = clip('c', 'shot', 'v', { audioEffects: [fx('limiter')] })
  const { project, timeline } = scene({ video: [item] })
  const [dry] = audioRoutingAt(project, timeline, 10)
  assert.ok(dry && dry.asset.id === 'shot' && dry.detached === undefined, 'the specimen plays through its picture element until baked')
  const [routed] = audioRoutingAt(project, timeline, 10, READY)
  assert.ok(routed)
  assert.equal(routed.asset.path, '/media/shot.baked.wav')
  assert.equal(routed.asset.hasVideo, false)
  assert.deepEqual(routed.detached?.claim && { id: routed.detached.claim.asset.id, slot: routed.detached.claim.slot }, { id: 'shot', slot: dry.slot })
})

test('a track’s chain reaches every clip on it and none on another track', () => {
  const { project, timeline } = scene(
    { video: [clip('c', 'shot', 'v')], audio: [clip('s', 'voice', 'a')] },
    [fx('denoise'), fx('highshelf', { gain: 2 })]
  )
  const asked: string[] = []
  const routes = audioRoutingAt(project, timeline, 10, (path, effects) => {
    asked.push(`${path}:${effects.map((e) => e.kind).join('+')}`)
    return { state: 'ready', key: 'k', path: `${path}.baked.wav` }
  })
  assert.deepEqual(asked, ['/media/voice:denoise'])
  const onTrack = routes.find((r) => r.item.id === 's')!
  const elsewhere = routes.find((r) => r.item.id === 'c')!
  assert.equal(onTrack.asset.path, '/media/voice.baked.wav')
  assert.equal(onTrack.effects, undefined, 'the shelf after the track’s noise removal is the bus’s, not the clip’s')
  assert.equal(elsewhere.asset.id, 'shot')
  assert.equal(elsewhere.detached, undefined)
})

// -- the registry ------------------------------------------------------------------------------------

function fakeClock(): { now: () => number; later: (fn: () => void, ms: number) => void; advance: (ms: number) => void } {
  let time = 1000
  const timers: { at: number; fn: () => void }[] = []
  return {
    now: () => time,
    later: (fn, ms) => void timers.push({ at: time + ms, fn }),
    advance(ms) {
      time += ms
      for (const timer of timers.splice(0).sort((a, b) => a.at - b.at)) {
        if (timer.at <= time) timer.fn()
        else timers.push(timer)
      }
    }
  }
}

test('a bake is asked for once, after the chain has held still, and its answer is what every later lookup gets', async () => {
  const clock = fakeClock()
  const requests: AudioBakeRequest[] = []
  let answer: (result: AudioBakeResult) => void = () => {}
  const bakes = createAudioBakes((request) => {
    requests.push(request)
    return new Promise((resolve) => {
      answer = resolve
    })
  }, clock)
  let notified = 0
  bakes.subscribe(() => (notified += 1))
  const chain = [fx('compressor')]

  assert.equal(bakes.peek('/a.wav', chain), null, 'never wanted, never known')
  assert.deepEqual(bakes.lookup('/a.wav', chain), { state: 'pending' })
  assert.equal(requests.length, 0, 'not asked before the chain has settled')
  clock.advance(SETTLE_MS - 1)
  bakes.lookup('/a.wav', chain)
  assert.equal(requests.length, 0)
  clock.advance(1)
  assert.equal(requests.length, 1)
  assert.deepEqual(requests[0]!.effects.map((e) => e.kind), ['compressor'])
  for (let i = 0; i < 50; i += 1) bakes.lookup('/a.wav', chain)
  assert.equal(requests.length, 1, 'fifty frames of asking are one request')

  const before = notified
  answer({ ok: true, key: 'k1', path: '/cache/k1.wav' })
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(bakes.lookup('/a.wav', chain), { state: 'ready', key: 'k1', path: '/cache/k1.wav' })
  assert.ok(notified > before, 'the inspector is told')
  // The same settings under another effect id are the same bake.
  assert.deepEqual(bakes.peek('/a.wav', [{ ...chain[0]!, id: 'renamed' }]), { state: 'ready', key: 'k1', path: '/cache/k1.wav' })
})

test('a value passed through on the way to another is never rendered', () => {
  const clock = fakeClock()
  const requests: AudioBakeRequest[] = []
  const bakes = createAudioBakes((request) => {
    requests.push(request)
    return new Promise(() => {})
  }, clock)
  // A drag: three thresholds, 50 ms apart, each wanted for a frame or two and then never again.
  for (const threshold of [-20, -21, -22]) {
    bakes.lookup('/a.wav', [fx('compressor', { threshold })])
    clock.advance(50)
  }
  // The last one is still wanted every frame.
  for (let i = 0; i < 20; i += 1) {
    bakes.lookup('/a.wav', [fx('compressor', { threshold: -22 })])
    clock.advance(33)
  }
  assert.deepEqual(requests.map((r) => r.effects[0]!.params.threshold), [-22])
  // A chain for another file is not superseded by this one's.
  bakes.lookup('/b.wav', [fx('compressor', { threshold: -20 })])
  clock.advance(SETTLE_MS)
  assert.deepEqual(requests.map((r) => r.path), ['/a.wav', '/b.wav'])
  // And a chain wanted once while stopped — nothing newer after it — is rendered.
  bakes.lookup('/c.wav', [fx('gate')])
  clock.advance(SETTLE_MS)
  assert.equal(requests.at(-1)?.path, '/c.wav')
})

test('a failed bake is reported with its reason, kept until retried, and then asked for again', async () => {
  const clock = fakeClock()
  let calls = 0
  const bakes = createAudioBakes(() => {
    calls += 1
    return Promise.resolve<AudioBakeResult>(calls === 1 ? { ok: false, error: 'The sound of /a.wav could not be processed: no audio.' } : { ok: true, key: 'k', path: '/cache/k.wav' })
  }, clock)
  const chain = [fx('denoise')]
  bakes.lookup('/a.wav', chain)
  clock.advance(SETTLE_MS)
  await new Promise((resolve) => setImmediate(resolve))
  assert.deepEqual(bakes.lookup('/a.wav', chain), { state: 'failed', error: 'The sound of /a.wav could not be processed: no audio.' })
  clock.advance(10 * SETTLE_MS)
  assert.equal(calls, 1, 'a failure is not retried every frame')
  bakes.retry('/a.wav', chain)
  assert.deepEqual(bakes.lookup('/a.wav', chain), { state: 'pending' })
  clock.advance(SETTLE_MS)
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(bakes.lookup('/a.wav', chain).state, 'ready')

  // No bridge to main (a test, a page without the preload) is a failure that says so, not a hang.
  const orphan = createAudioBakes(() => null, clock)
  orphan.lookup('/a.wav', chain)
  clock.advance(SETTLE_MS)
  const state = orphan.lookup('/a.wav', chain)
  assert.ok(state.state === 'failed' && /could not reach/.test(state.error))
})
