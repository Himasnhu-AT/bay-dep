/**
 * `trim_item` as an agent meets it: the catalog's schema, the handler, and the store's undo.
 *
 * The planner's arithmetic is covered in `shared/trim.test.ts`. What this file holds still is
 * the surface around it — that a refusal reaches the caller with the legal range in it, that a
 * refusal leaves no undo step, that one call is exactly one undo step, and that a shortened
 * transition is reported rather than left to be discovered.
 *
 * The dispatcher itself cannot load under plain Node (it reaches the engine barrel), so each
 * call runs `validateArgs` against the catalog entry and then the handler — the same two steps
 * `executeToolCall` takes, minus the registration `test/app/mcp.mjs` covers.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findTool } from '@shared/mcp'
import { framesToUs, itemEnd, type Asset, type Item } from '@shared/project'
import { emptyProject, useEditor } from '@/store/editor'
import { validateArgs } from '@shared/validate'
import { trimItem } from './trim'
import { ToolError } from './helpers'

const at = (frames: number): number => framesToUs(frames, 30)

function asset(id: string, frames: number): Asset {
  return {
    id,
    kind: 'video',
    name: `${id}.mp4`,
    path: `/m/${id}.mp4`,
    durationUs: at(frames),
    width: 1920,
    height: 1080,
    fps: 30,
    hasAudio: true,
    hasVideo: true,
    posterPath: null,
    waveformPath: null,
    createdAt: 0
  }
}

function clip(id: string, from: number, duration: number, assetId: string, sourceFrames: number): Item {
  return {
    id,
    assetId,
    trackId: '',
    from,
    durationInFrames: duration,
    sourceStartUs: at(sourceFrames),
    layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
    volume: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    speed: 1
  }
}

/** A over B at a cut on frame 60, both with footage to spare, plus a clip C that ends its source. */
function load(options: { locked?: boolean } = {}): void {
  const project = emptyProject()
  project.assets = [asset('long', 3600), asset('short', 60)]
  const timeline = project.timelines[0]!
  const video = timeline.tracks.find((t) => t.kind === 'video')!
  video.locked = options.locked ?? false
  video.items = [
    clip('itm_aaaaaaaaaa', 0, 60, 'long', 100),
    clip('itm_bbbbbbbbbb', 60, 60, 'long', 2000),
    clip('itm_cccccccccc', 120, 30, 'short', 30)
  ].map((i) => ({ ...i, trackId: video.id }))
  useEditor.getState().setProject(project)
}

/** One call the way the dispatcher makes it: schema first, then the handler. */
function call(args: Record<string, unknown>): Record<string, unknown> {
  const spec = findTool('trim_item')
  assert.ok(spec, 'trim_item must be in the catalog')
  const invalid = validateArgs(spec, args)
  if (invalid) throw new ToolError(invalid)
  return trimItem(args)
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

const items = (): Item[] =>
  useEditor.getState().project.timelines[0]!.tracks.flatMap((t) => t.items)
const byId = (id: string): Item => items().find((i) => i.id === id)!
const past = (): number => useEditor.getState().past.length

test('the schema refuses a missing delta and an unknown mode, naming what it accepts', () => {
  load()
  assert.match(refusal({ itemId: 'itm_aaaaaaaaaa', mode: 'roll' }), /requires "deltaFrames"/)
  assert.match(refusal({ itemId: 'itm_aaaaaaaaaa', mode: 'ripple', deltaFrames: 3 }), /"slip", "slide" or "roll"/)
  assert.match(refusal({ itemId: 'itm_aaaaaaaaaa', mode: 'roll', deltaFrames: 2.5 }), /whole number/)
  // And the nearest legal call goes through.
  call({ itemId: 'itm_aaaaaaaaaa', mode: 'roll', deltaFrames: 3 })
})

test('a roll is one undo step, and undo puts the cut back where it was', () => {
  load()
  const before = past()
  const result = call({ itemId: 'itm_aaaaa', mode: 'roll', deltaFrames: 12 })

  assert.equal(past(), before + 1, 'one tool call must be exactly one undo step')
  assert.equal(itemEnd(byId('itm_aaaaaaaaaa')), 72)
  assert.equal(byId('itm_bbbbbbbbbb').from, 72)
  const reported = (result.items as { itemId: string; from: number }[]).find((i) => i.itemId === 'itm_bbbbbbbbbb')
  assert.equal(reported?.from, 72, 'the result reports the state after the edit')

  useEditor.getState().undo()
  assert.equal(itemEnd(byId('itm_aaaaaaaaaa')), 60)
  assert.equal(byId('itm_bbbbbbbbbb').from, 60)
})

test('a refused roll reaches the caller with the legal range and leaves no undo step', () => {
  load()
  const before = past()
  // C reads the last 30 frames of `short`, so it has exactly 30 frames before its in-point:
  // the B|C cut can roll 30 frames earlier and no further.
  const message = refusal({ itemId: 'itm_bbbbbbbbbb', mode: 'roll', deltaFrames: -31 })
  assert.match(message, /-30 to \+29/, 'the refusal must carry the range that would work')
  assert.match(message, /itm_cccccccccc after the cut has only 30 frames of source before its in-point/)
  assert.equal(past(), before, 'a refusal must not leave an undo step that undoes nothing')

  // The nearest legal call: the same cut, rolled exactly as far as it has room for.
  call({ itemId: 'itm_bbbbbbbbbb', mode: 'roll', deltaFrames: -30 })
  assert.equal(past(), before + 1)
})

test('a locked track is refused naming the track, and the same trim unlocked is not', () => {
  load({ locked: true })
  assert.match(refusal({ itemId: 'itm_aaaaaaaaaa', mode: 'slip', deltaFrames: 5 }), /V1 is locked/)
  load()
  call({ itemId: 'itm_aaaaaaaaaa', mode: 'slip', deltaFrames: 5 })
})

test('a transition the roll shortens is reported as a warning with the new length', () => {
  load()
  useEditor.getState().addTransition({
    fromItemId: 'itm_bbbbbbbbbb',
    toItemId: 'itm_cccccccccc',
    kind: 'cross-dissolve',
    durationInFrames: 20
  })
  // Rolling the B|C cut 25 frames earlier spends 25 of C's 30 frames before its in-point, so
  // the incoming side has 5 left where the dissolve wanted 10.
  const result = call({ itemId: 'itm_cccccccccc', mode: 'roll', deltaFrames: -25, edge: 'start' })
  const transitions = result.transitions as { transitionId: string; effectiveDurationInFrames: number | null }[]
  assert.equal(transitions.length, 1, 'the transition on the rolled cut must be reported')
  const warnings = (result.warnings ?? []) as string[]
  assert.equal(warnings.length, 1)
  assert.match(warnings[0]!, /now 10 frames, not 20/)
})

test('sliding the last clip right says the track got longer, because nothing absorbed it', () => {
  load()
  // B sits between A and C; slide C instead, which has B before it and nothing after.
  const result = call({ itemId: 'itm_cccccccccc', mode: 'slide', deltaFrames: 4 })
  assert.match(String(result.note), /now ends at frame 154 instead of 150/)
})
