/**
 * Everything that can be done to one asset, as data: the Media Pool's right-click menu and its
 * selected-asset action bar are both drawn from this one list, so no action can exist in the menu
 * without a visible button (the audit found Detect Beats, Transcript and Subtitles reachable only
 * by right-click), and the two can never disagree about what is enabled or why.
 *
 * Pure: the caller supplies the facts and the verbs; nothing here reaches the store.
 */

import type { Asset } from '@shared/project'
import { canRelink } from '@shared/relink'

export type AssetActionId =
  | 'place'
  | 'append'
  | 'transcribe'
  | 'beats'
  | 'subtitles'
  | 'reveal'
  | 'rename'
  | 'relink'
  | 'code'
  | 'remove'

/** Rows in the same group sit together; the menu puts a separator between groups. */
export type AssetActionGroup = 'place' | 'analyse' | 'file' | 'remove'

export interface AssetAction {
  id: AssetActionId
  group: AssetActionGroup
  /** The button's words: short, a verb. */
  label: string
  /** The menu row's words, in the menu's Title Case, with the reason when disabled. */
  menuLabel: string
  disabled: boolean
  /** Why it is disabled, for a button's tooltip. */
  hint?: string
  danger?: boolean
  shortcut?: string
}

export interface AssetFacts {
  /** The file is not where it was imported from. */
  missing: boolean
  /** Clips on the active timeline that use it. */
  uses: number
  /** An action is already running on it ("Detecting beats…"). */
  busy: boolean
}

/** A font or LUT is applied from elsewhere, never placed. */
export const placeable = (asset: Asset): boolean => !asset.error && asset.kind !== 'font' && asset.kind !== 'lut'

/** Sound that whisper and the beat detector can read: a video's or an audio file's own. */
export const audible = (asset: Asset): boolean =>
  asset.hasAudio && asset.path !== null && (asset.kind === 'video' || asset.kind === 'audio')

/** Code the editor can open: a motion graphic's source, or a composition's file. */
export const hasCode = (asset: Asset): boolean =>
  (asset.kind === 'brf' && asset.brfCode !== undefined) || (asset.kind === 'html' && asset.path !== null)

/**
 * The actions `asset` offers, in menu order. Actions that do not apply to its kind are left out
 * (a title has no file to reveal); actions that apply but cannot run now are kept, disabled, with
 * the reason — so the button stays where the hand expects it, as Resolve dims rather than hides.
 */
export function assetActions(asset: Asset, facts: AssetFacts): AssetAction[] {
  const { missing, uses, busy } = facts
  const used = uses > 0
  const out: AssetAction[] = []
  if (placeable(asset)) {
    const locate = missing ? 'Locate the file first' : undefined
    out.push(
      {
        id: 'place',
        group: 'place',
        label: 'Add at Playhead',
        menuLabel: missing ? 'Add at Playhead (locate the file first)' : 'Add at Playhead',
        disabled: missing,
        ...(locate ? { hint: locate } : {}),
        shortcut: 'Enter'
      },
      {
        id: 'append',
        group: 'place',
        label: 'Append',
        menuLabel: missing ? 'Append to End (locate the file first)' : 'Append to End',
        disabled: missing,
        ...(locate ? { hint: locate } : {})
      }
    )
  }
  if (audible(asset)) {
    const unplaced = !used ? 'Place it on the timeline first' : missing ? 'Locate the file first' : undefined
    out.push(
      {
        id: 'transcribe',
        group: 'analyse',
        label: 'Transcribe',
        menuLabel: used ? 'Transcript…' : 'Transcript… (place it first)',
        disabled: !used || missing,
        ...(unplaced ? { hint: unplaced } : {})
      },
      {
        id: 'beats',
        group: 'analyse',
        label: asset.beats ? 'Beats Again' : 'Detect Beats',
        menuLabel: asset.beats ? 'Detect Beats Again' : 'Detect Beats',
        disabled: missing || busy,
        ...(missing ? { hint: 'Locate the file first' } : busy ? { hint: 'Already running' } : {})
      },
      {
        id: 'subtitles',
        group: 'analyse',
        label: 'Subtitles',
        menuLabel: used ? 'Add Subtitles…' : 'Add Subtitles… (place it first)',
        disabled: !used || missing,
        ...(unplaced ? { hint: unplaced } : {})
      }
    )
  }
  if (asset.path) {
    out.push({
      id: 'reveal',
      group: 'file',
      label: 'Reveal',
      menuLabel: 'Reveal in Finder',
      disabled: missing,
      ...(missing ? { hint: 'The file is missing' } : {})
    })
  }
  out.push({ id: 'rename', group: 'file', label: 'Rename', menuLabel: 'Rename', disabled: false })
  if (canRelink(asset)) {
    out.push({
      id: 'relink',
      group: 'file',
      label: missing ? 'Locate…' : 'Replace…',
      menuLabel: missing ? 'Locate Missing File…' : 'Replace File…',
      disabled: false
    })
  }
  if (hasCode(asset)) out.push({ id: 'code', group: 'file', label: 'Edit Code', menuLabel: 'Edit Code…', disabled: false })
  out.push({
    id: 'remove',
    group: 'remove',
    label: 'Remove',
    menuLabel: used ? 'Remove from Project…' : 'Remove from Project',
    disabled: false,
    danger: true
  })
  return out
}
