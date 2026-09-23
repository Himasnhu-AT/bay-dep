/**
 * `edit_asset`: what it may change, what it must refuse, and that it says who it reached.
 *
 * The property most worth holding still is `usedBy`. Text lives on the asset, so rewording a
 * title rewords every placement of it — correct by the model, and a surprise to an agent that
 * meant to change one. A result that did not name the other placements would be true and
 * useless, so the test asserts the ids are there.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findTool } from '@shared/mcp'
import type { Asset, Item } from '@shared/project'
import { emptyProject, useEditor } from '@/store/editor'
import { validateArgs } from '@shared/validate'
import { editAsset } from './assets'
import { ToolError } from './helpers'

function asset(id: string, kind: Asset['kind'], extra: Partial<Asset> = {}): Asset {
  return {
    id,
    kind,
    name: `${id} original`,
    path: kind === 'text' ? null : `/m/${id}`,
    durationUs: kind === 'text' ? 0 : 5_000_000,
    width: 1920,
    height: 1080,
    fps: 30,
    hasAudio: false,
    hasVideo: kind !== 'text',
    posterPath: null,
    waveformPath: null,
    createdAt: 0,
    ...extra
  }
}

function placed(id: string, assetId: string, from: number): Item {
  return {
    id,
    assetId,
    trackId: '',
    from,
    durationInFrames: 30,
    sourceStartUs: 0,
    layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
    volume: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    speed: 1
  }
}

/** A title placed twice and a video placed once. */
function load(): void {
  const project = emptyProject()
  project.assets = [asset('ast_title', 'text', { text: 'Helo world' }), asset('ast_video', 'video')]
  const video = project.timelines[0]!.tracks.find((t) => t.kind === 'video')!
  video.items = [
    placed('itm_one', 'ast_title', 0),
    placed('itm_two', 'ast_title', 60),
    placed('itm_vid', 'ast_video', 120)
  ].map((i) => ({ ...i, trackId: video.id }))
  useEditor.getState().setProject(project)
}

function call(args: Record<string, unknown>): Record<string, unknown> {
  const spec = findTool('edit_asset')
  assert.ok(spec, 'edit_asset must be in the catalog')
  const invalid = validateArgs(spec, args)
  if (invalid) throw new ToolError(invalid)
  return editAsset(args)
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

const stored = (id: string): Asset => useEditor.getState().project.assets.find((a) => a.id === id)!
const past = (): number => useEditor.getState().past.length

test('rewording a title changes the asset, and names every item it reached', () => {
  load()
  const result = call({ assetId: 'ast_title', text: 'Hello world' })
  assert.equal(stored('ast_title').text, 'Hello world')
  assert.deepEqual(result.changed, ['text'])
  assert.deepEqual([...(result.usedBy as string[])].sort(), ['itm_one', 'itm_two'])
  assert.match(String(result.note), /2 items/)
})

test('an edit is one undo step, and undo restores the words', () => {
  load()
  const before = past()
  call({ assetId: 'ast_title', text: 'Hello world', name: 'Title' })
  assert.equal(past(), before + 1, 'name and text together are one step')
  useEditor.getState().undo()
  assert.equal(stored('ast_title').text, 'Helo world')
  assert.equal(stored('ast_title').name, 'ast_title original')
})

test('text on a video asset is refused naming its kind, and a rename of the same asset works', () => {
  load()
  const message = refusal({ assetId: 'ast_video', text: 'words' })
  assert.match(message, /is a video asset/)
  assert.match(message, /edit_item/, 'the refusal must say where the other properties live')
  assert.equal(stored('ast_video').text, undefined, 'nothing was stored on the video asset')

  call({ assetId: 'ast_video', name: 'Interview A' })
  assert.equal(stored('ast_video').name, 'Interview A')
})

test('an empty name or text is refused, and a call with nothing to change says what it accepts', () => {
  load()
  assert.match(refusal({ assetId: 'ast_title', name: '  ' }), /name is empty/)
  assert.match(refusal({ assetId: 'ast_title', text: '' }), /text is empty/)
  assert.match(refusal({ assetId: 'ast_title' }), /pass name, or text for a text asset/)
  assert.equal(past(), 0, 'no refusal leaves an undo step')
})

test('fields the probe measured are not arguments at all', () => {
  load()
  // The schema rejects them by name, listing what is accepted — rather than accepting and
  // ignoring a duration the file does not have.
  assert.match(refusal({ assetId: 'ast_video', durationUs: 1 }), /no argument "durationUs"/)
  assert.match(refusal({ assetId: 'ast_video', path: '/elsewhere.mp4' }), /accepts "assetId", "name" or "text"/)
})

test('setting the value it already has says so and adds no undo step', () => {
  load()
  const before = past()
  const result = call({ assetId: 'ast_title', name: 'ast_title original' })
  assert.deepEqual(result.changed, [])
  assert.match(String(result.note), /nothing changed/)
  assert.equal(past(), before)
})

test('an unknown asset id is refused as not guessable', () => {
  load()
  assert.match(refusal({ assetId: 'ast_nope', name: 'x' }), /No id starting with "ast_nope"/)
  call({ assetId: 'ast_tit', name: 'x' })
})

test('the store ignores text on a non-text asset even when a caller skips the tool', () => {
  // A second guard at a different layer: the tool refuses with a reason, and the store — which
  // the UI calls directly — must still never store words a video asset cannot draw.
  load()
  useEditor.getState().editAsset('ast_video', { text: 'words' })
  assert.equal(stored('ast_video').text, undefined)
  useEditor.getState().editAsset('ast_title', { text: 'words' })
  assert.equal(stored('ast_title').text, 'words')
})
