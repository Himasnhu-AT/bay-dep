/**
 * Autosave's two preferences and what it last did. Per machine, in localStorage, like the
 * editing preferences beside it; Preferences › Editing › Autosave is the only writer of the first
 * two, and `lib/autosave.ts` the only writer of the rest.
 *
 * The parsing and the keys are in `@shared/autosave`, where the tests reach them.
 */

import { create } from 'zustand'
import {
  AUTOSAVE_DEFAULTS,
  AUTOSAVE_IDLE_SECONDS,
  AUTOSAVE_KEYS,
  parseAutosavePrefs,
  type AutosavePrefs,
  type AutosaveSkip,
  type RecoveryOffer
} from '@shared/autosave'
import { remember, remembered } from './prefs'

interface AutosaveStore extends AutosavePrefs {
  /** When the open project's sidecar was last written this session, or null. */
  lastWrittenAt: number | null
  /** Why the last attempt did not write, or null when it did. */
  lastSkip: AutosaveSkip | null
  /** What the last failed write said, or null. */
  lastError: string | null
  /**
   * The offer for the project that is open: `'checking'` while main is asked, an offer until it
   * is answered. Autosave does not write while this is not null — the sidecar holds the work on
   * offer, and writing the just-opened project over it would destroy what is being offered.
   */
  recovery: RecoveryOffer | 'checking' | null
  setEnabled(on: boolean): void
  setIdleSeconds(seconds: number): void
  setRecovery(recovery: RecoveryOffer | 'checking' | null): void
  noteWritten(at: number): void
  noteSkipped(skip: AutosaveSkip): void
  noteFailed(error: string): void
}

export const useAutosave = create<AutosaveStore>((set) => ({
  ...parseAutosavePrefs(remembered(AUTOSAVE_KEYS.enabled), remembered(AUTOSAVE_KEYS.idleSeconds)),
  lastWrittenAt: null,
  lastSkip: null,
  lastError: null,
  recovery: null,
  setEnabled(on) {
    remember(AUTOSAVE_KEYS.enabled, on ? null : '0')
    set({ enabled: on, lastSkip: null })
  },
  setIdleSeconds(seconds) {
    if (!Number.isFinite(seconds)) return
    const value = Math.min(AUTOSAVE_IDLE_SECONDS.max, Math.max(AUTOSAVE_IDLE_SECONDS.min, seconds))
    remember(AUTOSAVE_KEYS.idleSeconds, value === AUTOSAVE_DEFAULTS.idleSeconds ? null : String(value))
    set({ idleSeconds: value })
  },
  setRecovery: (recovery) => set({ recovery }),
  noteWritten: (at) => set({ lastWrittenAt: at, lastSkip: null, lastError: null }),
  noteSkipped: (skip) => set({ lastSkip: skip }),
  noteFailed: (error) => set({ lastError: error })
}))
