/**
 * The renderer's half of autosave: it watches the editor store, tells the scheduler
 * (`@shared/autosave`) when the project changed, hands main the project when the scheduler says
 * so, and asks main about unsaved work whenever a project is opened.
 *
 * Mounted once, by `App`, for the life of the window.
 *
 * **A probe cannot write a sidecar.** `test/app/cdp.mjs`'s `attach()` — which every probe that
 * drives the store goes through — keeps its snapshot of the store at `window.__bayProbeSnapshot`
 * for as long as it is driving and deletes it when it puts the store back. While that is there
 * this file neither writes a sidecar, nor deletes one, nor asks about recovery. The check is made
 * when the timer fires, not when it was set, so an edit the user made a second before a probe
 * attached is not written from inside the probe either. A probe killed before it could restore
 * leaves the snapshot behind and autosave paused until the window reloads; Preferences › Editing
 * says so.
 */

import {
  AUTOSAVE_BURST_SECONDS,
  autosaveSkip,
  createAutosaver,
  type Autosaver,
  type AutosaveTarget,
  type RecoveryOffer
} from '@shared/autosave'
import type { Project } from '@shared/project'
import { useAutosave } from '@/store/autosave-prefs'
import { useEditor } from '@/store/editor'
import { bay } from './bridge'

/** Whether a test probe is driving this window (see the file comment). */
export function probeDriving(): boolean {
  return (globalThis as { __bayProbeSnapshot?: unknown }).__bayProbeSnapshot !== undefined
}

const targetOf = (project: Project): AutosaveTarget => ({ id: project.id, filePath: project.filePath ?? null })
const keyOf = (target: AutosaveTarget): string => `${target.id}\n${target.filePath ?? ''}`

let saver: Autosaver | null = null
/** The project whose sidecar question has been asked, so one opening asks once. */
let askedFor: string | null = null
/** Projects whose sidecar could not be written, so the toast is said once each, not every 3 s. */
const failedFor = new Set<string>()

function failed(error: unknown): void {
  const said = error instanceof Error && error.message ? error.message : String(error)
  useAutosave.getState().noteFailed(said)
  const key = keyOf(targetOf(useEditor.getState().project))
  if (failedFor.has(key)) return
  failedFor.add(key)
  useEditor.getState().notify(`Autosave could not write this project’s recovery file: ${said} Save the project to keep your work.`, 'error')
}

/** Ask main whether the project that just opened left unsaved work behind. */
function ask(project: Project): void {
  const target = targetOf(project)
  const key = keyOf(target)
  if (askedFor === key) return
  askedFor = key
  const prefs = useAutosave.getState()
  const api = bay()
  if (!api || probeDriving()) {
    prefs.setRecovery(null)
    return
  }
  prefs.setRecovery('checking')
  const settle = (offer: RecoveryOffer | null): void => {
    // Only for the project that is still open: another may have been opened while main read.
    if (askedFor === key) useAutosave.getState().setRecovery(offer)
  }
  api.project
    .recovery({ ...target, name: project.name, updatedAt: project.updatedAt })
    .then(settle, () => settle(null))
}

export function startAutosave(): () => void {
  const autosaver = createAutosaver({
    idleMs: () => useAutosave.getState().idleSeconds * 1000,
    burstMs: AUTOSAVE_BURST_SECONDS * 1000,
    now: () => Date.now(),
    setTimer: (run, ms) => setTimeout(run, ms),
    clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    skip: () => {
      const state = useEditor.getState()
      const prefs = useAutosave.getState()
      return autosaveSkip({
        enabled: prefs.enabled,
        probeDriving: probeDriving(),
        editing: state.screen === 'editor' && bay() !== null,
        recoveryPending: prefs.recovery !== null,
        dirty: state.dirty
      })
    },
    write: async () => {
      const api = bay()
      if (!api) return
      await api.project.autosave(useEditor.getState().project)
    },
    onWritten: (at) => useAutosave.getState().noteWritten(at),
    onSkipped: (skip) => useAutosave.getState().noteSkipped(skip),
    onFailed: failed
  })
  saver = autosaver

  const initial = useEditor.getState()
  if (initial.screen === 'editor') ask(initial.project)

  const unsubscribe = useEditor.subscribe((state, prev) => {
    const opened =
      state.screen === 'editor' &&
      (prev.screen !== 'editor' || keyOf(targetOf(state.project)) !== keyOf(targetOf(prev.project)))
    if (state.screen !== 'editor' || state.project.id !== prev.project.id) {
      // Another project, or none: whatever was owed was owed to the one that is gone.
      autosaver.settled()
      if (state.screen !== 'editor') {
        askedFor = null
        useAutosave.getState().setRecovery(null)
      }
    }
    if (opened) ask(state.project)
    if (state.screen !== 'editor') return
    if (state.dirty && state.project !== prev.project) {
      autosaver.edited()
    } else if (!state.dirty && prev.dirty && state.project.id === prev.project.id) {
      // Saved, or undone back to what was saved: nothing is unsaved, so nothing is owed and a
      // sidecar this session wrote would offer work that is no longer different from the file.
      // (After a save main has removed it already; this is the undo case.)
      autosaver.settled()
      if (!probeDriving()) void bay()?.project.discardRecovery(targetOf(state.project)).catch(() => undefined)
    }
  })

  return () => {
    unsubscribe()
    autosaver.dispose()
    if (saver === autosaver) saver = null
  }
}

/**
 * The user chose to leave without saving: that is a decision about this work, and offering it
 * back at the next open would second-guess it. Stops anything owed, then removes the sidecar.
 */
export async function discardUnsavedWork(project: Project): Promise<void> {
  saver?.settled()
  if (probeDriving()) return
  await bay()?.project.discardRecovery(targetOf(project)).catch(() => undefined)
}

/** Restore what an offer holds. Resolves true once the work is in the window. */
export async function restoreOffer(offer: RecoveryOffer): Promise<boolean> {
  const api = bay()
  const editor = useEditor.getState()
  if (!api) return false
  let project: Project
  try {
    project = await api.project.recover(offer.target)
  } catch (error) {
    const said = error instanceof Error && error.message ? error.message : String(error)
    editor.notify(`The unsaved work could not be restored: ${said}`, 'error')
    return false
  }
  // Answered. The sidecar stays on disk until a save, so a second crash can offer it again; it is
  // not offered again now, because what is in the window is no older than it.
  useAutosave.getState().setRecovery(null)
  editor.restoreRecovered(project)
  return true
}

/** Throw away what an offer holds. Resolves true once the sidecar is gone. */
export async function discardOffer(offer: RecoveryOffer): Promise<boolean> {
  const api = bay()
  if (!api) return false
  try {
    await api.project.discardRecovery(offer.target)
  } catch (error) {
    const said = error instanceof Error && error.message ? error.message : String(error)
    useEditor.getState().notify(`The unsaved work could not be discarded: ${said}`, 'error')
    return false
  }
  if (useAutosave.getState().recovery === offer) useAutosave.getState().setRecovery(null)
  return true
}

/** "3 minutes ago", for the sentences in `@shared/autosave`. */
export function ago(then: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - then) / 1000))
  if (seconds < 60) return 'less than a minute ago'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}
