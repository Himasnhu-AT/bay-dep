/**
 * Settings › Editing, pinned by literal localStorage keys (a later build reads what this one
 * wrote), and the frames each preference turns into. Run with `pnpm test`.
 *
 * Like `settings-keys.test.ts`, each case installs a storage stub and imports a fresh copy of the
 * module, so the read path under test is the one the app runs at launch.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'

type PrefsModule = typeof import('./editing-prefs')

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

async function launch(stub: ReturnType<typeof storage>): Promise<PrefsModule> {
  Object.defineProperty(globalThis, 'localStorage', { value: stub, configurable: true, writable: true })
  generation += 1
  return (await import(`${new URL('./editing-prefs.ts', import.meta.url).href}?launch=${generation}`)) as PrefsModule
}

test('with nothing stored: stills 5 s, transitions 1 s, the timeline follows the playhead', async () => {
  const state = (await launch(storage())).useEditingPrefs.getState()
  assert.equal(state.stillSeconds, 5)
  assert.equal(state.transitionSeconds, 1)
  assert.equal(state.followPlayhead, true)
})

test('stored values are read back under their literal keys', async () => {
  const state = (
    await launch(storage({ 'bay.stillSeconds': '3', 'bay.transitionSeconds': '0.5', 'bay.followPlayhead': '0' }))
  ).useEditingPrefs.getState()
  assert.equal(state.stillSeconds, 3)
  assert.equal(state.transitionSeconds, 0.5)
  assert.equal(state.followPlayhead, false)
})

test('a corrupt or out-of-range stored value falls back or is held to the range, never 0 frames', async () => {
  const state = (await launch(storage({ 'bay.stillSeconds': 'NaN', 'bay.transitionSeconds': '-4' }))).useEditingPrefs.getState()
  assert.equal(state.stillSeconds, 5)
  assert.equal(state.transitionSeconds, 0.1)
})

test('setters write the literal keys; the default is stored as absent', async () => {
  const stub = storage()
  const prefs = await launch(stub)
  const state = prefs.useEditingPrefs.getState()
  state.setStillSeconds(2.5)
  assert.equal(stub.values.get('bay.stillSeconds'), '2.5')
  state.setFollowPlayhead(false)
  assert.equal(stub.values.get('bay.followPlayhead'), '0')
  state.setFollowPlayhead(true)
  assert.equal(stub.values.has('bay.followPlayhead'), false)
  state.setTransitionSeconds(0.5)
  assert.equal(stub.values.get('bay.transitionSeconds'), '0.5')
  state.setStillSeconds(5)
  assert.equal(stub.values.has('bay.stillSeconds'), false)
})

test('the preferences turn into frames at the timeline rate', async () => {
  const prefs = await launch(storage({ 'bay.stillSeconds': '2', 'bay.transitionSeconds': '0.5' }))
  assert.equal(prefs.stillDurationFrames(30), 60)
  assert.equal(prefs.stillDurationFrames(24000 / 1001), 48)
  assert.equal(prefs.transitionLengthFrames(30), 15)
  // A transition needs a frame on each side of the cut.
  assert.equal(prefs.transitionLengthFrames(30, 0.01), 2)
})

test('placing a title runs for the preferred length — the preference reaches the store', async () => {
  // The plain module paths: the ones the store itself imports.
  const { useEditingPrefs } = await import('./editing-prefs')
  const { useEditor, emptyProject } = await import('./editor')
  useEditor.getState().setProject(emptyProject(), { resetHistory: true })
  const fps = useEditor.getState().project.timelines[0]!.fps
  const place = (): number => {
    const id = `ast_title_${Math.random().toString(36).slice(2)}`
    useEditor.getState().addAssets([
      {
        id, kind: 'text', name: 'Title', path: null, durationUs: 0, width: null, height: null, fps: null,
        hasAudio: false, hasVideo: false, posterPath: null, waveformPath: null, text: 'Title', createdAt: 0
      }
    ])
    const itemId = useEditor.getState().placeAsset(id, 0)
    assert.ok(itemId, 'the title was placed')
    const item = useEditor.getState().project.timelines[0]!.tracks.flatMap((track) => track.items).find((i) => i.id === itemId)
    return item!.durationInFrames
  }
  useEditingPrefs.getState().setStillSeconds(2)
  assert.equal(place(), 2 * fps)
  // And moves with it: the positive control that 2 s was not a coincidence of the default.
  useEditingPrefs.getState().setStillSeconds(7)
  assert.equal(place(), 7 * fps)
})

test('New clips framing: read back under its literal key, a corrupt value falls back to Auto, the default is stored as absent', async () => {
  assert.equal((await launch(storage())).useEditingPrefs.getState().newClipFit, 'auto')
  assert.equal((await launch(storage({ 'bay.newClipFit': 'contain' }))).useEditingPrefs.getState().newClipFit, 'contain')
  assert.equal((await launch(storage({ 'bay.newClipFit': 'stretch' }))).useEditingPrefs.getState().newClipFit, 'auto')
  const stub = storage()
  const state = (await launch(stub)).useEditingPrefs.getState()
  state.setNewClipFit('cover')
  assert.equal(stub.values.get('bay.newClipFit'), 'cover')
  state.setNewClipFit('auto')
  assert.equal(stub.values.has('bay.newClipFit'), false)
})
