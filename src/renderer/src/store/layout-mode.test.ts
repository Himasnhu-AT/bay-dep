/**
 * The layout mode: its persisted key, the default, the AI drawers and the commands that open
 * them. Run with `pnpm test`.
 *
 * `bay.workspace.layoutMode` is read back by later builds, so the key and its values are spelled
 * as literals here and never imported (CLAUDE.md, "A test cannot hold still anything it defines
 * jointly with the code"). Each launch installs a storage stub and evaluates a fresh `editor.ts`,
 * so the read under test is the one the app runs at startup.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { workspaceHandlers } from '../lib/commands/workspace'
import type { CommandContext } from '../lib/commands/types'

type EditorModule = typeof import('./editor')

function storage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    values,
    getItem: (key: string): string | null => values.get(key) ?? null,
    setItem: (key: string, value: string): void => void values.set(key, String(value)),
    removeItem: (key: string): void => void values.delete(key)
  }
}

let generation = 0

async function launch(stub: unknown): Promise<EditorModule> {
  Object.defineProperty(globalThis, 'localStorage', { value: stub, configurable: true, writable: true })
  generation += 1
  return (await import(`${new URL('./editor.ts', import.meta.url).href}?layout=${generation}`)) as EditorModule
}

test('nothing stored: Resolve, with every AI drawer closed', async () => {
  const state = (await launch(storage())).useEditor.getState()
  assert.equal(state.layoutMode, 'resolve')
  assert.deepEqual(state.aiPanels, { timeline: false, inspector: false, pages: false })
})

test("a stored 'ai' is read back under the literal key; so is 'resolve'", async () => {
  assert.equal((await launch(storage({ 'bay.workspace.layoutMode': 'ai' }))).useEditor.getState().layoutMode, 'ai')
  assert.equal((await launch(storage({ 'bay.workspace.layoutMode': 'resolve' }))).useEditor.getState().layoutMode, 'resolve')
})

test('a garbage stored value is Resolve, never a third mode', async () => {
  for (const garbage of ['AI', ' ai', 'ai ', '1', '', 'null', '{"mode":"ai"}', 'edit']) {
    const mode = (await launch(storage({ 'bay.workspace.layoutMode': garbage }))).useEditor.getState().layoutMode
    assert.equal(mode, 'resolve', `stored ${JSON.stringify(garbage)}`)
  }
})

test('storage that throws is Resolve, and switching still works for the session', async () => {
  const hostile = {
    getItem: () => {
      throw new Error('denied')
    },
    setItem: () => {
      throw new Error('denied')
    },
    removeItem: () => undefined
  }
  const { useEditor } = await launch(hostile)
  assert.equal(useEditor.getState().layoutMode, 'resolve')
  useEditor.getState().setLayoutMode('ai')
  assert.equal(useEditor.getState().layoutMode, 'ai')
})

test('switching writes the literal key and value, and a later launch reads it', async () => {
  const stub = storage()
  const { useEditor } = await launch(stub)
  useEditor.getState().toggleLayoutMode()
  assert.equal(stub.values.get('bay.workspace.layoutMode'), 'ai')
  assert.equal((await launch(stub)).useEditor.getState().layoutMode, 'ai')
  useEditor.getState().setLayoutMode('resolve')
  assert.equal(stub.values.get('bay.workspace.layoutMode'), 'resolve')
})

test('the Inspector and Pages drawers share one side: opening one closes the other', async () => {
  const { useEditor } = await launch(storage())
  const s = () => useEditor.getState()
  s().setLayoutMode('ai')
  s().setAiPanel('timeline', true)
  s().setAiPanel('inspector', true)
  assert.deepEqual(s().aiPanels, { timeline: true, inspector: true, pages: false })
  s().toggleAiPanel('pages')
  assert.deepEqual(s().aiPanels, { timeline: true, inspector: false, pages: true }, 'pages replaced the inspector')
  // Positive control: closing one leaves the timeline alone.
  s().setAiPanel('pages', false)
  assert.deepEqual(s().aiPanels, { timeline: true, inspector: false, pages: false })
  s().closeAiPanels()
  assert.deepEqual(s().aiPanels, { timeline: false, inspector: false, pages: false })
})

test('changing mode starts with the drawers closed; re-choosing the same mode keeps them', async () => {
  const { useEditor } = await launch(storage())
  const s = () => useEditor.getState()
  s().setLayoutMode('ai')
  s().setAiPanel('timeline', true)
  s().setLayoutMode('ai')
  assert.equal(s().aiPanels.timeline, true, 'same mode: nothing changed')
  s().setLayoutMode('resolve')
  s().setLayoutMode('ai')
  assert.equal(s().aiPanels.timeline, false)
})

test("in the AI layout, setPanel for a page's panel opens the Pages drawer; the agent and media do not", async () => {
  const { useEditor } = await launch(storage())
  const s = () => useEditor.getState()
  s().setLayoutMode('ai')
  s().setPanel('agent')
  s().setPanel('media')
  assert.equal(s().aiPanels.pages, false, 'both are on screen already')
  s().setPanel('transcript')
  assert.equal(s().aiPanels.pages, true)
  assert.equal(s().page, 'edit')
  assert.equal(s().libraryTab, 'transcript')
  // In Resolve mode the same call never touches the AI drawers.
  s().setLayoutMode('resolve')
  s().setPanel('export')
  assert.deepEqual(s().aiPanels, { timeline: false, inspector: false, pages: false })
  assert.equal(s().page, 'deliver')
})

test('the Timeline and Inspector commands open AI drawers in AI mode and toggle regions in Resolve', async () => {
  const { useEditor } = await launch(storage())
  const s = () => useEditor.getState()
  const run = (id: keyof typeof workspaceHandlers): boolean => {
    const ctx = { state: s(), host: null, typing: false, source: 'key' } as CommandContext
    const handler = workspaceHandlers[id]
    if ('when' in handler && handler.when && !handler.when(ctx)) return false
    handler.run(ctx)
    return true
  }
  s().enterProject(s().project)
  s().setLayoutMode('ai')
  const regionsBefore = { ...s().hiddenRegions }
  assert.equal(run('workspace.toggleTimeline'), true)
  assert.equal(s().aiPanels.timeline, true)
  assert.deepEqual(s().hiddenRegions, regionsBefore, "AI mode leaves Resolve's regions alone")
  assert.equal(run('workspace.toggleInspector'), true)
  assert.equal(s().aiPanels.inspector, true)
  assert.equal(run('workspace.toggleLibrary'), false, 'the media pool is always shown in AI mode')
  assert.equal(run('workspace.color'), true)
  assert.equal(s().page, 'color')
  assert.equal(s().aiPanels.pages, true, 'a page opens in the Pages drawer')

  assert.equal(run('workspace.toggleLayoutMode'), true)
  assert.equal(s().layoutMode, 'resolve')
  const hidden = s().hiddenRegions.timeline
  assert.equal(run('workspace.toggleTimeline'), true)
  assert.equal(s().hiddenRegions.timeline, !hidden)
  assert.equal(s().aiPanels.timeline, false)
  assert.equal(run('workspace.toggleLibrary'), true)
})
