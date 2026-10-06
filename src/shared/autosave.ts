/**
 * Autosave and crash recovery: the contract, the sentences and the scheduler.
 *
 * A dirty project is written to a *sidecar* — `<file>.bay.autosave` beside a saved project, or
 * `<userData>/autosave/<id>.bay.autosave` for one never saved — and never to the project file.
 * A crash, a force-quit or a lost power cord then costs at most the last few seconds: the next
 * time that project is opened, bay offers what the sidecar holds.
 *
 * The sentences come first (CLAUDE.md, "Write the sentence before the type"). Every state a
 * sidecar can be in when a project is opened, and the line a person reads for it:
 *
 *   no sidecar          nothing is shown.
 *   older sidecar       nothing is shown. The saved project is the later work; the sidecar is left
 *                       where it is and the next save removes it.
 *   newer sidecar       “Film” has unsaved work from 3 minutes ago, later than the project you
 *                       saved 2 hours ago. Restore it, or discard it and keep the saved project.
 *                       [Restore] [Discard]
 *   sidecar that will   bay kept unsaved work for “Film”, but could not read it: <reason> The file
 *   not load            is still at <path>. [Show in Finder] [Discard] [Keep the file]
 *   never saved         “Untitled” was never saved. bay kept it from 3 minutes ago.
 *   (projects screen)   [Restore] [Discard]
 *   never saved and     Unsaved work bay kept could not be read: <reason> The file is still at
 *   will not load       <path>. [Show in Finder] [Discard]
 *
 * "Newer" is decided by the documents' own `updatedAt`, not by file times: copying a project to a
 * backup drive changes its mtime and nothing else. And a sidecar is only ever offered to the
 * project it was written for — one whose `id` differs is the "will not load" state, with that as
 * its reason, because restoring it would put another project's contents in this file's window.
 */

/** Which project a sidecar belongs to. `filePath` null is a project never saved. */
export interface AutosaveTarget {
  id: string
  filePath: string | null
}

/** What the renderer tells main about the project it just opened, to ask whether work was left. */
export interface OpenedProject extends AutosaveTarget {
  name: string
  /** The opened document's own `updatedAt` — what the sidecar is compared against. */
  updatedAt: number
}

export type RecoveryOffer =
  | {
      state: 'newer'
      target: AutosaveTarget
      name: string
      /** When the sidecar was written. */
      autosavedAt: number
      /** When the project file was last saved; null for one never saved. */
      savedAt: number | null
    }
  | {
      state: 'unreadable'
      target: AutosaveTarget
      /** The project the sidecar was found for, when that is known. */
      name: string | null
      sidecarPath: string
      /** A whole sentence, ending in its own full stop. */
      reason: string
    }

/** What main found in a sidecar, before it is compared with the project that was opened. */
export type SidecarReading =
  | { kind: 'none' }
  | { kind: 'unreadable'; sidecarPath: string; reason: string }
  | { kind: 'project'; sidecarPath: string; id: string; name: string; updatedAt: number }

/**
 * The offer, if any, for a project that was just opened. Pure, so every state above is a test.
 * `older` returns null: see the table.
 */
export function recoveryOffer(opened: OpenedProject, sidecar: SidecarReading): RecoveryOffer | null {
  const target: AutosaveTarget = { id: opened.id, filePath: opened.filePath }
  if (sidecar.kind === 'none') return null
  if (sidecar.kind === 'unreadable') {
    return { state: 'unreadable', target, name: opened.name, sidecarPath: sidecar.sidecarPath, reason: sidecar.reason }
  }
  if (sidecar.id !== opened.id) {
    return {
      state: 'unreadable',
      target,
      name: opened.name,
      sidecarPath: sidecar.sidecarPath,
      reason: `It belongs to a different project (“${sidecar.name}”), not the one saved in this file.`
    }
  }
  if (!(sidecar.updatedAt > opened.updatedAt)) return null
  return {
    state: 'newer',
    target,
    name: sidecar.name,
    autosavedAt: sidecar.updatedAt,
    savedAt: opened.filePath === null ? null : opened.updatedAt
  }
}

/**
 * The line shown for an offer. `when` and `savedWhen` are already words ("3 minutes ago"): the
 * clock is the renderer's, and a sentence that formats its own times cannot be tested without one.
 */
export function recoverySentence(offer: RecoveryOffer, when: string, savedWhen: string | null): string {
  if (offer.state === 'unreadable') {
    const whose = offer.name ? `bay kept unsaved work for “${offer.name}”, but could not read it` : 'Unsaved work bay kept could not be read'
    return `${whose}: ${offer.reason} The file is still at ${offer.sidecarPath}.`
  }
  if (offer.savedAt === null || savedWhen === null) {
    return `“${offer.name}” was never saved. bay kept it from ${when}.`
  }
  return `“${offer.name}” has unsaved work from ${when}, later than the project you saved ${savedWhen}. Restore it, or discard it and keep the saved project.`
}

// ---------------------------------------------------------------------------
// Preferences
// ---------------------------------------------------------------------------

export interface AutosavePrefs {
  enabled: boolean
  /** Seconds without an edit before a dirty project is written. */
  idleSeconds: number
}

export const AUTOSAVE_DEFAULTS: AutosavePrefs = { enabled: true, idleSeconds: 3 }
export const AUTOSAVE_IDLE_SECONDS = { min: 1, max: 120 }
/**
 * The longest an unbroken run of edits goes unwritten. Idle alone would never fire for someone
 * who does not pause for three seconds — an agent turn of forty tool calls, a long trim session.
 */
export const AUTOSAVE_BURST_SECONDS = 30

/**
 * localStorage keys. A compatibility surface: a later build reads what this one wrote, so
 * `autosave.test.ts` pins them as literals.
 */
export const AUTOSAVE_KEYS = { enabled: 'bay.autosave', idleSeconds: 'bay.autosave.idleSeconds' } as const

/** The preferences from their stored strings. Absent or unreadable is the default; on is opt-out. */
export function parseAutosavePrefs(enabled: string | null, idleSeconds: string | null): AutosavePrefs {
  const seconds = idleSeconds === null ? Number.NaN : Number(idleSeconds)
  return {
    enabled: enabled !== '0',
    idleSeconds: Number.isFinite(seconds)
      ? Math.min(AUTOSAVE_IDLE_SECONDS.max, Math.max(AUTOSAVE_IDLE_SECONDS.min, seconds))
      : AUTOSAVE_DEFAULTS.idleSeconds
  }
}

// ---------------------------------------------------------------------------
// Why a write did not happen
// ---------------------------------------------------------------------------

/**
 * Why autosave is not writing, in the order they are checked.
 *
 * `probe` is the one that protects fixtures: a test probe (`test/app/cdp.mjs`'s `attach()`) holds a
 * snapshot of the store in the page for as long as it is driving, and puts it back when it ends.
 * Everything it does in between is not the user's work, and a sidecar written from it would sit
 * beside the fixture and be offered as "unsaved work" to the next person who opened it.
 */
export type AutosaveSkip = 'off' | 'probe' | 'no-project' | 'recovery-pending' | 'clean'

export interface AutosaveConditions {
  enabled: boolean
  /** A probe's snapshot is held in the page. */
  probeDriving: boolean
  /** A project is open in the editor (not the projects screen). */
  editing: boolean
  /** A recovery check is in flight or its offer is unanswered: the sidecar holds the work on offer. */
  recoveryPending: boolean
  dirty: boolean
}

export function autosaveSkip(c: AutosaveConditions): AutosaveSkip | null {
  if (!c.enabled) return 'off'
  if (c.probeDriving) return 'probe'
  if (!c.editing) return 'no-project'
  if (c.recoveryPending) return 'recovery-pending'
  if (!c.dirty) return 'clean'
  return null
}

/** What Preferences says about a skip. `clean` and `no-project` are not worth a line. */
export function autosaveSkipSentence(skip: AutosaveSkip): string | null {
  switch (skip) {
    case 'off':
      return 'Autosave is off. Unsaved work is lost if bay quits unexpectedly.'
    case 'probe':
      return 'Autosave is paused: a test probe is driving this window, and what it does is not your work.'
    case 'recovery-pending':
      return 'Autosave is paused until you answer the offer to restore unsaved work.'
    case 'clean':
    case 'no-project':
      return null
  }
}

// ---------------------------------------------------------------------------
// The scheduler
// ---------------------------------------------------------------------------

export interface AutosaverOptions {
  idleMs(): number
  burstMs: number
  now(): number
  setTimer(run: () => void, ms: number): unknown
  clearTimer(handle: unknown): void
  /** Asked when the timer fires, not when it was set: a probe may have attached in between. */
  skip(): AutosaveSkip | null
  write(): Promise<void>
  onWritten?(at: number): void
  onSkipped?(skip: AutosaveSkip): void
  onFailed?(error: unknown): void
}

export interface Autosaver {
  /** The project changed. */
  edited(): void
  /** The project was saved, closed or replaced: nothing is owed any more. */
  settled(): void
  /** Write now if anything is owed and nothing forbids it. Resolves once it has. */
  flush(): Promise<void>
  /** Whether a write is owed and waiting on its timer. */
  pending(): boolean
  dispose(): void
}

/**
 * Writes `idleMs` after the last edit, and no later than `burstMs` after the first edit that has
 * not been written. One write at a time: an edit that lands while one is in flight is owed another.
 */
export function createAutosaver(options: AutosaverOptions): Autosaver {
  let timer: unknown = null
  /** When the oldest unwritten edit happened, or null when nothing is owed. */
  let owedSince: number | null = null
  let writing: Promise<void> | null = null
  let disposed = false

  function disarm(): void {
    if (timer !== null) options.clearTimer(timer)
    timer = null
  }

  function arm(): void {
    disarm()
    if (owedSince === null || disposed) return
    const now = options.now()
    const due = Math.min(now + options.idleMs(), owedSince + options.burstMs)
    timer = options.setTimer(() => {
      timer = null
      void run()
    }, Math.max(0, due - now))
  }

  async function run(): Promise<void> {
    if (disposed || owedSince === null) return
    if (writing) {
      // The edit that set this timer is newer than what is being written; come back for it.
      await writing
      return run()
    }
    const skip = options.skip()
    if (skip) {
      // Not retried on a timer: whatever lifts the skip (the probe restoring, the offer being
      // answered) is followed by an edit or a `settled`, and a paused autosave must not spin.
      owedSince = null
      options.onSkipped?.(skip)
      return
    }
    owedSince = null
    const started = options.now()
    writing = options.write().then(
      () => options.onWritten?.(started),
      (error: unknown) => options.onFailed?.(error)
    )
    try {
      await writing
    } finally {
      writing = null
    }
  }

  return {
    edited() {
      if (disposed) return
      if (owedSince === null) owedSince = options.now()
      arm()
    },
    settled() {
      owedSince = null
      disarm()
    },
    async flush() {
      disarm()
      await run()
    },
    pending: () => owedSince !== null,
    dispose() {
      disposed = true
      owedSince = null
      disarm()
    }
  }
}
