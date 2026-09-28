/**
 * The agent panel exists once for the window and moves between the Resolve dock and the AI
 * layout, like the viewer. Its draft, pending attachments and in-flight send guard are component
 * state: a second `<AgentPanel>` per layout meant a mode switch (or undocking) remounted it,
 * dropping the draft, re-arming a send already in flight, and delivering a refused attachment's
 * message to an unmounted panel. Run with `pnpm test`.
 *
 * There is no DOM in this suite, so this reads the workspace's source: the one place an
 * `<AgentPanel>` may be written is inside `<Hosted name="agent">`, and both layouts place it with
 * `<Slot name="agent" />`. Proven against a25b346, which rendered one per layout.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'

const dir = new URL('./', import.meta.url)
const sources = readdirSync(dir)
  .filter((name) => name.endsWith('.tsx'))
  .map((name) => ({ name, text: readFileSync(new URL(name, dir), 'utf8') }))

const rendered = (text: string): number => (text.match(/<AgentPanel[\s/>]/g) ?? []).length

test('the workspace renders exactly one AgentPanel, inside <Hosted name="agent">', () => {
  const total = sources.reduce((sum, file) => sum + rendered(file.text), 0)
  assert.equal(total, 1, `AgentPanel is rendered in: ${sources.filter((f) => rendered(f.text) > 0).map((f) => f.name).join(', ')}`)
  const workspace = sources.find((file) => file.name === 'Workspace.tsx')?.text ?? ''
  const hosted = workspace.match(/<Hosted name="agent">([\s\S]*?)<\/Hosted>/)
  assert.ok(hosted, 'Workspace.tsx hosts the agent panel')
  assert.equal(rendered(hosted[1] ?? ''), 1, 'the one AgentPanel is the hosted one')
})

test('both layouts place the hosted panel rather than rendering their own', () => {
  const slot = /<Slot name="agent" \/>/
  const workspace = sources.find((file) => file.name === 'Workspace.tsx')?.text ?? ''
  const ai = sources.find((file) => file.name === 'AiLayout.tsx')?.text ?? ''
  assert.match(workspace, slot, 'the Resolve dock')
  assert.match(ai, slot, 'the AI layout')
  const host = sources.find((file) => file.name === 'hosted.tsx')?.text ?? ''
  assert.match(host, /export type HostedName = [^\n]*'agent'/)
})
