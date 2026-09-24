/**
 * Markers, through the store and through the agent surface.
 *
 * What is held still: a marker added is a marker `read_project` returns, one call is one undo
 * step, a refusal names what would have worked, and removing the last marker leaves the
 * timeline exactly as one that never had any — so a saved project does not carry an empty
 * `markers: []` it never asked for.
 *
 * Calls run `validateArgs` against the catalog and then the handler, the two steps the
 * dispatcher takes; see `trim.test.ts` for why the dispatcher itself is not loaded here.
 *
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { findTool } from '@shared/mcp'
import { emptyProject, useEditor } from '@/store/editor'
import { validateArgs } from '@shared/validate'
import { addMarker, removeMarker } from './markers'
import { readProject } from './read'
import { ToolError } from './helpers'

function load(): void {
  useEditor.getState().setProject(emptyProject())
}

const HANDLERS: Record<string, (args: Record<string, unknown>) => Record<string, unknown>> = {
  add_marker: addMarker,
  remove_marker: removeMarker
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

const markers = (): { id: string; frame: number; label: string; color?: string }[] =>
  readProject().markers as { id: string; frame: number; label: string; color?: string }[]
const past = (): number => useEditor.getState().past.length

test('a marker added is a marker read_project returns, in frame order', () => {
  load()
  assert.deepEqual(markers(), [], 'no markers is stated as an empty list, not left out')

  call('add_marker', { frame: 90, label: 'the laugh', color: '#f5a524' })
  call('add_marker', { frame: 12 })

  const listed = markers()
  assert.deepEqual(
    listed.map((m) => [m.frame, m.label]),
    [
      // The lowest unused "Marker N" — the first marker is named, so this one is Marker 1.
      [12, 'Marker 1'],
      [90, 'the laugh']
    ]
  )
  assert.equal(listed[1]!.color, '#F5A524', 'colour is normalised the way text colours are')
})

test('add_marker defaults to the playhead', () => {
  load()
  useEditor.setState({ playhead: 42 })
  const result = call('add_marker', { label: 'here' })
  assert.equal((result.marker as { frame: number }).frame, 42)
})

test('each marker call is exactly one undo step, and undo takes the marker back', () => {
  load()
  const before = past()
  call('add_marker', { frame: 30 })
  assert.equal(past(), before + 1)
  useEditor.getState().undo()
  assert.deepEqual(markers(), [])
})

test('a colour that is not hex is refused with an example, and a hex one is accepted', () => {
  load()
  assert.match(refusal('add_marker', { frame: 1, color: 'orange' }), /hex colour such as "#F5A524"/)
  assert.match(refusal('add_marker', { frame: 1, label: '   ' }), /label is empty/)
  assert.equal(past(), 0, 'a refusal leaves no undo step')
  call('add_marker', { frame: 1, color: '#0af' })
})

test('removing an unknown marker names the ones that exist, and removing a real one works', () => {
  load()
  assert.match(refusal('remove_marker', { markerId: 'mk_nope' }), /has no markers/)

  const added = call('add_marker', { frame: 60, label: 'chapter 2' })
  const id = (added.marker as { id: string }).id
  const message = refusal('remove_marker', { markerId: 'mk_nope' })
  assert.ok(message.includes(id), 'the refusal must name the marker ids that exist')
  assert.match(message, /"chapter 2" at frame 60/)

  call('remove_marker', { markerId: id.slice(0, 12) })
  assert.deepEqual(markers(), [])
})

test('removing the last marker leaves no empty list behind', () => {
  load()
  const id = useEditor.getState().addMarker(10)!
  useEditor.getState().removeMarker(id)
  const timeline = useEditor.getState().project.timelines[0]!
  assert.equal('markers' in timeline, false, 'a project that removed every marker saves as one that had none')
})

test('moveMarker moves one marker and leaves the others, and read_project reports frame order', () => {
  load()
  const a = useEditor.getState().addMarker(10, 'a')!
  useEditor.getState().addMarker(20, 'b')
  useEditor.getState().moveMarker(a, 30)
  // Storage order is not a promise (the model says so); read_project's order is.
  assert.deepEqual(markers().map((m) => [m.label, m.frame]), [['b', 20], ['a', 30]])
})
