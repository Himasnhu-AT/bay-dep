/**
 * A person's Apply runs the tool's implementation, not the agent's entry point.
 *
 * Each case pairs the user path with the agent path on the same state: `executeToolCall` must
 * still be refused under "Ask before editing" and still be the agent's edit, or the user path
 * passing would prove nothing about the difference.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { emptyProject, useEditor, asAgent } from '@/store/editor'
import { brfRuntime, type BrfWorkerReply, type BrfWorkerRequest, type WorkerLike } from '@/engine/brfCode'
import { createHandler } from '@/engine/brfWorkerCore'
import { executeToolCall } from '@/mcp'
import { writeBrf } from '@/mcp/brf'
import { runUserTool } from './userTool'

brfRuntime.useWorkers((): WorkerLike => {
  const handle = createHandler()
  const worker: WorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage(message) {
      queueMicrotask(() => worker.onmessage?.({ data: handle(message as BrfWorkerRequest) } as MessageEvent<BrfWorkerReply>))
    },
    terminate() {}
  }
  return worker
})

const state = () => useEditor.getState()
const CODE = 'export default () => <scene duration={1}><rect x={0} y={0} w={10} h={10} fill="#fff" /></scene>'

function fresh(): void {
  state().enterProject({ ...emptyProject(), name: 'User tool' })
  state().clearAgentLog()
}

test('with "Ask before editing" on, the agent is refused and the person’s Apply still applies', async () => {
  fresh()
  useEditor.setState({ agentGate: { approved: null } })
  try {
    const agent = await executeToolCall({ id: 'a', tool: 'write_brf', args: { code: CODE, name: 'Agent' } })
    assert.equal(agent.ok, false, 'specimen: the agent entry point is gated')
    assert.equal(state().project.assets.length, 0)

    const user = await runUserTool('write_brf', writeBrf, { code: CODE, name: 'Mine' })
    assert.equal(user.ok, true, user.ok ? '' : user.error)
    assert.deepEqual(state().project.assets.map((a) => a.name), ['Mine'])
  } finally {
    useEditor.setState({ agentGate: null })
  }
})

type Changes = Extract<ReturnType<typeof state>['agentLog'][number], { kind: 'changes' }>
const lastCard = (): Changes | undefined =>
  state().agentLog.filter((e): e is Changes => e.kind === 'changes').at(-1)

test('an Apply during an agent turn is marked as the person’s edit on the Changes card', async () => {
  fresh()
  state().applyAgentEvent({ type: 'started', runId: 'r1' })
  await asAgent(() => state().addTrack('video'))
  await executeToolCall({ id: 'b', tool: 'write_brf', args: { code: CODE } })
  state().applyAgentEvent({ type: 'done', runId: 'r1', reason: 'complete' })
  assert.equal(lastCard()?.note, undefined, 'specimen: through the agent entry point it reads as the agent’s')

  fresh()
  state().applyAgentEvent({ type: 'started', runId: 'r2' })
  await asAgent(() => state().addTrack('video'))
  const user = await runUserTool('write_brf', writeBrf, { code: CODE })
  assert.equal(user.ok, true)
  state().applyAgentEvent({ type: 'done', runId: 'r2', reason: 'complete' })
  assert.match(lastCard()?.note ?? '', /edits you made while the agent was working/)
})

test('arguments are still validated against the catalog, and a refusal comes back as a message', async () => {
  fresh()
  const bad = await runUserTool('write_brf', writeBrf, { code: 42 })
  assert.equal(bad.ok, false)
  const broken = await runUserTool('write_brf', writeBrf, { code: 'export default () => <scene duration={1}' })
  assert.equal(broken.ok, false)
  assert.match(broken.ok ? '' : broken.error, /Nothing was changed/)
})

test('an MCP client on bay’s socket is not held to the agent’s approvals, and its edit is its own', async () => {
  fresh()
  useEditor.setState({ agentGate: { approved: null } })
  state().applyAgentEvent({ type: 'started', runId: 'client-run' })
  try {
    // The pair: the same call, from the in-app agent, is refused by the turn's gate.
    const agent = await executeToolCall({ id: 'a', tool: 'add_track', args: { kind: 'video' }, origin: 'in-app' })
    assert.equal(agent.ok, false, 'specimen: the in-app agent is gated')
    const client = await executeToolCall({ id: 'c', tool: 'add_track', args: { kind: 'video' }, origin: 'socket' })
    assert.equal(client.ok, true, client.ok ? '' : client.error)
    assert.equal(state().agentTurnClientEdited, true, 'marked as the client’s edit')
    assert.equal(state().agentTurnUserEdited, false)
  } finally {
    state().applyAgentEvent({ type: 'done', runId: 'client-run', reason: 'complete' })
    useEditor.setState({ agentGate: null })
  }
})
