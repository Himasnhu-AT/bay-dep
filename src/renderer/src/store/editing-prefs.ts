/**
 * Editing preferences: per machine, in localStorage, and each one read by the code whose
 * behaviour it changes. Preferences › Editing is the only writer.
 *
 * A store of its own rather than fields on the editor store: nothing here is project state or
 * undoable, and the editor store's shape is shared by every part of the app.
 *
 * The keys are a compatibility surface (CLAUDE.md): a later build reads what this one wrote, so
 * `editing-prefs.test.ts` pins them as literals. Rename one and every user gets the default back.
 */

import { create } from 'zustand'
import type { CanvasFit } from '@shared/project'
import { remember, remembered } from './prefs'

export interface EditingPrefs {
  /** How long a still image or a text clip runs when placed, in seconds. */
  stillSeconds: number
  /** The length a new transition asks for, in seconds. */
  transitionSeconds: number
  /** During playback, scroll the timeline to keep the playhead in view. */
  followPlayhead: boolean
  /**
   * How a new clip whose shape differs from the canvas is framed: `auto` fills unless that would
   * crop away too much of it, `contain` (Fit) always shows it whole, `cover` (Fill) always fills.
   */
  newClipFit: CanvasFit
  /**
   * A placed video's sound goes on its own linked clip on an audio track (A1), as in Resolve,
   * rather than living inside the picture clip. Linked, so they move, trim and delete together.
   */
  separateClipAudio: boolean
}

export const EDITING_DEFAULTS: EditingPrefs = {
  stillSeconds: 5,
  transitionSeconds: 1,
  followPlayhead: true,
  newClipFit: 'auto',
  separateClipAudio: true
}

/** The bounds each number is held to, so a hand-edited or corrupt value cannot place a 0-frame clip. */
export const STILL_SECONDS = { min: 0.5, max: 60 }
export const TRANSITION_SECONDS = { min: 0.1, max: 5 }

const KEYS = {
  stillSeconds: 'bay.stillSeconds',
  transitionSeconds: 'bay.transitionSeconds',
  followPlayhead: 'bay.followPlayhead',
  newClipFit: 'bay.newClipFit',
  separateClipAudio: 'bay.separateClipAudio'
} as const

const FITS: readonly CanvasFit[] = ['auto', 'cover', 'contain']

function readNumber(key: string, fallback: number, range: { min: number; max: number }): number {
  const raw = remembered(key)
  if (raw === null) return fallback
  const value = Number(raw)
  if (!Number.isFinite(value)) return fallback
  return Math.min(range.max, Math.max(range.min, value))
}

interface EditingPrefsStore extends EditingPrefs {
  setStillSeconds(seconds: number): void
  setTransitionSeconds(seconds: number): void
  setFollowPlayhead(on: boolean): void
  setNewClipFit(fit: CanvasFit): void
  setSeparateClipAudio(on: boolean): void
}

export const useEditingPrefs = create<EditingPrefsStore>((set) => ({
  stillSeconds: readNumber(KEYS.stillSeconds, EDITING_DEFAULTS.stillSeconds, STILL_SECONDS),
  transitionSeconds: readNumber(KEYS.transitionSeconds, EDITING_DEFAULTS.transitionSeconds, TRANSITION_SECONDS),
  // Opt-out: absent means on.
  followPlayhead: remembered(KEYS.followPlayhead) !== '0',
  newClipFit: FITS.find((fit) => fit === remembered(KEYS.newClipFit)) ?? EDITING_DEFAULTS.newClipFit,
  // Opt-out: absent means on.
  separateClipAudio: remembered(KEYS.separateClipAudio) !== '0',
  setSeparateClipAudio(on) {
    remember(KEYS.separateClipAudio, on ? null : '0')
    set({ separateClipAudio: on })
  },

  setStillSeconds(seconds) {
    if (!Number.isFinite(seconds)) return
    const value = Math.min(STILL_SECONDS.max, Math.max(STILL_SECONDS.min, seconds))
    remember(KEYS.stillSeconds, value === EDITING_DEFAULTS.stillSeconds ? null : String(value))
    set({ stillSeconds: value })
  },
  setTransitionSeconds(seconds) {
    if (!Number.isFinite(seconds)) return
    const value = Math.min(TRANSITION_SECONDS.max, Math.max(TRANSITION_SECONDS.min, seconds))
    remember(KEYS.transitionSeconds, value === EDITING_DEFAULTS.transitionSeconds ? null : String(value))
    set({ transitionSeconds: value })
  },
  setFollowPlayhead(on) {
    remember(KEYS.followPlayhead, on ? null : '0')
    set({ followPlayhead: on })
  },
  setNewClipFit(fit) {
    if (!FITS.includes(fit)) return
    remember(KEYS.newClipFit, fit === EDITING_DEFAULTS.newClipFit ? null : fit)
    set({ newClipFit: fit })
  }
}))

/** The preferences as they are now, for code that runs outside React. */
export const editingPrefs = (): EditingPrefs => useEditingPrefs.getState()

/**
 * Frames a still (an image or text, which have no length of their own) runs when placed. The
 * store's `placeAsset` and `place_asset`'s collision check both read this, so the clip that is
 * placed is the length that was checked for room.
 */
export function stillDurationFrames(fps: number, seconds = editingPrefs().stillSeconds): number {
  return Math.max(1, Math.round(seconds * fps))
}

/** Frames a new transition asks for at this rate, before the cut's handles limit it. */
export function transitionLengthFrames(fps: number, seconds = editingPrefs().transitionSeconds): number {
  return Math.max(2, Math.round(seconds * fps))
}
