/**
 * The editor store — the single source of truth the UI renders from and the engine reads.
 *
 * Two deliberate choices:
 *
 * - **The playhead lives here, in frames.** Every surface (transport, timeline, preview,
 *   inspector) reads the same integer, so they cannot disagree about where we are. The
 *   playback clock writes to it at the timeline's frame rate, not the display's.
 * - **Undo is snapshot-based over `project` only.** Selection, zoom and the playhead are
 *   view state and are deliberately excluded — undoing a trim should not also scroll you
 *   somewhere else. Snapshots are cheap here because a project is small JSON; if that ever
 *   stops being true the fix is a patch log, not a smaller snapshot.
 */

import { create } from 'zustand'
import { allItems, findTimeline, timelineDuration, type Frames, type Item, type Timeline } from '@shared/project'
import { remembered } from './prefs'
import { emptyProject } from './factory'
import { createKit } from './kit'
import { projectSlice } from './slices/project'
import { agentSlice } from './slices/agent'
import { timelineSlice } from './slices/timeline'
import { itemsSlice } from './slices/items'
import { viewSlice } from './slices/view'
import type { EditorStore } from './types'

// The store's public surface, unchanged for every importer.
export { emptyProject, newId } from './factory'
export {
  MAX_AGENT_CHECKPOINTS,
  asAgent,
  revertImpact,
  setAgentFileWriter,
  type AgentCheckpoint,
  type AgentRevert
} from './agent-turns'
export type { EditorActions, EditorState, EditorStore, PanelId, RegionId, Screen } from './types'

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

/**
 * The initial state is listed here, whole, so there is one place that says what the store
 * holds; the actions live in `./slices/`, one concern each, over the shared `./kit`. Every
 * project mutation still goes through the kit's `edit()`.
 */
export const useEditor = create<EditorStore>((set, get) => {
  const kit = createKit(set, get)
  return {
    project: emptyProject(),
    selection: [],
    playhead: 0,
    playing: false,
    pixelsPerFrame: 4,
    panel: 'media',
    hiddenRegions: { side: false, inspector: false, timeline: false },
    debugMode: (() => {
      try {
        return globalThis.localStorage?.getItem('bay.debugMode') === '1'
      } catch {
        return false
      }
    })(),
    settingsOpen: false,
    autoDownloadModels: remembered('bay.autoDownloadModels') !== '0',
    whisperModel: remembered('bay.whisperModel'),
    whisperDownload: null,
    screen: 'home',
    scrubbing: false,
    toast: null,
    agentGate: null,
    agentLog: [],
    agentRunning: false,
    agentProposal: null,
    agentPins: [],
    agentSessionActive: false,
    agentApproval: (() => {
      try {
        return globalThis.localStorage?.getItem('bay.agentApproval') === '1'
      } catch {
        return false
      }
    })(),
    agentTurnBase: null,
    agentThinkingSince: null,
    agentTurnFiles: {},
    agentTurnEdited: false,
    agentTurnUserEdited: false,
    agentCheckpoints: {},
    agentReverts: [],
    compositionEpochs: {},
    dirty: false,
    past: [],
    future: [],

    ...projectSlice(kit),
    ...agentSlice(kit),
    ...timelineSlice(kit),
    ...itemsSlice(kit),
    ...viewSlice(kit)
  }
})

// ---------------------------------------------------------------------------
// Selectors — importing these keeps components subscribed to one slice, not the store
// ---------------------------------------------------------------------------

export const selectTimeline = (state: EditorStore): Timeline | undefined =>
  findTimeline(state.project, state.project.activeTimelineId)

export const selectDuration = (state: EditorStore): Frames => {
  const timeline = selectTimeline(state)
  return timeline ? timelineDuration(timeline) : 0
}

export const selectSelectedItems = (state: EditorStore): Item[] => {
  const timeline = selectTimeline(state)
  if (!timeline) return []
  return allItems(timeline).filter((item) => state.selection.includes(item.id))
}

export const selectFps = (state: EditorStore): number => selectTimeline(state)?.fps ?? 30
