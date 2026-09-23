/**
 * Agent turns as commits: a diff when a turn changes the project, and an exact revert.
 * Run with `pnpm test`.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { useEditor, emptyProject } from './editor'

const state = () => useEditor.getState()

function fresh(): void {
  state().enterProject({ ...emptyProject(), name: 'Cut' })
  state().clearAgentLog()
}

const turn = (runId: string, work: () => void): void => {
  state().applyAgentEvent({ type: 'started', runId })
  work()
  state().applyAgentEvent({ type: 'done', runId, reason: 'complete' })
}

const changes = () => state().agentLog.filter((e) => e.kind === 'changes')

test('a turn that edits leaves one diff entry; a turn that only reads leaves none', () => {
  fresh()
  turn('r1', () => {}) // reads nothing, changes nothing
  assert.equal(changes().length, 0)
  turn('r2', () => state().addTrack('video'))
  const [entry] = changes()
  assert.ok(entry && entry.kind === 'changes')
  assert.equal(entry.state, 'applied')
  assert.match(entry.lines.map((l) => l.text).join('\n'), /Added track V2/)
})

test('revert restores exactly the state before the turn, and ⌘Z brings the change back', () => {
  fresh()
  const before = state().project
  turn('r1', () => {
    state().addTrack('video')
    state().renameProject('Renamed by the agent')
  })
  const after = state().project
  const [entry] = changes()
  state().revertAgentChange(entry!.id)
  assert.equal(state().project, before, 'the before-state itself, not a copy that merely looks alike')
  assert.equal(changes()[0]!.kind === 'changes' && changes()[0]!.state, 'reverted')
  state().undo()
  assert.equal(state().project, after, 'undoing the revert restores the agent’s change')
})

test('reverting an earlier turn marks the later ones reverted too', () => {
  fresh()
  turn('r1', () => state().addTrack('video'))
  turn('r2', () => state().addTrack('audio'))
  const [first, second] = changes()
  state().revertAgentChange(first!.id)
  assert.deepEqual(
    [first, second].map((entry) => (state().agentLog.find((e) => e.id === entry!.id) as { state: string }).state),
    ['reverted', 'reverted']
  )
  // Positive control: reverting only the later turn leaves the earlier one applied.
  fresh()
  turn('r1', () => state().addTrack('video'))
  turn('r2', () => state().addTrack('audio'))
  const [a, b] = changes()
  state().revertAgentChange(b!.id)
  assert.deepEqual(
    [a, b].map((entry) => (state().agentLog.find((e) => e.id === entry!.id) as { state: string }).state),
    ['applied', 'reverted']
  )
})

test('with approval off, a session is not gated; turning it on gates the running session', () => {
  fresh()
  state().setAgentApproval(false)
  state().startAgentSession()
  assert.equal(state().agentSessionActive, true)
  assert.equal(state().agentGate, null, 'the agent edits directly')
  state().setAgentApproval(true)
  assert.deepEqual(state().agentGate, { approved: null }, 'writes now wait for a proposal')
  state().setAgentApproval(false)
  assert.equal(state().agentGate, null)
  state().endAgentSession()
})
