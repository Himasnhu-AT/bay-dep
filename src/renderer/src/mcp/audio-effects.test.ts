/**
 * `audio_effects` as an agent (and the inspector, which calls the same handler) meets it: the
 * schema, the handler, one undo step per call, refusals that say what would be accepted, and
 * `inspect_item` / `read_project` reading the chain back.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findTool } from '@shared/mcp'
import { type Asset, type Item } from '@shared/project'
import { AUDIO_EFFECT_CATALOG, AUDIO_EFFECT_PRESETS } from '@shared/audio-effects'
import { validateArgs } from '@shared/validate'
import { emptyProject, useEditor } from '@/store/editor'
import { audioEffectsTool } from './audioEffects'
import { inspectItem, readProject } from './read'
import { ToolError } from './helpers'

function asset(id: string, kind: Asset['kind'], hasAudio: boolean): Asset {
  return {
    id, kind, name: `${id}`, path: `/m/${id}`, durationUs: 120_000_000, width: 1920, height: 1080, fps: 30,
    hasAudio, hasVideo: kind !== 'audio', posterPath: null, waveformPath: null, createdAt: 0
  }
}
function clip(id: string, trackId: string, from: number, assetId: string): Item {
  return {
    id, assetId, trackId, from, durationInFrames: 60, sourceStartUs: 0,
    layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
    volume: 1, fadeInFrames: 0, fadeOutFrames: 0, speed: 1
  }
}

const SHOT = 'itm_aaaaaaaaaa'
const STILL = 'itm_bbbbbbbbbb'
const PAGE = 'itm_cccccccccc'
const VOICE = 'itm_dddddddddd'
let videoTrack = ''
let audioTrack = ''

function load(): void {
  const project = emptyProject()
  project.assets = [asset('shot', 'video', true), asset('still', 'image', false), asset('page', 'html', false), asset('voice', 'audio', true)]
  const video = project.timelines[0]!.tracks.find((t) => t.kind === 'video')!
  const audio = project.timelines[0]!.tracks.find((t) => t.kind === 'audio')!
  video.items = [clip(SHOT, video.id, 0, 'shot'), clip(STILL, video.id, 100, 'still'), clip(PAGE, video.id, 200, 'page')]
  audio.items = [clip(VOICE, audio.id, 0, 'voice')]
  videoTrack = video.id
  audioTrack = audio.id
  useEditor.getState().setProject(project)
}

type Row = { effectId: string; kind: string; enabled: boolean; params: Record<string, number>; summary: string }

function call(args: Record<string, unknown>): { effects: Row[]; rendering?: string } & Record<string, unknown> {
  const spec = findTool('audio_effects')
  assert.ok(spec, 'audio_effects is in the catalogue')
  const invalid = validateArgs(spec, args)
  if (invalid) throw new ToolError(invalid)
  return audioEffectsTool(args) as { effects: Row[] } & Record<string, unknown>
}
function refusal(args: Record<string, unknown>): string {
  try {
    call(args)
  } catch (error) {
    if (error instanceof ToolError) return error.message
    throw error
  }
  assert.fail(`expected ${JSON.stringify(args)} to be refused`)
}
const stored = (id: string): Item =>
  useEditor.getState().project.timelines[0]!.tracks.flatMap((t) => t.items).find((i) => i.id === id)!
const track = (id: string) => useEditor.getState().project.timelines[0]!.tracks.find((t) => t.id === id)!
const past = (): number => useEditor.getState().past.length

test('adding, editing, moving, switching off and removing are each one undo step, and each returns the whole chain', () => {
  load()
  let steps = past()
  const step = (): void => {
    assert.equal(past(), steps + 1, 'one undo step')
    steps = past()
  }

  const added = call({ itemId: VOICE, action: 'add', kind: 'highpass', params: { frequency: 90 } })
  step()
  assert.equal(added.itemId, VOICE)
  assert.deepEqual(added.effects.map((e) => [e.kind, e.params.frequency, e.enabled]), [['highpass', 90, true]])
  assert.ok(Math.abs(added.effects[0]!.params.q! - Math.SQRT1_2) < 1e-9, 'a parameter left out takes its default')
  assert.match(added.effects[0]!.summary, /High-pass \(frequency 90 Hz, Q 0\.71\)/)
  assert.equal(added.rendering, undefined, 'an equaliser renders nothing')

  const comp = call({ itemId: VOICE, action: 'add', kind: 'compressor', params: { threshold: -22, ratio: 4 } })
  step()
  assert.match(comp.rendering ?? '', /compressor is rendered into a processed copy of the clip's sound/)
  const [hp, cp] = comp.effects as [Row, Row]

  const edited = call({ itemId: VOICE, action: 'edit', effectId: cp.effectId, params: { makeup: 4 } })
  step()
  assert.deepEqual([edited.effects[1]!.params.makeup, edited.effects[1]!.params.threshold, edited.effects[1]!.params.ratio], [4, -22, 4])

  const moved = call({ itemId: VOICE, action: 'move', effectId: cp.effectId, index: 0 })
  step()
  assert.deepEqual(moved.effects.map((e) => e.effectId), [cp.effectId, hp.effectId])
  assert.deepEqual(stored(VOICE).audioEffects?.map((e) => e.kind), ['compressor', 'highpass'])

  const off = call({ itemId: VOICE, action: 'edit', effectId: hp.effectId, enabled: false })
  step()
  assert.equal(off.effects[1]!.enabled, false)
  assert.equal(stored(VOICE).audioEffects?.[1]?.enabled, false)
  assert.equal(stored(VOICE).audioEffects?.[1]?.params.frequency, 90, 'switched off keeps its settings')

  call({ itemId: VOICE, action: 'remove', effectId: cp.effectId })
  step()
  call({ itemId: VOICE, action: 'remove', effectId: hp.effectId })
  step()
  assert.equal('audioEffects' in stored(VOICE), false, 'an emptied chain is absence, not an empty list in the file')

  useEditor.getState().undo()
  assert.deepEqual(stored(VOICE).audioEffects?.map((e) => e.kind), ['highpass'], 'undo puts one step back')
})

test('a preset writes ordinary effects on a clip or a track, and they are edited like any other', () => {
  load()
  const before = past()
  const applied = call({ trackId: audioTrack, action: 'preset', preset: 'podcast-voice' })
  assert.equal(past(), before + 1)
  assert.equal(applied.trackId, audioTrack)
  const preset = AUDIO_EFFECT_PRESETS.find((p) => p.slug === 'podcast-voice')!
  assert.deepEqual(applied.effects.map((e) => e.kind), preset.effects.map((e) => e.kind))
  assert.match(applied.rendering ?? '', /deesser, compressor, limiter are rendered into a processed copy of each clip's sound on this track/)
  assert.deepEqual(track(audioTrack).audioEffects?.map((e) => e.kind), preset.effects.map((e) => e.kind))

  const compressor = applied.effects.find((e) => e.kind === 'compressor')!
  const edited = call({ trackId: audioTrack, action: 'edit', effectId: compressor.effectId, params: { ratio: 5 } })
  assert.equal(edited.effects.find((e) => e.kind === 'compressor')!.params.ratio, 5)

  const appended = call({ itemId: SHOT, action: 'preset', preset: 'telephone', mode: 'append' })
  assert.equal(appended.effects.length, AUDIO_EFFECT_PRESETS.find((p) => p.slug === 'telephone')!.effects.length)
  call({ itemId: SHOT, action: 'clear' })
  assert.equal('audioEffects' in stored(SHOT), false)
  call({ trackId: audioTrack, action: 'clear' })
  assert.equal('audioEffects' in track(audioTrack), false)
})

test('the chain is read back by inspect_item and read_project with the ids audio_effects edits by', () => {
  load()
  const made = call({ itemId: VOICE, action: 'add', kind: 'bell', params: { frequency: 3000, gain: 4 } })
  call({ trackId: videoTrack, action: 'add', kind: 'lowpass' })
  const inspected = inspectItem({ itemId: VOICE }) as { audio: { effects?: Row[] } }
  assert.deepEqual(inspected.audio.effects?.map((e) => [e.effectId, e.kind, e.params.gain]), [[made.effects[0]!.effectId, 'bell', 4]])
  const none = inspectItem({ itemId: SHOT }) as { audio: Record<string, unknown> }
  assert.equal('effects' in none.audio, false, 'a clip with no chain says nothing about one')
  const read = readProject() as unknown as { tracks: { id: string; audioEffects?: Row[] }[] }
  assert.deepEqual(read.tracks.find((t) => t.id === videoTrack)?.audioEffects?.map((e) => e.kind), ['lowpass'])
  assert.equal('audioEffects' in read.tracks.find((t) => t.id === audioTrack)!, false)
})

test('a refusal says what would be accepted, and changes nothing', () => {
  load()
  const before = past()
  const snapshot = JSON.stringify(useEditor.getState().project.timelines)

  assert.match(refusal({ itemId: VOICE, action: 'add', kind: 'compressor', params: { ratio: 50 } }), /compressor\.ratio must be 1 to 20 \(a ratio, 4 means 4:1\); got 50/)
  assert.match(refusal({ itemId: VOICE, action: 'add', kind: 'highpass', params: { frequency: 30000 } }), /highpass\.frequency must be 20 to 20000 Hz; got 30000/)
  assert.match(refusal({ itemId: VOICE, action: 'add', kind: 'gate', params: { treshold: -40 } }), /gate has no parameter "treshold"\. Its parameters: threshold -90 to 0 dB/)
  assert.match(refusal({ itemId: VOICE, action: 'add' }), /needs kind/)
  assert.match(refusal({ itemId: VOICE, action: 'edit', effectId: 'afx_nope', enabled: false }), /the chain is empty/)
  assert.match(refusal({ itemId: VOICE, action: 'move', effectId: 'afx_nope' }), /needs index/)
  assert.match(refusal({ action: 'clear' }), /exactly one of itemId .* or trackId/)
  assert.match(refusal({ itemId: VOICE, trackId: audioTrack, action: 'clear' }), /exactly one of itemId/)
  assert.match(refusal({ itemId: STILL, action: 'add', kind: 'highpass' }), /has no sound, so there is nothing for an audio effect to act on/)
  assert.match(refusal({ itemId: PAGE, action: 'add', kind: 'highpass' }), new RegExp(`is a composition.*Put an equaliser on its track \\(trackId "${videoTrack}"\\)`))

  assert.equal(past(), before, 'a refusal is not an undo step')
  assert.equal(JSON.stringify(useEditor.getState().project.timelines), snapshot)

  // The twins: the nearest legal call to each refusal goes through.
  assert.equal(call({ itemId: VOICE, action: 'add', kind: 'compressor', params: { ratio: 20 } }).effects.length, 1)
  assert.equal(call({ itemId: SHOT, action: 'add', kind: 'highpass', params: { frequency: 20000 } }).effects.length, 1)
  assert.equal(call({ trackId: videoTrack, action: 'add', kind: 'highpass' }).effects.length, 1, 'the composition’s track takes the equaliser its clip could not')
})

test('a clip on a locked track is refused; its track’s own chain is not the clip', () => {
  load()
  useEditor.getState().patchTrack(audioTrack, { locked: true })
  assert.match(refusal({ itemId: VOICE, action: 'add', kind: 'highpass' }), /locked/)
  assert.equal('audioEffects' in stored(VOICE), false)
  useEditor.getState().patchTrack(audioTrack, { locked: false })
  assert.equal(call({ itemId: VOICE, action: 'add', kind: 'highpass' }).effects.length, 1)
})

test('a detached picture is pointed at its sound', () => {
  load()
  const result = useEditor.getState().detachAudio([SHOT])
  const audioId = result.detached[0]!.audioId
  assert.match(refusal({ itemId: SHOT, action: 'add', kind: 'highpass' }), /plays no sound of its own.*Put the effects on its audio item/)
  assert.equal(call({ itemId: audioId, action: 'add', kind: 'highpass' }).effects.length, 1)
})

test('the description an agent reads names every kind with its ranges and every preset, from the catalogue', () => {
  const spec = findTool('audio_effects')!
  for (const kind of AUDIO_EFFECT_CATALOG) {
    assert.ok(spec.description.includes(`- ${kind.kind}:`), `${kind.kind} is described`)
    for (const p of kind.params) assert.ok(spec.description.includes(`${p.key} ${p.min} to ${p.max}`), `${kind.kind}.${p.key} has its range`)
  }
  for (const preset of AUDIO_EFFECT_PRESETS) assert.ok(spec.description.includes(`"${preset.slug}"`))
  assert.equal(spec.dryRunnable, true)
})
