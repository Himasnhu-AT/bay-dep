/**
 * Switching the agent's provider ends the conversation — the session, the log, the pins — with
 * no React mounted at all. It used to be an effect in the agent panel, which is a dock that can
 * be closed: dock closed, provider switched in Preferences, dock reopened, and the old session
 * carried on answering on the old model. This test mounts nothing, which is the point: it is the
 * dock-closed case.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { useEditor } from '@/store/editor'
import { useAgentProvider } from './agentProvider'

let disposed = 0
;(globalThis as { window?: unknown }).window = { bay: { agent: { dispose: async () => void (disposed += 1) } } }

function startConversation(): void {
  const editor = useEditor.getState()
  editor.startAgentSession()
  editor.logUserMessage('cut the intro', [], [])
  editor.addAgentPin({ kind: 'range', fromFrame: 0, toFrame: 30 })
}

test('switching provider with no panel mounted ends the session and clears the conversation', () => {
  const other = useAgentProvider.getState().provider === 'codex' ? 'claude' : 'codex'
  startConversation()
  assert.equal(useEditor.getState().agentSessionActive, true, 'specimen: a session is running')
  assert.ok(useEditor.getState().agentLog.length > 0, 'specimen: the log has an entry')
  const before = disposed

  useAgentProvider.getState().setProvider(other)

  assert.equal(useEditor.getState().agentSessionActive, false)
  assert.equal(useEditor.getState().agentLog.length, 0)
  assert.equal(useEditor.getState().agentPins.length, 0)
  assert.equal(disposed, before + 1, 'the old session is disposed in main')
})

test('setting the provider it already has leaves the conversation alone', () => {
  startConversation()
  const before = disposed
  const logged = useEditor.getState().agentLog.length

  useAgentProvider.getState().setProvider(useAgentProvider.getState().provider)

  assert.equal(useEditor.getState().agentSessionActive, true)
  assert.equal(useEditor.getState().agentLog.length, logged)
  assert.equal(disposed, before)
})
