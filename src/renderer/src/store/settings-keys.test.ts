/**
 * The per-machine preferences bay keeps in localStorage, pinned by their literal keys and
 * encodings. Run with `pnpm test`.
 *
 * These are read back by a build that is not the build that wrote them — every upgrade — so they
 * are a compatibility surface in the sense of CLAUDE.md: rename `bay.autoDownloadModels` and
 * every existing user silently gets the default back. So the keys and values below are spelled
 * out as literals, never imported from the store, and nothing here would move with a rename.
 *
 * The store reads these once, when its module is evaluated, so each case installs a storage
 * stub on `globalThis` and then imports a *fresh* copy of `editor.ts` (a cache-busting query on
 * the URL makes Node evaluate it again). That tests the read path the app actually runs at
 * launch, not a helper that might disagree with it.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

type EditorModule = typeof import('./editor')

/** A Storage stand-in over a plain object, recording every write. */
function storage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial))
  return {
    values,
    getItem: (key: string): string | null => values.get(key) ?? null,
    setItem: (key: string, value: string): void => void values.set(key, String(value)),
    removeItem: (key: string): void => void values.delete(key)
  }
}

function install(stub: unknown): void {
  // Node 26 defines `localStorage` as an accessor that warns and yields undefined without a
  // backing file; replace it outright.
  Object.defineProperty(globalThis, 'localStorage', { value: stub, configurable: true, writable: true })
}

let generation = 0

/** The store as a fresh launch would build it, over `stub`. */
async function launch(stub: unknown): Promise<EditorModule> {
  install(stub)
  generation += 1
  const url = `${new URL('./editor.ts', import.meta.url).href}?launch=${generation}`
  return (await import(url)) as EditorModule
}

const initial = async (values: Record<string, string>) =>
  (await launch(storage(values))).useEditor.getState()

test('with nothing stored: approval off, model downloads off, model automatic, debug off', async () => {
  const state = await initial({})
  assert.equal(state.agentApproval, false)
  assert.equal(state.autoDownloadModels, false, 'absent means ask first — a download is opt-in')
  assert.equal(state.whisperModel, null, 'absent means choose automatically')
  assert.equal(state.debugMode, false)
})

test('the fresh import really re-reads storage (the instrument for every test below)', async () => {
  // Were the module cached, this would still see the previous launch's storage.
  const off = await initial({ 'bay.debugMode': '0' })
  const on = await initial({ 'bay.debugMode': '1' })
  assert.equal(off.debugMode, false)
  assert.equal(on.debugMode, true)
})

test("'bay.agentApproval' is '1' for on and anything else for off", async () => {
  assert.equal((await initial({ 'bay.agentApproval': '1' })).agentApproval, true)
  assert.equal((await initial({ 'bay.agentApproval': '0' })).agentApproval, false)
})

test("'bay.autoDownloadModels' is on only for '1'", async () => {
  assert.equal((await initial({ 'bay.autoDownloadModels': '0' })).autoDownloadModels, false)
  assert.equal((await initial({ 'bay.autoDownloadModels': '1' })).autoDownloadModels, true)
  // A user who turned it on keeps it on after the default changed; anything else asks first.
  assert.equal((await initial({ 'bay.autoDownloadModels': 'true' })).autoDownloadModels, false)
})

test("'bay.whisperModel' holds the chosen model's file name", async () => {
  const state = await initial({ 'bay.whisperModel': 'ggml-small.en.bin' })
  assert.equal(state.whisperModel, 'ggml-small.en.bin')
})

test("'bay.debugMode' is '1' for on", async () => {
  assert.equal((await initial({ 'bay.debugMode': '1' })).debugMode, true)
})

test('storage that throws on every access leaves the defaults, not a dead store', async () => {
  const hostile = {
    getItem: () => {
      throw new Error('SecurityError')
    },
    setItem: () => {
      throw new Error('SecurityError')
    },
    removeItem: () => {
      throw new Error('SecurityError')
    }
  }
  const { useEditor } = await launch(hostile)
  const state = useEditor.getState()
  assert.equal(state.agentApproval, false)
  assert.equal(state.autoDownloadModels, false)
  assert.equal(state.whisperModel, null)
  assert.equal(state.debugMode, false)
  // And a setting still applies for the session when it cannot be remembered.
  state.setAutoDownloadModels(true)
  assert.equal(useEditor.getState().autoDownloadModels, true)
})

test('the setters write the same keys and encodings a later launch reads', async () => {
  const stub = storage()
  const { useEditor } = await launch(stub)
  const state = useEditor.getState()

  state.setAgentApproval(true)
  assert.equal(stub.values.get('bay.agentApproval'), '1')
  state.setAgentApproval(false)
  assert.equal(stub.values.get('bay.agentApproval'), '0')

  state.setAutoDownloadModels(false)
  assert.equal(stub.values.get('bay.autoDownloadModels'), '0')
  state.setAutoDownloadModels(true)
  assert.equal(stub.values.get('bay.autoDownloadModels'), '1')

  state.setWhisperModel('ggml-medium.bin')
  assert.equal(stub.values.get('bay.whisperModel'), 'ggml-medium.bin')
  state.setWhisperModel(null)
  assert.equal(stub.values.has('bay.whisperModel'), false, 'automatic is stored as absent')

  const debugBefore = useEditor.getState().debugMode
  state.toggleDebugMode()
  assert.equal(stub.values.get('bay.debugMode'), debugBefore ? '0' : '1')

  // Nothing else was written: a stray key would be a second name for one of these settings.
  assert.deepEqual(
    [...stub.values.keys()].sort(),
    ['bay.agentApproval', 'bay.autoDownloadModels', 'bay.debugMode']
  )
})
