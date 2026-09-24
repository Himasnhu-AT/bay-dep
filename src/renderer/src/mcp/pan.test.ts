/**
 * `edit_item`'s `pan` as an agent (and the inspector, which calls the same handler) meets it: the
 * schema, the handler, one undo step, and `inspect_item` reading it back — absent at centre.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findTool } from '@shared/mcp'
import { type Asset, type Item } from '@shared/project'
import { validateArgs } from '@shared/validate'
import { emptyProject, useEditor } from '@/store/editor'
import { editItem } from './write'
import { inspectItem } from './read'
import { ToolError } from './helpers'

function asset(id: string, hasAudio: boolean): Asset {
  return {
    id, kind: hasAudio ? 'video' : 'image', name: `${id}.${hasAudio ? 'mp4' : 'png'}`, path: `/m/${id}`,
    durationUs: hasAudio ? 120_000_000 : 0, width: 1920, height: 1080, fps: 30, hasAudio, hasVideo: true,
    posterPath: null, waveformPath: null, createdAt: 0
  }
}

function clip(id: string, trackId: string, from: number, assetId: string): Item {
  return {
    id, assetId, trackId, from, durationInFrames: 60, sourceStartUs: 0,
    layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
    volume: 1, fadeInFrames: 0, fadeOutFrames: 0, speed: 1
  }
}

const SHOT = 'itm_pppppppppp'
const STILL = 'itm_qqqqqqqqqq'

function load(): void {
  const project = emptyProject()
  project.assets = [asset('shot', true), asset('still', false)]
  const video = project.timelines[0]!.tracks.find((t) => t.kind === 'video')!
  video.items = [clip(SHOT, video.id, 0, 'shot'), clip(STILL, video.id, 100, 'still')]
  useEditor.getState().setProject(project)
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

const stored = (id: string): Item =>
  useEditor.getState().project.timelines[0]!.tracks.flatMap((t) => t.items).find((i) => i.id === id)!
const past = (): number => useEditor.getState().past.length

test('a pan is one undo step, reported with its channel gains, and read back by inspect_item', () => {
  load()
  const before = past()
  const result = call({ itemId: SHOT, pan: -0.5 })
  assert.equal(past(), before + 1)
  assert.equal(stored(SHOT).pan, -0.5)
  assert.equal(result.pan, -0.5)
  assert.equal(result.panGains, 'left 2.3 dB, right -5.3 dB')
  const audio = inspectItem({ itemId: SHOT }).audio as Record<string, unknown>
  assert.equal(audio.pan, -0.5)
  // 0 is centre, stored as absence (undefined, which a save drops) and reported as absence — and it is an undoable change.
  call({ itemId: SHOT, pan: 0 })
  assert.equal(stored(SHOT).pan, undefined)
  assert.equal((inspectItem({ itemId: SHOT }).audio as Record<string, unknown>).pan, undefined)
  useEditor.getState().undo()
  assert.equal(stored(SHOT).pan, -0.5)
})

test('out of range, or on a clip with no sound, is refused with the range and the reason', () => {
  load()
  assert.match(refusal({ itemId: SHOT, pan: 1.5 }), /pan/)
  assert.match(refusal({ itemId: SHOT, pan: -2 }), /pan/)
  const still = refusal({ itemId: STILL, pan: 0.5 })
  assert.match(still, /still\.png, which has no audio/)
  assert.match(still, /Pan applies to clips with sound/)
  // The nearest legal calls go through: the ends of the range, and centring the still.
  assert.equal(call({ itemId: SHOT, pan: 1 }).pan, 1)
  assert.equal(call({ itemId: SHOT, pan: -1 }).pan, -1)
  call({ itemId: STILL, pan: 0 })
  assert.equal(stored(STILL).pan, undefined)
})
