/**
 * `edit_item`'s J/L-cut and duck fields as an agent meets them: the schema, the handler, the
 * store's undo, and `inspect_item` reading back what was set.
 *
 * Each refusal is paired with the nearest legal call, so a surface that refused everything
 * could not pass; each refusal's text is asserted for what the caller needs to retry.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findTool } from '@shared/mcp'
import { framesToUs, type Asset, type Item } from '@shared/project'
import { validateArgs } from '@shared/validate'
import { emptyProject, useEditor } from '@/store/editor'
import { editItem } from './write'
import { inspectItem } from './read'
import { ToolError } from './helpers'

const at = (frames: number): number => framesToUs(frames, 30)

function asset(id: string, hasAudio: boolean): Asset {
  return {
    id,
    kind: hasAudio ? 'video' : 'image',
    name: `${id}.${hasAudio ? 'mp4' : 'png'}`,
    path: `/m/${id}`,
    durationUs: hasAudio ? at(3600) : 0,
    width: 1920,
    height: 1080,
    fps: 30,
    hasAudio,
    hasVideo: true,
    posterPath: null,
    waveformPath: null,
    createdAt: 0
  }
}

function clip(id: string, trackId: string, from: number, assetId: string, sourceFrames: number): Item {
  return {
    id,
    assetId,
    trackId,
    from,
    durationInFrames: 60,
    sourceStartUs: at(sourceFrames),
    layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
    volume: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    speed: 1
  }
}

const A = 'itm_aaaaaaaaaa'
const B = 'itm_bbbbbbbbbb'
const STILL = 'itm_ssssssssss'
const MUSIC = 'itm_mmmmmmmmmm'

function load(): { video: string; audio: string } {
  const project = emptyProject()
  project.assets = [asset('shot', true), asset('still', false)]
  const timeline = project.timelines[0]!
  const video = timeline.tracks.find((t) => t.kind === 'video')!
  const audio = timeline.tracks.find((t) => t.kind === 'audio')!
  video.items = [clip(A, video.id, 0, 'shot', 100), clip(B, video.id, 60, 'shot', 8), clip(STILL, video.id, 200, 'still', 0)]
  audio.items = [clip(MUSIC, audio.id, 0, 'shot', 0)]
  useEditor.getState().setProject(project)
  return { video: video.id, audio: audio.id }
}

function call(args: Record<string, unknown>): Record<string, unknown> {
  const spec = findTool('edit_item')
  assert.ok(spec)
  const invalid = validateArgs(spec, args)
  if (invalid) throw new ToolError(invalid)
  return editItem(args)
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

const item = (id: string): Item =>
  useEditor.getState().project.timelines[0]!.tracks.flatMap((t) => t.items).find((i) => i.id === id)!
const past = (): number => useEditor.getState().past.length

test('a J lead is one undo step, reported as it resolves, and read back by inspect_item', () => {
  load()
  const before = past()
  const result = call({ itemId: A, audioLeadFrames: 12, fadeInFrames: 3 })
  assert.equal(past(), before + 1)
  assert.equal(item(A).audioLeadFrames, 12)
  // A starts at frame 0, so the lead has nowhere to go — and says so, with the numbers.
  assert.equal(result.audioLeadFrames, 0)
  assert.match((result.warnings as string[]).join(' '), /starts at frame 0/)
  // B at frame 60 with 8 frames of source before its in-point: clamped to 8, said.
  const b = call({ itemId: B, audioLeadFrames: 15 })
  assert.equal(b.audioLeadFrames, 8)
  assert.match((b.warnings as string[]).join(' '), /8 frames, not 15/)
  const inspected = inspectItem({ itemId: B }).audio as Record<string, unknown>
  assert.equal(inspected.audioLeadFrames, 8)
  assert.match((inspected.notes as string[]).join(' '), /8 frames, not 15/)
  // 0 removes it.
  call({ itemId: B, audioLeadFrames: 0 })
  assert.equal(item(B).audioLeadFrames, undefined)
  assert.equal((inspectItem({ itemId: B }).audio as Record<string, unknown>).audioLeadFrames, undefined)
})

test('the schema refuses a negative or fractional offset; the handler a clip with no sound', () => {
  load()
  assert.match(refusal({ itemId: B, audioTrailFrames: -1 }), /audioTrailFrames/)
  assert.match(refusal({ itemId: B, audioTrailFrames: 2.5 }), /whole number|integer/)
  const still = refusal({ itemId: STILL, audioTrailFrames: 10 })
  assert.match(still, /still\.png, which has no audio/)
  assert.match(still, /apply to clips with sound/)
  // The nearest legal calls go through: a clip with sound, and clearing on the still.
  assert.equal(call({ itemId: B, audioTrailFrames: 10 }).audioTrailFrames, 10)
  call({ itemId: STILL, audioTrailFrames: 0 })
})

test('a duck fills its defaults, merges on the next call, and null removes it', () => {
  const { video } = load()
  const result = call({ itemId: MUSIC, duck: { keyTrackId: video } })
  assert.deepEqual(result.duck, { keyTrackId: video, amountDb: 6, attackFrames: 8, releaseFrames: 15 })
  call({ itemId: MUSIC, duck: { amountDb: 12 } })
  assert.deepEqual(item(MUSIC).duck, { keyTrackId: video, amountDb: 12, attackFrames: 8, releaseFrames: 15 })
  assert.deepEqual((inspectItem({ itemId: MUSIC }).audio as Record<string, unknown>).duck, item(MUSIC).duck)
  call({ itemId: MUSIC, duck: null })
  assert.equal(item(MUSIC).duck, undefined)
})

test('a duck under its own track, an unknown track or an out-of-range amount is refused with the way out', () => {
  const { video, audio } = load()
  assert.match(refusal({ itemId: MUSIC, duck: { keyTrackId: audio } }), /cannot duck under its own track/)
  const unknown = refusal({ itemId: MUSIC, duck: { keyTrackId: 'trk_nope' } })
  assert.ok(unknown.includes(video), `the refusal must list the tracks: ${unknown}`)
  assert.match(refusal({ itemId: MUSIC, duck: { keyTrackId: video, amountDb: 0 } }), /above 0 and at most 40/)
  assert.match(refusal({ itemId: MUSIC, duck: { keyTrackId: video, depth: 6 } }), /no field "depth"/)
  assert.match(refusal({ itemId: MUSIC, duck: {} }), /needs keyTrackId/)
  // Positive control.
  assert.equal((call({ itemId: MUSIC, duck: { keyTrackId: video, amountDb: 9 } }).duck as { amountDb: number }).amountDb, 9)
})
