/**
 * Autosave as the window runs it: the real editor store, the real scheduler, main stubbed on
 * `window.bay`, and the clock moved by hand.
 *
 * The case that matters most is the probe one. CLAUDE.md: "Undo what a probe did, and do not
 * save" — a probe drives the store of a project opened from a fixture, and a sidecar written
 * from that would sit beside the fixture and be offered to the next person as unsaved work.
 */

import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import type { RecoveryOffer } from '@shared/autosave'
import type { Project } from '@shared/project'

const calls: { autosave: Project[]; discard: unknown[]; recovery: unknown[]; recover: unknown[] } = {
  autosave: [],
  discard: [],
  recovery: [],
  recover: []
}
let offerOnOpen: RecoveryOffer | null = null
let recovered: Project | null = null

;(globalThis as { window?: unknown }).window = {
  bay: {
    project: {
      autosave: async (project: Project) => void calls.autosave.push(project),
      discardRecovery: async (target: unknown) => void calls.discard.push(target),
      recovery: async (opened: unknown) => {
        calls.recovery.push(opened)
        return offerOnOpen
      },
      recover: async (target: unknown) => {
        calls.recover.push(target)
        if (!recovered) throw new Error('nothing to recover')
        return recovered
      }
    }
  }
}

const { useEditor } = await import('@/store/editor')
const { useAutosave } = await import('@/store/autosave-prefs')
const { discardUnsavedWork, probeDriving, restoreOffer, startAutosave } = await import('./autosave')

const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve))
}

/** A saved project open in the editor, autosave running, the clock under the test's hand. */
async function open(t: TestContext, name: string): Promise<{ project: Project; tick(ms: number): Promise<void> }> {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] })
  calls.autosave.length = calls.discard.length = calls.recovery.length = calls.recover.length = 0
  useEditor.getState().showHome()
  useAutosave.setState({ enabled: true, idleSeconds: 3, recovery: null, lastSkip: null, lastWrittenAt: null })
  const stop = startAutosave()
  t.after(() => {
    stop()
    delete (globalThis as { __bayProbeSnapshot?: unknown }).__bayProbeSnapshot
  })
  const base = useEditor.getState().project
  const project: Project = { ...base, id: `prj_${name}`, name, filePath: `/work/${name}.bay`, updatedAt: 1000 }
  useEditor.getState().enterProject(project)
  await settle()
  return {
    project,
    tick: async (ms) => {
      t.mock.timers.tick(ms)
      await settle()
    }
  }
}

test('an edit is written to the sidecar after the idle delay, as the project then stands', async (t) => {
  const { tick } = await open(t, 'idle')
  useEditor.getState().renameProject('First')
  useEditor.getState().renameProject('Second')
  await tick(2999)
  assert.equal(calls.autosave.length, 0)
  await tick(1)
  assert.deepEqual(calls.autosave.map((project) => project.name), ['Second'])
  assert.notEqual(useAutosave.getState().lastWrittenAt, null)
})

test('while a probe holds its snapshot nothing is written and nothing is deleted', async (t) => {
  const { tick } = await open(t, 'probe')
  assert.equal(probeDriving(), false)
  const snapshot = useEditor.getState()
  ;(globalThis as { __bayProbeSnapshot?: unknown }).__bayProbeSnapshot = { state: snapshot }
  assert.equal(probeDriving(), true)
  // What a probe does: edits, then puts the store back, then drops the snapshot.
  useEditor.getState().renameProject('What the probe did')
  await tick(60_000)
  useEditor.setState({ project: snapshot.project, past: snapshot.past, future: snapshot.future, dirty: snapshot.dirty })
  await tick(60_000)
  assert.equal(calls.autosave.length, 0, 'a probe’s edit must never reach a sidecar')
  assert.equal(calls.discard.length, 0, 'and its restore must not delete one the user had')
  assert.equal(useAutosave.getState().lastSkip, 'probe')
  delete (globalThis as { __bayProbeSnapshot?: unknown }).__bayProbeSnapshot
  // The pair: the same edit by the user, with no probe attached, is written.
  useEditor.getState().renameProject('What the user did')
  await tick(3000)
  assert.deepEqual(calls.autosave.map((project) => project.name), ['What the user did'])
})

test('a probe attached when a project opens is not asked about recovery either', async (t) => {
  await open(t, 'first')
  ;(globalThis as { __bayProbeSnapshot?: unknown }).__bayProbeSnapshot = {}
  const asked = calls.recovery.length
  const base = useEditor.getState().project
  useEditor.getState().setProject({ ...base, id: 'prj_fixture', filePath: '/fixtures/a.bay' })
  await settle()
  assert.equal(calls.recovery.length, asked)
  assert.equal(useAutosave.getState().recovery, null)
})

test('turned off, nothing is written', async (t) => {
  const { tick } = await open(t, 'off')
  useAutosave.getState().setEnabled(false)
  t.after(() => useAutosave.getState().setEnabled(true))
  useEditor.getState().renameProject('Unprotected')
  await tick(60_000)
  assert.equal(calls.autosave.length, 0)
  assert.equal(useAutosave.getState().lastSkip, 'off')
})

test('opening a project asks main about its sidecar, with the stamp the file was saved at', async (t) => {
  const { project } = await open(t, 'asks')
  assert.deepEqual(calls.recovery, [{ id: project.id, filePath: project.filePath, name: 'asks', updatedAt: 1000 }])
  assert.equal(useAutosave.getState().recovery, null)
})

test('an unanswered offer holds autosave back: the sidecar is the only copy of what is on offer', async (t) => {
  offerOnOpen = { state: 'newer', target: { id: 'prj_offer', filePath: '/work/offer.bay' }, name: 'offer', autosavedAt: 2000, savedAt: 1000 }
  t.after(() => {
    offerOnOpen = null
  })
  const { tick } = await open(t, 'offer')
  assert.equal(useAutosave.getState().recovery, offerOnOpen)
  useEditor.getState().renameProject('Edited over the offer')
  await tick(60_000)
  assert.equal(calls.autosave.length, 0)
  assert.equal(useAutosave.getState().lastSkip, 'recovery-pending')
})

test('Restore puts the work in the window as one undo step over the saved project, unsaved', async (t) => {
  const { project } = await open(t, 'restore')
  const offer: RecoveryOffer = { state: 'newer', target: { id: project.id, filePath: project.filePath! }, name: 'restore', autosavedAt: 2000, savedAt: 1000 }
  useAutosave.getState().setRecovery(offer)
  recovered = { ...project, name: 'Work from before the crash', updatedAt: 2000 }
  const askedBefore = calls.recovery.length
  assert.equal(await restoreOffer(offer), true)
  await settle()
  const state = useEditor.getState()
  assert.equal(state.project.name, 'Work from before the crash')
  assert.equal(state.project.filePath, project.filePath)
  assert.equal(state.dirty, true)
  assert.equal(state.past.length, 1)
  assert.equal(useAutosave.getState().recovery, null)
  assert.equal(calls.recovery.length, askedBefore, 'the project it was restored into is not asked again')
  assert.equal(calls.discard.length, 0, 'the sidecar stays until the work is saved')
  state.undo()
  assert.equal(useEditor.getState().project.name, 'restore')
  assert.equal(useEditor.getState().dirty, false)
})

test('a project never saved restores as itself: no file, and unsaved', async (t) => {
  await open(t, 'home')
  useEditor.getState().showHome()
  const base = useEditor.getState().project
  recovered = { ...base, id: 'prj_never', name: 'Untitled', filePath: null, updatedAt: 2000 }
  const offer: RecoveryOffer = { state: 'newer', target: { id: 'prj_never', filePath: null }, name: 'Untitled', autosavedAt: 2000, savedAt: null }
  assert.equal(await restoreOffer(offer), true)
  const state = useEditor.getState()
  assert.equal(state.screen, 'editor')
  assert.equal(state.project.id, 'prj_never')
  assert.equal(state.project.filePath, null)
  assert.equal(state.dirty, true)
})

test('undoing back to the saved project removes the sidecar this session wrote', async (t) => {
  const { project, tick } = await open(t, 'undone')
  useEditor.getState().renameProject('A change')
  await tick(3000)
  assert.equal(calls.autosave.length, 1)
  useEditor.getState().undo()
  await settle()
  assert.equal(useEditor.getState().dirty, false)
  assert.deepEqual(calls.discard, [{ id: project.id, filePath: project.filePath }])
})

test('leaving with Don’t save cancels what was owed and removes the sidecar', async (t) => {
  const { project, tick } = await open(t, 'leave')
  useEditor.getState().renameProject('Thrown away')
  await tick(1000)
  await discardUnsavedWork(useEditor.getState().project)
  await tick(60_000)
  assert.equal(calls.autosave.length, 0)
  assert.deepEqual(calls.discard, [{ id: project.id, filePath: project.filePath }])
})
