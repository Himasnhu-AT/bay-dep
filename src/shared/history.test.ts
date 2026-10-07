import { test } from 'node:test'
import assert from 'node:assert/strict'
import { actorLabel, describeStep, historyView, planJump, UNNAMED_STEP, type StepNote } from './history'
import type { Project } from './project'

const state = (name: string): Project =>
  ({ id: 'prj', name, version: 1, assets: [], timelines: [], activeTimelineId: '', createdAt: 0, updatedAt: 0 }) as Project

test('the history is one chain: past, the project, then future — a step between each two neighbours', () => {
  const [a, b, c, d] = [state('A'), state('B'), state('C'), state('D')]
  const view = historyView([a, b], c, [d], () => undefined)
  assert.equal(view.position, 2)
  assert.deepEqual(view.steps, [
    { position: 1, label: 'Renamed the project to “B”', actor: 'user', applied: true },
    { position: 2, label: 'Renamed the project to “C”', actor: 'user', applied: true },
    { position: 3, label: 'Renamed the project to “D”', actor: 'user', applied: false }
  ])
})

test('a step that named itself keeps its name and its maker; the rest are described from what changed', () => {
  const [a, b, c] = [state('A'), state('B'), state('C')]
  const notes = new Map<Project, StepNote>([[a, { actor: 'agent', label: 'Move track V1 to V3' }], [b, { actor: 'client' }]])
  const view = historyView([a, b], c, [], (before) => notes.get(before))
  assert.deepEqual(view.steps.map((step) => [step.label, step.actor]), [
    ['Move track V1 to V3', 'agent'],
    ['Renamed the project to “C”', 'client']
  ])
})

test('notes follow the snapshot they were made for through undo and redo', () => {
  const [a, b, c] = [state('A'), state('B'), state('C')]
  const notes = new Map<Project, StepNote>([[a, { actor: 'agent', label: 'First' }], [b, { actor: 'user', label: 'Second' }]])
  const noteOf = (before: Project): StepNote | undefined => notes.get(before)
  const done = historyView([a, b], c, [], noteOf)
  const undone = historyView([a], b, [c], noteOf)
  const all = historyView([], a, [b, c], noteOf)
  for (const view of [done, undone, all]) assert.deepEqual(view.steps.map((step) => step.label), ['First', 'Second'])
  assert.deepEqual([done.position, undone.position, all.position], [2, 1, 0])
  assert.deepEqual(undone.steps.map((step) => step.applied), [true, false])
})

test('no history is no steps, at position 0', () => {
  assert.deepEqual(historyView([], state('A'), [], () => undefined), { position: 0, steps: [] })
})

test('a step is described in a line: what changed, and how much more', () => {
  assert.equal(describeStep(state('A'), state('B')), 'Renamed the project to “B”')
  const more = { ...state('B'), assets: [{ id: 'x', kind: 'video', name: 'clip.mp4' }] } as unknown as Project
  assert.equal(describeStep(state('A'), more), 'Renamed the project to “B”, and 1 more')
  // Two states nothing describable differs between still get a name.
  assert.equal(describeStep(state('A'), { ...state('A'), updatedAt: 5 }), UNNAMED_STEP)
})

test('only a step somebody else made is tagged', () => {
  assert.deepEqual([actorLabel('user'), actorLabel('agent'), actorLabel('client')], [null, 'Agent', 'MCP client'])
})

test('a jump is so many undos or so many redos, never both', () => {
  assert.deepEqual(planJump(5, 8, 2), { undo: 3, redo: 0 })
  assert.deepEqual(planJump(5, 8, 8), { undo: 0, redo: 3 })
  assert.deepEqual(planJump(5, 8, 5), { undo: 0, redo: 0 })
  assert.deepEqual(planJump(5, 8, 0), { undo: 5, redo: 0 })
})

test('a position outside the history is refused with the range there is, not clamped to it', () => {
  for (const position of [-1, 9, 2.5, Number.NaN]) {
    const plan = planJump(5, 8, position)
    assert.ok('error' in plan, `position ${position}`)
    assert.match(plan.error, /the history runs from 0 \(before the first change\) to 8, and the project is at 5/)
  }
  const empty = planJump(0, 0, 1)
  assert.ok('error' in empty)
  assert.match(empty.error, /There is no history yet/)
})
