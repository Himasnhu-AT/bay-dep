/**
 * The speech tools through the executor, with main's measurements stood in by answers computed
 * from a description of each file's sound (who speaks when, how loud). What is held still:
 *
 * - switch_speakers razors and disables the angles, detaches embedded sound, is one undo step, and
 *   refuses — with each mic's numbers — when only one angle would ever be on screen (beside the
 *   two-speaker case that must succeed);
 * - remove_silences reads each clip over exactly the source it plays (in-point, speed) and maps
 *   back to timeline frames, cutting every track as one step; refusals say what to loosen;
 * - level_voices sets gains from loudness; sync_angles moves a late camera by its offset and
 *   refuses unrelated audio without moving anything; set_item_enabled switches linked clips too;
 * - detect_footage_mode reads the project and answers with its suggestions.
 *
 * The measurements themselves are `src/main/media/audio-analysis.test.ts`, against the real ffmpeg.
 */

import { beforeEach, test } from 'node:test'
import assert from 'node:assert/strict'
import type { AudioSpan, SilenceInterval } from '@shared/ipc'
import type { Asset, Item, Project, Track } from '@shared/project'
import { allItems } from '@shared/project'
import { emptyProject, useEditor } from '@/store/editor'
import { executeToolCall } from './index'

// ---------------------------------------------------------------------------
// Each file's sound, as a function of source time (seconds from the file's start)
// ---------------------------------------------------------------------------

type Sound = (t: number) => number
const sounds = new Map<string, Sound>()
const silenceAnswers = new Map<string, SilenceInterval[]>()
const loudnessAnswers = new Map<string, number>()
const asked: { kind: string; path: string; span: AudioSpan; windowUs?: number }[] = []
/** Runs while a measurement is "in flight" — the moment a user could edit the timeline. */
let duringAnalysis: (() => void) | null = null

const talking = (...ranges: [number, number][]): Sound => (t) => (ranges.some(([a, b]) => t >= a && t < b) ? -20 : -60)

;(globalThis as { window?: unknown }).window = {
  bay: {
    media: {
      levels: async (path: string, span: AudioSpan, windowUs: number) => {
        asked.push({ kind: 'levels', path, span, windowUs })
        duringAnalysis?.()
        const sound = sounds.get(path)
        if (!sound) return { ok: false, error: `no specimen for ${path}` }
        const n = Math.floor(span.durationUs / windowUs)
        return { ok: true, value: Array.from({ length: n }, (_, k) => sound((span.startUs + k * windowUs) / 1_000_000)) }
      },
      silences: async (path: string, span: AudioSpan) => {
        asked.push({ kind: 'silences', path, span })
        duringAnalysis?.()
        return { ok: true, value: silenceAnswers.get(path) ?? [] }
      },
      loudness: async (path: string, span: AudioSpan) => {
        asked.push({ kind: 'loudness', path, span })
        return { ok: true, value: { integratedLufs: loudnessAnswers.get(path) ?? -70, truePeakDb: -3 } }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Fixture: two cameras and a wide on V1–V3, two mics on A1–A2, all 0–300 (10 s at 30 fps)
// ---------------------------------------------------------------------------

const asset = (id: string, kind: 'video' | 'audio', extra: Partial<Asset> = {}): Asset => ({
  id,
  kind,
  name: `${id}.${kind === 'video' ? 'mov' : 'wav'}`,
  path: `/rec/${id}`,
  durationUs: 600_000_000,
  width: kind === 'video' ? 1920 : null,
  height: kind === 'video' ? 1080 : null,
  fps: kind === 'video' ? 30 : null,
  hasAudio: true,
  hasVideo: kind === 'video',
  posterPath: null,
  waveformPath: null,
  createdAt: 0,
  ...extra
})

const clip = (id: string, assetId: string, trackId: string, extra: Partial<Item> = {}): Item => ({
  id,
  assetId,
  trackId,
  from: 0,
  durationInFrames: 300,
  sourceStartUs: 0,
  layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
  volume: 1,
  fadeInFrames: 0,
  fadeOutFrames: 0,
  speed: 1,
  ...extra
})

const track = (id: string, kind: 'video' | 'audio', items: Item[], extra: Partial<Track> = {}): Track => ({
  id,
  kind,
  name: id.toUpperCase(),
  locked: false,
  muted: false,
  hidden: false,
  items,
  ...extra
})

function load(tracks: Track[], assets: Asset[] = ['camA', 'camB', 'wide'].map((id) => asset(id, 'video')).concat(['mic1', 'mic2'].map((id) => asset(id, 'audio')))): void {
  const base = emptyProject()
  const project: Project = {
    ...base,
    assets,
    timelines: base.timelines.map((timeline) => ({ ...timeline, fps: 30, tracks }))
  }
  useEditor.getState().enterProject(project)
}

function podcast(): void {
  load([
    track('v1', 'video', [clip('camA', 'camA', 'v1')]),
    track('v2', 'video', [clip('camB', 'camB', 'v2')]),
    track('v3', 'video', [clip('wide', 'wide', 'v3')]),
    track('a1', 'audio', [clip('mic1', 'mic1', 'a1')]),
    track('a2', 'audio', [clip('mic2', 'mic2', 'a2')])
  ])
}

beforeEach(() => {
  sounds.clear()
  silenceAnswers.clear()
  loudnessAnswers.clear()
  asked.length = 0
  duringAnalysis = null
})

const state = () => useEditor.getState()
const tl = () => state().project.timelines[0]!
const items = (trackId: string) => tl().tracks.find((t) => t.id === trackId)!.items
const run = (tool: string, args: Record<string, unknown>) => executeToolCall({ id: 't', tool, args })
const ANGLES = [
  { videoItemId: 'camA', micItemId: 'mic1' },
  { videoItemId: 'camB', micItemId: 'mic2' }
]

// ---------------------------------------------------------------------------
// switch_speakers
// ---------------------------------------------------------------------------

test('switch_speakers razors each angle at the cut, disables the off pieces, and is one undo step', async () => {
  podcast()
  sounds.set('/rec/mic1', talking([0, 5]))
  sounds.set('/rec/mic2', talking([5.5, 10]))
  const before = state().past.length
  const result = await run('switch_speakers', { angles: ANGLES, thresholdDb: -40 })
  assert.ok(result.ok, result.ok ? '' : result.error)
  assert.equal(state().past.length - before, 1, 'one undo step')
  // Onset 5.5 s + 0.30 s → frame 174.
  assert.deepEqual(items('v1').map((i) => [i.from, i.durationInFrames, i.disabled === true]), [[0, 174, false], [174, 126, true]])
  assert.deepEqual(items('v2').map((i) => [i.from, i.durationInFrames, i.disabled === true]), [[0, 174, true], [174, 126, false]])
  const value = result.value as { cuts: { frame: number; to: number | string }[]; screenTime: { share: number }[]; detachedSoundItemIds?: string[] }
  assert.deepEqual(value.cuts, [{ frame: 174, to: 2 }])
  assert.ok(Math.abs(value.screenTime[0]!.share - 0.58) < 0.01)
  // The cameras carried their own sound; it was detached so disabling a picture does not silence it.
  assert.equal(value.detachedSoundItemIds?.length, 2)
  const detached = allItems(tl()).filter((i) => value.detachedSoundItemIds!.includes(i.id))
  assert.ok(detached.every((i) => !i.disabled), 'the detached sound keeps playing')
  // The levels were read over the shared span, 50 ms windows.
  assert.deepEqual(asked.filter((a) => a.kind === 'levels').map((a) => [a.path, a.span.startUs, a.span.durationUs, a.windowUs]), [
    ['/rec/mic1', 0, 10_000_000, 50_000],
    ['/rec/mic2', 0, 10_000_000, 50_000]
  ])
  state().undo()
  assert.equal(items('v1').length, 1)
  assert.ok(!items('v1')[0]!.disabled)
})

test('switch_speakers refuses when only one angle would ever be on screen, naming the silent mic and every mic\'s numbers', async () => {
  podcast()
  sounds.set('/rec/mic1', talking([1, 9]))
  sounds.set('/rec/mic2', talking())
  const before = JSON.stringify(state().project)
  const result = await run('switch_speakers', { angles: ANGLES, thresholdDb: -40 })
  assert.ok(!result.ok)
  assert.match(result.error, /Only angle 1 \(mic1\.wav\) would ever be on screen/)
  assert.match(result.error, /Never talking: angle 2 \(mic2\.wav\)/)
  assert.match(result.error, /room -60 dB, speech -60 dB, threshold -40 dB, talking 0% of the time/)
  assert.match(result.error, /thresholdDb/)
  assert.equal(JSON.stringify(state().project), before, 'nothing changed')
})

test('switch_speakers refuses one mixed track on every angle, and says why', async () => {
  podcast()
  const room = talking([0, 3], [4, 9])
  sounds.set('/rec/mic1', room)
  sounds.set('/rec/mic2', room)
  const result = await run('switch_speakers', { angles: ANGLES, thresholdDb: -40 })
  assert.ok(!result.ok)
  assert.match(result.error, /single mixed track/)
})

test('switch_speakers refuses angles that share a track, naming them', async () => {
  load([
    track('v1', 'video', [clip('camA', 'camA', 'v1', { durationInFrames: 150 }), clip('camB', 'camB', 'v1', { from: 150, durationInFrames: 150 })]),
    track('a1', 'audio', [clip('mic1', 'mic1', 'a1')]),
    track('a2', 'audio', [clip('mic2', 'mic2', 'a2')])
  ])
  const result = await run('switch_speakers', { angles: ANGLES })
  assert.ok(!result.ok)
  assert.match(result.error, /camA and camB share V1/)
  assert.match(result.error, /add_track/)
})

test('switch_speakers with validateOnly reports the plan and changes nothing', async () => {
  podcast()
  sounds.set('/rec/mic1', talking([0, 5]))
  sounds.set('/rec/mic2', talking([5.5, 10]))
  const before = JSON.stringify(state().project)
  const past = state().past.length
  const result = await run('switch_speakers', { angles: ANGLES, thresholdDb: -40, validateOnly: true })
  assert.ok(result.ok, result.ok ? '' : result.error)
  const value = result.value as { validateOnly: boolean; cuts: unknown[]; wouldDetachSoundOf: string[] }
  assert.equal(value.validateOnly, true)
  assert.deepEqual(value.cuts, [{ frame: 174, to: 2 }])
  assert.deepEqual(value.wouldDetachSoundOf, ['camA', 'camB'])
  assert.equal(JSON.stringify(state().project), before)
  assert.equal(state().past.length, past)
})

// ---------------------------------------------------------------------------
// remove_silences
// ---------------------------------------------------------------------------

test('remove_silences reads the source the clip plays and cuts the mapped frames on every track, as one step', async () => {
  // The mic enters at frame 30, 2 s into its file, for 9 s.
  load([
    track('v1', 'video', [clip('camA', 'camA', 'v1', { durationInFrames: 400 })]),
    track('a1', 'audio', [clip('mic1', 'mic1', 'a1', { from: 30, sourceStartUs: 2_000_000, durationInFrames: 270 })])
  ])
  // Silences 1–3 s and 5–5.3 s into what the clip plays (the second is too short once padded).
  silenceAnswers.set('/rec/mic1', [{ startSec: 1, endSec: 3 }, { startSec: 5, endSec: 5.3 }])
  const before = state().past.length
  const result = await run('remove_silences', { itemId: 'mic1' })
  assert.ok(result.ok, result.ok ? '' : result.error)
  assert.equal(state().past.length - before, 1)
  const call = asked.find((a) => a.kind === 'silences')!
  assert.deepEqual([call.span.startUs, call.span.durationUs], [2_000_000, 9_000_000], 'from the in-point, for the clip')
  // 1–3 s after frame 30 is frames 60–120; 0.2 s (6 frames) kept each side → 66–114.
  const value = result.value as { removedRanges: { fromFrame: number; toFrame: number }[]; savedSeconds: number }
  assert.deepEqual(value.removedRanges.map((r) => [r.fromFrame, r.toFrame]), [[66, 114]])
  assert.equal(value.savedSeconds, 1.6)
  // Both tracks lost the same 48 frames: sync kept.
  assert.equal(items('v1').reduce((sum, i) => sum + i.durationInFrames, 0), 352)
  assert.equal(items('a1').reduce((sum, i) => sum + i.durationInFrames, 0), 222)
})

test('remove_silences at 2× maps each source second to half a timeline second', async () => {
  load([track('a1', 'audio', [clip('mic1', 'mic1', 'a1', { speed: 2, durationInFrames: 150 })])])
  silenceAnswers.set('/rec/mic1', [{ startSec: 2, endSec: 6 }])
  const result = await run('remove_silences', { itemId: 'mic1', keepPaddingSec: 0 })
  assert.ok(result.ok, result.ok ? '' : result.error)
  assert.deepEqual(asked.find((a) => a.kind === 'silences')!.span.durationUs, 10_000_000, '150 frames at 2× is 10 s of source')
  assert.deepEqual((result.value as { removedRanges: { fromFrame: number; toFrame: number }[] }).removedRanges.map((r) => [r.fromFrame, r.toFrame]), [[30, 90]])
})

test('remove_silences across two mics cuts only where both are silent', async () => {
  podcast()
  silenceAnswers.set('/rec/mic1', [{ startSec: 2, endSec: 6 }])
  silenceAnswers.set('/rec/mic2', [{ startSec: 0, endSec: 3 }, { startSec: 5, endSec: 8 }])
  const result = await run('remove_silences', { itemIds: ['mic1', 'mic2'], keepPaddingSec: 0 })
  assert.ok(result.ok, result.ok ? '' : result.error)
  assert.deepEqual((result.value as { removedRanges: { fromFrame: number; toFrame: number }[] }).removedRanges.map((r) => [r.fromFrame, r.toFrame]), [
    [60, 90],
    [150, 180]
  ])
  // The camera kept 0–2 s, 3–5 s and 6–10 s of its source, butted together: the later range was
  // removed first, so the earlier one's frames still meant what they meant.
  assert.deepEqual(items('v1').map((i) => [i.from, i.sourceStartUs]), [
    [0, 0],
    [60, 3_000_000],
    [120, 6_000_000]
  ])
})

test('remove_silences with nothing to cut refuses with what to loosen, and changes nothing', async () => {
  podcast()
  const before = JSON.stringify(state().project)
  const none = await run('remove_silences', { itemId: 'mic1' })
  assert.ok(!none.ok)
  assert.match(none.error, /No pause of 0\.5 s or more below -30 dB/)
  assert.match(none.error, /thresholdDb -25/)
  assert.match(none.error, /minSilenceSec 0\.25/)
  silenceAnswers.set('/rec/mic1', [{ startSec: 2, endSec: 2.3 }])
  const short = await run('remove_silences', { itemId: 'mic1' })
  assert.ok(!short.ok)
  assert.match(short.error, /none is longer than the 0\.2 s padding/)
  assert.equal(JSON.stringify(state().project), before)
})

test('remove_silences names the one form it needs', async () => {
  podcast()
  const neither = await run('remove_silences', {})
  assert.ok(!neither.ok)
  assert.match(neither.error, /itemId .* itemIds .* trackId/)
  const both = await run('remove_silences', { itemId: 'mic1', trackId: 'a1' })
  assert.ok(!both.ok)
  assert.match(both.error, /only one of itemId, itemIds or trackId, not itemId and trackId/)
})

// ---------------------------------------------------------------------------
// level_voices
// ---------------------------------------------------------------------------

test('level_voices sets each clip\'s gain from its loudness, as one step, and reports before and after', async () => {
  podcast()
  loudnessAnswers.set('/rec/mic1', -22)
  loudnessAnswers.set('/rec/mic2', -12)
  const before = state().past.length
  const result = await run('level_voices', { itemIds: ['mic1', 'mic2'] })
  assert.ok(result.ok, result.ok ? '' : result.error)
  assert.equal(state().past.length - before, 1)
  assert.equal(items('a1')[0]!.volume, 1.995)
  assert.equal(items('a2')[0]!.volume, 0.631)
  const clips = (result.value as { clips: { beforeLufs: number; afterLufs: number }[] }).clips
  assert.deepEqual(clips.map((c) => [c.beforeLufs, c.afterLufs]), [[-22, -16], [-12, -16]])
})

test('level_voices refuses clips with volume keys, and skips silent ones by name', async () => {
  podcast()
  state().setKeyframe('mic1', 'volume', 0, 0.5)
  const keyed = await run('level_voices', { itemIds: ['mic1', 'mic2'] })
  assert.ok(!keyed.ok)
  assert.match(keyed.error, /mic1 has volume keyframes/)
  loudnessAnswers.set('/rec/mic2', -20)
  const skipped = await run('level_voices', { itemIds: ['mic2', 'camB'] })
  assert.ok(skipped.ok, skipped.ok ? '' : skipped.error)
  assert.deepEqual((skipped.value as { skippedSilent: string[] }).skippedSilent, ['camB'])
})

// ---------------------------------------------------------------------------
// sync_angles
// ---------------------------------------------------------------------------

/** Speech-like bursts, seeded, as a Sound. */
function bursts(seed: number): Sound {
  let s = seed
  const random = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
  const ranges: [number, number, number][] = []
  for (let t = 0; t < 700; ) {
    t += 0.05 + random() * 0.4
    const len = 0.1 + random() * 0.5
    ranges.push([t, t + len, -30 + random() * 15])
    t += len
  }
  return (t) => ranges.find(([a, b]) => t >= a && t < b)?.[2] ?? -60
}

test('sync_angles moves a camera that started late by its offset, and is one step', async () => {
  load([
    track('v2', 'video', [clip('camB', 'camB', 'v2', { durationInFrames: 1500 })]),
    track('a1', 'audio', [clip('mic1', 'mic1', 'a1', { durationInFrames: 1800 })])
  ])
  const event = bursts(5)
  sounds.set('/rec/mic1', event)
  // The camera started 1.5 s into the event: its t is the event's t + 1.5.
  sounds.set('/rec/camB', (t) => event(t + 1.5) - 6)
  const before = state().past.length
  const result = await run('sync_angles', { itemIds: ['mic1', 'camB'] })
  assert.ok(result.ok, result.ok ? '' : result.error)
  assert.equal(state().past.length - before, 1)
  assert.equal(items('v2')[0]!.from, 45)
  const clipRow = (result.value as { clips: { offsetSec: number; correlation: number }[] }).clips[0]!
  assert.ok(Math.abs(clipRow.offsetSec - 1.5) <= 0.01, JSON.stringify(clipRow))
  // 10 ms windows.
  assert.ok(asked.filter((a) => a.kind === 'levels').every((a) => a.windowUs === 10_000))
})

test('sync_angles refuses unrelated sound and moves nothing', async () => {
  load([
    track('v2', 'video', [clip('camB', 'camB', 'v2', { durationInFrames: 1500 })]),
    track('a1', 'audio', [clip('mic1', 'mic1', 'a1', { durationInFrames: 1800 })])
  ])
  sounds.set('/rec/mic1', bursts(5))
  sounds.set('/rec/camB', bursts(77))
  const before = JSON.stringify(state().project)
  const result = await run('sync_angles', { itemIds: ['mic1', 'camB'] })
  assert.ok(!result.ok)
  assert.match(result.error, /Nothing was moved/)
  assert.match(result.error, /camB \("camB\.mov"\): correlation [\d.]+ \(needs 0\.3\)/)
  assert.equal(JSON.stringify(state().project), before)
})

// ---------------------------------------------------------------------------
// set_item_enabled
// ---------------------------------------------------------------------------

test('set_item_enabled switches a picture and its linked sound, or only the picture with linked: false', async () => {
  podcast()
  state().detachAudio(['camA'])
  const sound = allItems(tl()).find((i) => i.assetId === 'camA' && i.id !== 'camA')!
  const off = await run('set_item_enabled', { itemIds: ['camA'], enabled: false })
  assert.ok(off.ok, off.ok ? '' : off.error)
  assert.deepEqual((off.value as { linkedAlsoChanged: string[] }).linkedAlsoChanged, [sound.id])
  assert.ok(allItems(tl()).find((i) => i.id === sound.id)!.disabled)
  const on = await run('set_item_enabled', { itemIds: ['camA'], enabled: true, linked: false })
  assert.ok(on.ok, on.ok ? '' : on.error)
  assert.ok(!items('v1')[0]!.disabled)
  assert.ok(allItems(tl()).find((i) => i.id === sound.id)!.disabled, 'the sound stays off')
  const again = await run('set_item_enabled', { itemIds: ['camA'], enabled: true, linked: false })
  assert.ok(again.ok)
  assert.match((again.value as { note: string }).note, /already on/)
})

test('set_item_enabled refuses a locked track by name, and changes nothing', async () => {
  load([track('v1', 'video', [clip('camA', 'camA', 'v1')], { locked: true }), track('v2', 'video', [clip('camB', 'camB', 'v2')])])
  const result = await run('set_item_enabled', { itemIds: ['camA', 'camB'], enabled: false })
  assert.ok(!result.ok)
  assert.match(result.error, /camA is on locked track V1/)
  assert.ok(!items('v2')[0]!.disabled, 'the unlocked clip was not switched either')
})

// ---------------------------------------------------------------------------
// detect_footage_mode
// ---------------------------------------------------------------------------

test('detect_footage_mode calls matching long recordings a podcast and suggests its skill', async () => {
  podcast()
  const result = await run('detect_footage_mode', {})
  assert.ok(result.ok, result.ok ? '' : result.error)
  const value = result.value as { mode: string; suggestedSkills: string[]; suggestedTools: string[]; suggestedLayout: string; confidence: number }
  assert.equal(value.mode, 'podcast')
  assert.ok(value.suggestedSkills.includes('podcast'))
  assert.ok(value.suggestedTools.includes('switch_speakers'))
  assert.equal(value.suggestedLayout, 'ai')
  // No transcript: the speech signal came from a quick silence analysis of the first two minutes.
  const sampled = asked.filter((a) => a.kind === 'silences')
  assert.ok(sampled.length > 0 && sampled.every((a) => a.span.startUs === 0 && a.span.durationUs === 120_000_000))
  const quick = await run('detect_footage_mode', { analyzeAudio: false })
  assert.ok(quick.ok)
  assert.ok((quick.value as { confidence: number }).confidence < value.confidence, 'less sure without the speech signal')
})

// ---------------------------------------------------------------------------
// The timeline changing while the audio is measured
// ---------------------------------------------------------------------------

test('remove_silences refuses when a clip it measured is trimmed during the analysis, and cuts nothing', async () => {
  podcast()
  silenceAnswers.set('/rec/mic1', [{ startSec: 2, endSec: 6 }])
  // The user trims the mic's head while ffmpeg runs: every planned frame is now 30 frames off.
  duringAnalysis = () => state().trimItem('mic1', 'start', 30)
  const after = () => JSON.stringify(state().project.timelines)
  const result = await run('remove_silences', { itemId: 'mic1' })
  assert.ok(!result.ok)
  assert.match(result.error, /The timeline changed during analysis — mic1 \(moved, trimmed or retimed\)/)
  assert.match(result.error, /Run again/)
  const trimmed = after()
  assert.equal(items('v1')[0]!.durationInFrames, 300, 'the other tracks were not cut')
  assert.equal(after(), trimmed)
  // Positive control: the same call with nothing moving meanwhile does cut.
  duringAnalysis = null
  const again = await run('remove_silences', { itemId: 'mic1' })
  assert.ok(again.ok, again.ok ? '' : again.error)
})

test('switch_speakers refuses when an angle is moved during the analysis', async () => {
  podcast()
  sounds.set('/rec/mic1', talking([0, 5]))
  sounds.set('/rec/mic2', talking([5.5, 10]))
  let once = true
  duringAnalysis = () => {
    if (once) state().moveItem('camB', 12)
    once = false
  }
  const result = await run('switch_speakers', { angles: ANGLES, thresholdDb: -40 })
  assert.ok(!result.ok)
  assert.match(result.error, /timeline changed during analysis — camB \(moved, trimmed or retimed\)/)
  assert.ok(items('v1').every((i) => !i.disabled) && items('v1').length === 1, 'no angle was razored')
})

test('switch_speakers refuses, changing nothing, when an angle\'s sound cannot be detached', async () => {
  // camB's file failed to decode: bay cannot separate its sound, so switching its picture off
  // would silence it wherever it is off screen.
  const assets = ['camA', 'camB', 'wide'].map((id) => asset(id, 'video', id === 'camB' ? { error: 'decode failed' } : {}))
    .concat(['mic1', 'mic2'].map((id) => asset(id, 'audio')))
  load([
    track('v1', 'video', [clip('camA', 'camA', 'v1')]),
    track('v2', 'video', [clip('camB', 'camB', 'v2')]),
    track('a1', 'audio', [clip('mic1', 'mic1', 'a1')]),
    track('a2', 'audio', [clip('mic2', 'mic2', 'a2')])
  ], assets)
  sounds.set('/rec/mic1', talking([0, 5]))
  sounds.set('/rec/mic2', talking([5.5, 10]))
  const before = JSON.stringify(state().project)
  const result = await run('switch_speakers', { angles: ANGLES, thresholdDb: -40 })
  assert.ok(!result.ok)
  assert.match(result.error, /camB: camB draws camB\.mov, which has/)
  assert.match(result.error, /Nothing was changed/)
  assert.equal(JSON.stringify(state().project), before)
})

test('the switch tells the agent to re-enable a piece with linked: false', async () => {
  podcast()
  sounds.set('/rec/mic1', talking([0, 5]))
  sounds.set('/rec/mic2', talking([5.5, 10]))
  const result = await run('switch_speakers', { angles: ANGLES, thresholdDb: -40 })
  assert.ok(result.ok, result.ok ? '' : result.error)
  assert.match((result.value as { next: string }).next, /set_item_enabled its pieces with linked: false/)
  // Following the hint puts exactly that piece back.
  const off = items('v1').find((i) => i.disabled)!
  await run('set_item_enabled', { itemIds: [off.id], enabled: true, linked: false })
  assert.equal(items('v1').filter((i) => !i.disabled).length, 2)
})
