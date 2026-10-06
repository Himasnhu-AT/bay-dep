/**
 * `edit_item.masks` as an agent meets it: the schema, the handler, one undo step, what is read
 * back — and the store's `setShapeMasks`, which the inspector and the viewer's handles write
 * through. Every refusal sits beside the nearest call that must pass.
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

function asset(id: string, kind: Asset['kind']): Asset {
  return {
    id, kind, name: `${id}.${kind}`, path: kind === 'text' ? '' : `/m/${id}`,
    durationUs: kind === 'video' ? 120_000_000 : 0, width: 1920, height: 1080, fps: 30, hasAudio: kind === 'video', hasVideo: true,
    posterPath: null, waveformPath: null, createdAt: 0
  }
}

function clip(id: string, trackId: string, from: number, assetId: string, extra: Partial<Item> = {}): Item {
  return {
    id, assetId, trackId, from, durationInFrames: 60, sourceStartUs: 0,
    layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
    volume: 1, fadeInFrames: 0, fadeOutFrames: 0, speed: 1, ...extra
  }
}

const SHOT = 'itm_shotshotsh'
const TITLE = 'itm_titletitle'
const CUTOUT = 'itm_cutoutcuto'

function load(): void {
  const project = emptyProject()
  project.assets = [asset('shot', 'video'), asset('title', 'text')]
  const timeline = project.timelines[0]!
  const video = timeline.tracks.find((t) => t.kind === 'video')!
  video.items = [clip(SHOT, video.id, 0, 'shot', { linkId: 'lnk_pair' }), clip(TITLE, video.id, 100, 'title')]
  // The subject cut-out of SHOT, on a track above: same file, same moment, linked, silent.
  const above = { ...video, id: 'trk_above', name: 'V2', items: [clip(CUTOUT, 'trk_above', 0, 'shot', { linkId: 'lnk_pair', audioDetached: true, masks: [{ kind: 'subject', feather: 4 }] })] }
  timeline.tracks.splice(timeline.tracks.indexOf(video) + 1, 0, above)
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

const OVAL = { kind: 'ellipse', x: 0.5, y: 0.5, width: 0.6, height: 0.8, feather: 60 }
const LEFT = { kind: 'rect', x: 0.25, y: 0.5, width: 0.5, height: 1 }

test('masks are set whole, in order, as one undo step, and read back by the result and inspect_item', () => {
  load()
  const before = past()
  const result = call({ itemId: SHOT, masks: [OVAL, { ...LEFT, combine: 'subtract' }] })
  assert.equal(past(), before + 1)
  assert.deepEqual(stored(SHOT).masks, [OVAL, { ...LEFT, combine: 'subtract' }])
  assert.deepEqual(result.masks, stored(SHOT).masks)
  assert.deepEqual(inspectItem({ itemId: SHOT }).masks, stored(SHOT).masks)
  // The list replaces: one mask in, one mask stored.
  call({ itemId: SHOT, masks: [LEFT] })
  assert.deepEqual(stored(SHOT).masks, [LEFT])
  // Defaults are stored as absence, so a mask set to its defaults saves as one never touched.
  call({ itemId: SHOT, masks: [{ ...LEFT, rotation: 0, feather: 0, opacity: 1, invert: false, combine: 'add', radius: 0 }] })
  assert.deepEqual(stored(SHOT).masks, [LEFT])
  // …and so that call changed nothing and took no undo step: one undo is back at the first list.
  assert.equal(past(), before + 2)
  useEditor.getState().undo()
  assert.deepEqual(stored(SHOT).masks, [OVAL, { ...LEFT, combine: 'subtract' }])
})

test('[] and null remove the shapes, and an edit that names no masks leaves them alone', () => {
  load()
  call({ itemId: SHOT, masks: [OVAL] })
  call({ itemId: SHOT, opacity: 0.5 })
  assert.deepEqual(stored(SHOT).masks, [OVAL], 'another field does not touch the masks')
  const cleared = call({ itemId: SHOT, masks: [] })
  assert.equal(stored(SHOT).masks, undefined)
  assert.equal('masks' in cleared, false)
  assert.equal('masks' in inspectItem({ itemId: SHOT }), false)
  call({ itemId: SHOT, masks: [OVAL] })
  call({ itemId: SHOT, masks: null })
  assert.equal(stored(SHOT).masks, undefined)
})

test('a bad mask is refused naming the mask, the field and its range, and nothing changes; the legal twin passes', () => {
  load()
  call({ itemId: SHOT, masks: [OVAL] })
  const before = past()
  const cases: [Record<string, unknown>, RegExp, Record<string, unknown>][] = [
    [{ ...OVAL, feather: 5000 }, /masks\[1\]\.feather must be a number of timeline pixels from 0 to 1000.*got 5000/, { ...OVAL, feather: 1000 }],
    [{ ...OVAL, opacity: -0.1 }, /masks\[1\]\.opacity must be a number from 0 to 1; got -0\.1/, { ...OVAL, opacity: 0 }],
    [{ ...OVAL, width: 0 }, /masks\[1\]\.width must be a number from 0\.001 to 8/, { ...OVAL, width: 0.001 }],
    [{ ...OVAL, kind: 'circle' }, /masks\[1\]\.kind must be "rect", "ellipse", "path" or "subject"; got "circle"/, { ...OVAL, kind: 'ellipse' }],
    [{ ...OVAL, combine: 'difference' }, /masks\[1\]\.combine must be "add", "subtract" or "intersect"/, { ...OVAL, combine: 'intersect' }],
    [{ ...LEFT, radius: 3 }, /masks\[1\]\.radius must be a number from 0 .* to 1/, { ...LEFT, radius: 1 }],
    [{ ...LEFT, kind: 'path', points: [{ x: 0, y: 0 }] }, /masks\[1\]\.points must be a list of 3 to 64 points.*got 1 points/, { ...LEFT, kind: 'path', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }] }]
  ]
  for (const [bad, pattern, good] of cases) {
    assert.match(refusal({ itemId: SHOT, masks: [LEFT, bad] }), pattern)
    assert.deepEqual(stored(SHOT).masks, [OVAL], 'a refused call stores nothing')
    assert.equal(past(), before, 'and leaves no undo step')
    call({ itemId: SHOT, masks: [LEFT, good] })
    call({ itemId: SHOT, masks: [OVAL] })
    useEditor.getState().undo()
    useEditor.getState().undo()
  }
  assert.match(refusal({ itemId: SHOT, masks: OVAL }), /masks must be a list.*\[\] to remove/)
})

test('masks reach picture clips only: a title is refused with what to do instead, and can still be cleared', () => {
  load()
  const message = refusal({ itemId: TITLE, masks: [OVAL] })
  assert.match(message, /draws a text asset, which shape masks do not reach/)
  assert.match(message, /video, image, gif, html, brf/)
  assert.match(message, /write_brf/)
  assert.equal(stored(TITLE).masks, undefined)
  // The same list on a video clip passes, and clearing is never refused.
  call({ itemId: SHOT, masks: [OVAL] })
  call({ itemId: TITLE, masks: [] })
})

test('a subject mask is not this field\'s to write, and a clip that has one keeps it', () => {
  load()
  assert.match(refusal({ itemId: SHOT, masks: [{ kind: 'subject' }, OVAL] }), /shape masks only.*put_behind_subject/)
  // Unlink the cut-out so it stands alone (its clip gone): shapes then go on it, after its subject mask.
  useEditor.getState().unlinkItems([CUTOUT])
  call({ itemId: CUTOUT, masks: [OVAL] })
  assert.deepEqual(stored(CUTOUT).masks, [{ kind: 'subject', feather: 4 }, OVAL])
  call({ itemId: CUTOUT, masks: [] })
  assert.deepEqual(stored(CUTOUT).masks, [{ kind: 'subject', feather: 4 }], 'clearing the shapes keeps the subject mask as it was')
})

test('masks aimed at a subject cut-out are refused naming its clip; the same call on the clip passes', () => {
  load()
  const message = refusal({ itemId: CUTOUT, masks: [OVAL] })
  assert.match(message, new RegExp(`subject cut-out of clip ${SHOT}`))
  assert.match(message, /masks/)
  assert.match(message, new RegExp(`edit_item\\(\\{ itemId: "${SHOT}"`))
  assert.deepEqual(stored(CUTOUT).masks, [{ kind: 'subject', feather: 4 }])
  call({ itemId: SHOT, masks: [OVAL] })
  assert.deepEqual(stored(SHOT).masks, [OVAL])
})

// -- the store action the inspector and the viewer write through -----------------------------------

test('setShapeMasks replaces the shapes, keeps a subject mask, and sends a cut-out\'s to its clip', () => {
  load()
  const s = (): ReturnType<typeof useEditor.getState> => useEditor.getState()
  const before = past()
  s().setShapeMasks(SHOT, [OVAL as never])
  assert.deepEqual(stored(SHOT).masks, [OVAL])
  assert.equal(past(), before + 1)
  // Aimed at the cut-out: the clip's masks change, the cut-out's subject mask does not.
  s().setShapeMasks(CUTOUT, [LEFT as never])
  assert.deepEqual(stored(SHOT).masks, [LEFT])
  assert.deepEqual(stored(CUTOUT).masks, [{ kind: 'subject', feather: 4 }])
  // A list that could not be drawn stores nothing and takes no undo step.
  const steps = past()
  s().setShapeMasks(SHOT, [{ ...OVAL, width: Number.NaN } as never])
  assert.deepEqual(stored(SHOT).masks, [LEFT])
  assert.equal(past(), steps)
  // Empty removes the field altogether — an unmasked clip carries no key.
  s().setShapeMasks(SHOT, [])
  assert.equal('masks' in stored(SHOT), false)
  // On a clip with a subject mask of its own, the subject mask stays first.
  s().unlinkItems([CUTOUT])
  s().setShapeMasks(CUTOUT, [OVAL as never])
  assert.deepEqual(stored(CUTOUT).masks, [{ kind: 'subject', feather: 4 }, OVAL])
})

test('a drag on the viewer is one undo step however many moves it writes', () => {
  load()
  const s = (): ReturnType<typeof useEditor.getState> => useEditor.getState()
  s().setShapeMasks(SHOT, [OVAL as never])
  const before = past()
  s().beginGesture()
  for (let i = 1; i <= 5; i += 1) s().setShapeMasks(SHOT, [{ ...OVAL, x: 0.5 + i / 100 } as never])
  s().endGesture()
  assert.equal(past(), before + 1)
  assert.equal((stored(SHOT).masks![0] as { x: number }).x, 0.55)
  s().undo()
  assert.deepEqual(stored(SHOT).masks, [OVAL])
})
