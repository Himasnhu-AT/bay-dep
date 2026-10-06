/**
 * Adding an adjustment layer, as the agent's tool and the UI's action meet it: where it lands,
 * what it reports, one undo step for the asset and the clip together, and which `edit_item`
 * fields a layer takes. Every refusal sits beside the nearest call that passes.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findTool } from '@shared/mcp'
import { type Asset, type Item, type Track } from '@shared/project'
import { isVisualItem } from '@shared/inspector'
import { isGradeableKind } from '@shared/grade'
import { validateArgs } from '@shared/validate'
import { emptyProject, useEditor } from '@/store/editor'
import { addAdjustmentLayer } from './adjustmentLayer'
import { editItem } from './write'
import { ToolError } from './helpers'

const shot: Asset = {
  id: 'shot', kind: 'video', name: 'shot.mp4', path: '/m/shot.mp4', durationUs: 120_000_000, width: 1920, height: 1080, fps: 30,
  hasAudio: false, hasVideo: true, posterPath: null, waveformPath: null, createdAt: 0
}

function clip(id: string, trackId: string, from: number, durationInFrames = 60): Item {
  return {
    id, assetId: 'shot', trackId, from, durationInFrames, sourceStartUs: 0,
    layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
    volume: 1, fadeInFrames: 0, fadeOutFrames: 0, speed: 1
  }
}

/** V1 holds two clips (0–60, 100–160); `top` adds a second video track with a clip over 0–60. */
function load(options: { top?: boolean; lockTop?: boolean } = {}): void {
  const project = emptyProject()
  project.assets = [shot]
  const timeline = project.timelines[0]!
  const v1 = timeline.tracks.find((t) => t.kind === 'video')!
  v1.items = [clip('itm_aaaaaaaaaa', v1.id, 0), clip('itm_bbbbbbbbbb', v1.id, 100)]
  if (options.top) {
    const v2: Track = { ...v1, id: 'trk_top', name: 'V2', locked: options.lockTop === true, items: [clip('itm_cccccccccc', 'trk_top', 0)] }
    timeline.tracks.push(v2)
  }
  useEditor.getState().setProject(project)
  useEditor.getState().setPlayhead(0)
}

function call(name: 'add_adjustment_layer' | 'edit_item', args: Record<string, unknown>): Record<string, unknown> {
  const spec = findTool(name)
  assert.ok(spec, `${name} is in the catalog`)
  const invalid = validateArgs(spec, args)
  if (invalid) throw new ToolError(invalid)
  return name === 'edit_item' ? editItem(args) : addAdjustmentLayer(args)
}

function refusal(name: 'add_adjustment_layer' | 'edit_item', args: Record<string, unknown>): string {
  try {
    call(name, args)
  } catch (error) {
    if (error instanceof ToolError) return error.message
    throw error
  }
  assert.fail(`expected ${JSON.stringify(args)} to be refused`)
}

const tl = () => useEditor.getState().project.timelines[0]!
const items = (): Item[] => tl().tracks.flatMap((t) => t.items)
const past = (): number => useEditor.getState().past.length
const videoTracks = (): Track[] => tl().tracks.filter((t) => t.kind === 'video')

test('a layer goes above everything: on the top video track when it is free there, as one undo step', () => {
  load()
  const before = past()
  const result = call('add_adjustment_layer', { from: 0, durationInFrames: 160 })
  assert.equal(past(), before + 1, 'the asset and the clip are one step')
  const layer = items().find((i) => i.id === result.itemId)!
  assert.equal(layer.from, 0)
  assert.equal(layer.durationInFrames, 160)
  assert.equal(result.endFrame, 160)
  // V1 is busy over those frames, so a track was made above it.
  assert.equal(videoTracks().length, 2)
  assert.equal(result.trackId, videoTracks()[1]!.id)
  assert.equal(result.createdTrackId, result.trackId)
  assert.equal(result.clipsBelow, 2)
  const asset = useEditor.getState().project.assets.find((a) => a.id === result.assetId)!
  assert.equal(asset.kind, 'adjustment')
  assert.equal(asset.path, null)
  assert.match(String(result.next), new RegExp(`edit_item\\(\\{ itemId: "${result.itemId}", grade`))
  // The whole frame, whatever the canvas.
  assert.deepEqual(layer.layout, { left: 0, top: 0, width: tl().width, height: tl().height, opacity: 1, rotation: 0 })
  useEditor.getState().undo()
  assert.equal(items().length, 2)
  assert.equal(useEditor.getState().project.assets.length, 1, 'undo takes the asset with it')
  assert.equal(videoTracks().length, 1)
})

test('a second layer shares the asset, and takes the top track when it is free over its frames', () => {
  load({ top: true })
  // V2 holds a clip over 0–60: a layer over 60–100 fits on it; one over 0–60 needs a new track.
  const free = call('add_adjustment_layer', { from: 60, durationInFrames: 40 })
  assert.equal(free.trackId, 'trk_top')
  assert.equal('createdTrackId' in free, false)
  const busy = call('add_adjustment_layer', { from: 0, durationInFrames: 60 })
  assert.notEqual(busy.trackId, 'trk_top')
  assert.equal(busy.createdTrackId, busy.trackId)
  assert.equal(busy.assetId, free.assetId, 'one adjustment asset serves every layer')
  assert.equal(useEditor.getState().project.assets.filter((a) => a.kind === 'adjustment').length, 1)
  assert.equal(busy.clipsBelow, 2, 'a clip on V1 and one on V2 are under it')
})

test('with no span it starts at the playhead for five seconds, whatever is selected', () => {
  load()
  useEditor.getState().setPlayhead(130)
  useEditor.getState().select(['itm_aaaaaaaaaa'])
  const result = call('add_adjustment_layer', {})
  assert.equal(useEditor.getState().playhead, 130, 'the specimen: the playhead is where it was put')
  assert.equal(result.from, 130, 'the playhead — not the selected clip, which starts at 0')
  assert.equal(result.durationInFrames, 5 * tl().fps)
  assert.equal(result.clipsBelow, 1)
  assert.equal('warnings' in result, false)
  // Over frames with nothing under them: said, with what to do.
  const empty = call('add_adjustment_layer', { from: 400, durationInFrames: 150 })
  assert.equal(empty.clipsBelow, 0)
  assert.match((empty.warnings as string[])[0]!, /Nothing is drawn under the layer over frames 400–550/)
})

test('the UI\'s action covers the selected clips, and selects the new layer', () => {
  load()
  useEditor.getState().select(['itm_aaaaaaaaaa', 'itm_bbbbbbbbbb'])
  const result = useEditor.getState().addAdjustmentLayer()
  assert.ok(result.ok)
  const layer = items().find((i) => result.ok && i.id === result.itemId)!
  assert.equal(layer.from, 0)
  assert.equal(layer.durationInFrames, 160, 'from the first selected clip\'s start to the last one\'s end')
  assert.deepEqual(useEditor.getState().selection, [layer.id])
  // With nothing selected it starts at the playhead.
  useEditor.getState().clearSelection()
  useEditor.getState().setPlayhead(90)
  const second = useEditor.getState().addAdjustmentLayer()
  assert.ok(second.ok)
  assert.equal(items().find((i) => second.ok && i.id === second.itemId)!.from, 90)
})

test('a named track is used as asked or refused with why and what to do — never quietly swapped', () => {
  load({ top: true })
  const v1 = videoTracks()[0]!
  const audio = tl().tracks.find((t) => t.kind === 'audio')!
  const before = past()
  // Busy over those frames: names the clip in the way, its frames, and the way out.
  const clash = refusal('add_adjustment_layer', { from: 30, durationInFrames: 60, trackId: v1.id })
  assert.match(clash, /already has clip itm_aaaaaaaaaa over frames 0–60/)
  assert.match(clash, /Leave trackId out/)
  // An audio track, and one that does not exist: both name the video tracks there are.
  assert.match(refusal('add_adjustment_layer', { from: 0, durationInFrames: 30, trackId: audio.id }), new RegExp(`is an audio track.*${v1.id}`))
  assert.match(refusal('add_adjustment_layer', { from: 0, durationInFrames: 30, trackId: 'trk_nope' }), new RegExp(`No track trk_nope.*${v1.id}.*trk_top`))
  assert.equal(past(), before, 'a refusal changes nothing')
  assert.equal(items().length, 3)
  // The nearest legal call: the same track, clear frames. (V2's clip is stretched over them first,
  // so there is something above the layer to be told about.)
  useEditor.getState().patchItem('itm_cccccccccc', { durationInFrames: 100 })
  const ok = call('add_adjustment_layer', { from: 60, durationInFrames: 40, trackId: v1.id })
  assert.equal(ok.trackId, v1.id)
  assert.equal(ok.clipsBelow, 0, 'nothing is below the lowest track')
  assert.match((ok.warnings as string[]).join(' '), /Clips on V2 are above the layer and are not changed by it/)
})

test('a locked top track is left alone: named when asked for, passed over when not', () => {
  load({ top: true, lockTop: true })
  assert.match(refusal('add_adjustment_layer', { from: 60, durationInFrames: 40, trackId: 'trk_top' }), /V2 is locked\. Unlock it, or leave trackId out/)
  const result = call('add_adjustment_layer', { from: 60, durationInFrames: 40 })
  assert.notEqual(result.trackId, 'trk_top')
  assert.equal(tl().tracks.find((t) => t.id === 'trk_top')!.items.length, 1)
})

test('a layer takes a look, masks, opacity and timing from edit_item — and refuses the fields it does not read', () => {
  load()
  const { itemId } = call('add_adjustment_layer', { from: 0, durationInFrames: 160 })
  const layer = (): Item => items().find((i) => i.id === itemId)!
  call('edit_item', { itemId, adjustments: { saturate: 0.2 }, opacity: 0.6, fadeInFrames: 12 })
  call('edit_item', { itemId, grade: { saturation: 0.5 } })
  call('edit_item', { itemId, masks: [{ kind: 'ellipse', x: 0.5, y: 0.5, width: 0.6, height: 0.8, feather: 80, invert: true }] })
  call('edit_item', { itemId, from: 10, durationInFrames: 100 })
  assert.equal(layer().adjustments?.saturate, 0.2)
  assert.equal(layer().grade?.saturation, 0.5)
  assert.equal(layer().masks?.length, 1)
  assert.equal(layer().layout.opacity, 0.6)
  assert.equal(layer().from, 10)

  const before = past()
  for (const [args, named] of [
    [{ left: 100 }, 'left'],
    [{ width: 800, height: 450 }, 'width, height'],
    [{ scale: 1.2 }, 'scale'],
    [{ crop: { left: 0.1 } }, 'crop'],
    [{ blendMode: 'multiply' }, 'blendMode'],
    [{ speed: 2 }, 'speed']
  ] as const) {
    const message = refusal('edit_item', { itemId, ...args })
    assert.match(message, new RegExp(`is an adjustment layer.*so ${named} do(es)? nothing on it`))
    assert.match(message, /give it masks/)
  }
  assert.equal(past(), before)
  // The same fields on an ordinary clip pass.
  call('edit_item', { itemId: 'itm_aaaaaaaaaa', left: 100, scale: 1.2, crop: { left: 0.1 }, blendMode: 'multiply' })
})

test('a layer is a picture clip to the inspector and the grade: it gets Video, Effects and Color', () => {
  assert.equal(isVisualItem('adjustment', 'video'), true)
  assert.equal(isGradeableKind('adjustment'), true)
  // Control: a kind that is neither stays neither.
  assert.equal(isGradeableKind('text'), false)
  assert.equal(isVisualItem('audio', 'audio'), false)
})
