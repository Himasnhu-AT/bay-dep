/**
 * Review comments, through the store and through the agent surface.
 *
 * What is held still: the user's note is what `read_feedback` hands back, with the items under
 * it; every store action is one undo step that undo takes back; a refusal names the comments
 * that would have worked, and each refusal sits beside the nearest legal call that succeeds; a
 * bad id among several resolves none; removing the last comment leaves no `comments: []`; and a
 * removed span of time carries comments with it like markers.
 *
 * Calls run `validateArgs` against the catalog and then the handler, as `markers.test.ts` does.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findTool } from '@shared/mcp'
import { rippleDelete } from '@shared/ripple'
import type { Item, ReviewComment, Timeline } from '@shared/project'
import { emptyProject, useEditor } from '@/store/editor'
import { validateArgs } from '@shared/validate'
import { addComment, readFeedback, resolveFeedback } from './feedback'
import { ToolError } from './helpers'

function load(): void {
  useEditor.getState().setProject(emptyProject())
}

const HANDLERS: Record<string, (args: Record<string, unknown>) => Record<string, unknown>> = {
  read_feedback: readFeedback,
  resolve_feedback: resolveFeedback,
  add_comment: addComment
}

function call(tool: string, args: Record<string, unknown>): Record<string, unknown> {
  const spec = findTool(tool)
  assert.ok(spec, `${tool} must be in the catalog`)
  const invalid = validateArgs(spec, args)
  if (invalid) throw new ToolError(invalid)
  return HANDLERS[tool]!(args)
}

function refusal(tool: string, args: Record<string, unknown>): string {
  try {
    call(tool, args)
  } catch (error) {
    if (error instanceof ToolError) return error.message
    throw error
  }
  assert.fail(`expected ${tool} ${JSON.stringify(args)} to be refused`)
}

const timeline = (): Timeline => useEditor.getState().project.timelines[0]!
const comments = (): ReviewComment[] => timeline().comments ?? []
const past = (): number => useEditor.getState().past.length
type Listed = { id: string; frame: number; text: string; timecode: string; itemsUnder: { itemId: string }[]; resolved: boolean; resolvedNote?: string }
const listed = (args: Record<string, unknown> = {}): Listed[] => call('read_feedback', args).comments as Listed[]

/** A project with one video clip on frames [0, 60), so "items under the comment" has an answer. */
function loadWithClip(): string {
  const project = emptyProject()
  project.assets = [
    {
      id: 'ast_clip',
      kind: 'video',
      name: 'take.mp4',
      path: '/m/take.mp4',
      durationUs: 10_000_000,
      width: 1920,
      height: 1080,
      fps: 30,
      hasAudio: true,
      hasVideo: true,
      posterPath: null,
      waveformPath: null,
      createdAt: 0
    }
  ]
  const video = project.timelines[0]!.tracks.find((t) => t.kind === 'video')!
  const item: Item = {
    id: 'itm_clipaaaaaa',
    assetId: 'ast_clip',
    trackId: video.id,
    from: 0,
    durationInFrames: 60,
    sourceStartUs: 0,
    layout: { left: 0, top: 0, width: 1920, height: 1080, opacity: 1, rotation: 0 },
    volume: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    speed: 1
  }
  video.items = [item]
  useEditor.getState().setProject(project)
  return item.id
}

test('a comment the user leaves is what read_feedback returns, with the items under it', () => {
  const itemId = loadWithClip()
  assert.deepEqual(listed(), [], 'no comments is an empty list')

  useEditor.getState().addComment(90, 'music too loud after the title')
  useEditor.getState().addComment(30, '  cut this line  ')

  const open = listed()
  assert.deepEqual(open.map((c) => [c.frame, c.text]), [[30, 'cut this line'], [90, 'music too loud after the title']])
  assert.deepEqual(open[0]!.itemsUnder.map((i) => i.itemId), [itemId], 'the clip playing at frame 30')
  assert.deepEqual(open[1]!.itemsUnder, [], 'nothing plays at frame 90')
  assert.match(open[0]!.timecode, /\d/)
})

test('each store action is one undo step, and undo takes it back', () => {
  load()
  const s = (): ReturnType<typeof useEditor.getState> => useEditor.getState()

  const id = s().addComment(10, 'first')!
  assert.equal(past(), 1)
  s().editComment(id, { text: 'first, reworded' })
  assert.equal(past(), 2)
  s().resolveComment(id, 'done')
  assert.equal(past(), 3)
  assert.equal(comments()[0]!.resolved, true)
  assert.equal(comments()[0]!.resolvedNote, 'done')

  s().undo()
  assert.equal(comments()[0]!.resolved, false, 'undo reopens it')
  s().undo()
  assert.equal(comments()[0]!.text, 'first')
  s().undo()
  assert.equal(timeline().comments, undefined, 'undo takes the comment away')

  // A no-op leaves no dead undo step: an empty text, an unknown id.
  assert.equal(s().addComment(5, '   '), null)
  s().resolveComment('cm_nope')
  assert.equal(past(), 0)
})

test('reopening drops the note; removing the last comment leaves no empty list', () => {
  load()
  const id = useEditor.getState().addComment(10, 'x')!
  useEditor.getState().resolveComment(id, 'fixed')
  useEditor.getState().editComment(id, { resolved: false })
  assert.equal(comments()[0]!.resolved, false)
  assert.equal('resolvedNote' in comments()[0]!, false)
  useEditor.getState().removeComment(id)
  assert.equal('comments' in timeline(), false)
})

test('read_feedback shows open comments by default and every one with include: all', () => {
  load()
  const a = useEditor.getState().addComment(10, 'a')!
  useEditor.getState().addComment(20, 'b')
  useEditor.getState().resolveComment(a, 'did a')
  assert.deepEqual(listed().map((c) => c.text), ['b'])
  const all = listed({ include: 'all' })
  assert.deepEqual(all.map((c) => [c.text, c.resolved, c.resolvedNote]), [['a', true, 'did a'], ['b', false, undefined]])
  assert.match(refusal('read_feedback', { include: 'resolved' }), /open|all/)
})

test('resolve_feedback: an unknown id names the open comments, and a real one resolves', () => {
  load()
  assert.match(refusal('resolve_feedback', { commentIds: ['cm_nope'], note: 'x' }), /no review comments/)

  const id = useEditor.getState().addComment(40, 'tighten the pause')!
  const message = refusal('resolve_feedback', { commentIds: ['cm_nope'], note: 'x' })
  assert.ok(message.includes(id), 'the refusal must name the open comment ids')
  assert.match(message, /"tighten the pause" at frame 40/)
  assert.match(refusal('resolve_feedback', { commentIds: [id], note: '  ' }), /note is empty/)
  assert.equal(past(), 1, 'refusals leave no undo step')

  const result = call('resolve_feedback', { commentIds: [id.slice(0, 10)], note: 'trimmed 12 frames' })
  assert.equal(result.stillOpen, 0)
  assert.equal(comments()[0]!.resolved, true)
  assert.equal(comments()[0]!.resolvedNote, 'trimmed 12 frames')
})

test('a bad id among several resolves none; a good batch is one undo step with a note each', () => {
  load()
  const a = useEditor.getState().addComment(10, 'a')!
  const b = useEditor.getState().addComment(20, 'b')!
  const before = past()

  const message = refusal('resolve_feedback', { resolutions: [{ commentId: a, note: 'ok' }, { commentId: 'cm_zzz', note: 'ok' }] })
  assert.ok(message.includes(a) && message.includes(b), 'names both open comments')
  assert.equal(comments().filter((c) => c.resolved).length, 0, 'the good first id was not resolved')
  assert.match(refusal('resolve_feedback', { commentIds: [a], note: 'x', resolutions: [] }), /not both/)

  call('resolve_feedback', { resolutions: [{ commentId: a, note: 'did a' }, { commentId: b, note: 'did b' }] })
  assert.equal(past(), before + 1, 'two resolutions, one undo step')
  assert.deepEqual(comments().map((c) => c.resolvedNote), ['did a', 'did b'])
  useEditor.getState().undo()
  assert.equal(comments().filter((c) => c.resolved).length, 0)
})

test('add_comment: the agent leaves a note at the playhead or over a span; a backwards span is refused', () => {
  load()
  useEditor.setState({ playhead: 42 })
  assert.match(refusal('add_comment', { text: '   ' }), /text is empty/)
  assert.match(refusal('add_comment', { text: 'x', frame: 50, endFrame: 50 }), /endFrame \(50\) must be after frame \(50\)/)
  assert.equal(past(), 0)

  const here = call('add_comment', { text: 'is this the take you wanted?' }).comment as { frame: number; id: string }
  assert.equal(here.frame, 42)
  call('add_comment', { text: 'music clips', frame: 50, endFrame: 80 })
  const [first, second] = comments()
  assert.equal(first!.author, 'agent')
  assert.equal(second!.endFrame, 80)
})

test('removing time carries comments like markers: after slides up, inside lands on the cut, a span shrinks', () => {
  load()
  const s = useEditor.getState()
  s.addComment(100, 'after')
  s.addComment(30, 'inside')
  s.addComment(10, 'span', { endFrame: 60 })
  s.addComment(5, 'swallowed span', { endFrame: 45 })
  const draft: Timeline = structuredClone(timeline())
  let n = 0
  rippleDelete(draft, 20, 50, () => `x${n++}`)
  const byText = new Map((draft.comments ?? []).map((c) => [c.text, c]))
  assert.equal(byText.get('after')!.frame, 70)
  assert.equal(byText.get('inside')!.frame, 20)
  assert.deepEqual([byText.get('span')!.frame, byText.get('span')!.endFrame], [10, 30])
  assert.deepEqual([byText.get('swallowed span')!.frame, byText.get('swallowed span')!.endFrame], [5, 20])
})
