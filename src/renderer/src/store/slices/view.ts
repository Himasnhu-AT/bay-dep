/**
 * View state — selection, playhead, zoom, panels, settings, the toast and the home screen.
 * None of it is part of the project, so none of it goes through `edit()` or reaches undo.
 */

import { timelineDuration } from '@shared/project'
import { remember } from '../prefs'
import type { EditorActions } from '../types'
import type { StoreKit } from '../kit'

let toastCounter = 0

type Actions = Pick<
  EditorActions,
  | 'select'
  | 'clearSelection'
  | 'setPlayhead'
  | 'nudgePlayhead'
  | 'setPlaying'
  | 'togglePlay'
  | 'setScrubbing'
  | 'setPixelsPerFrame'
  | 'zoomBy'
  | 'setPanel'
  | 'setRegionHidden'
  | 'setSettingsOpen'
  | 'setAutoDownloadModels'
  | 'setWhisperModel'
  | 'setWhisperDownload'
  | 'toggleDebugMode'
  | 'toggleRegion'
  | 'enterProject'
  | 'showHome'
  | 'notify'
  | 'dismissToast'
  | 'setRangeIn'
  | 'setRangeOut'
  | 'clearRange'
  | 'setSnapping'
  | 'toggleSnapping'
  | 'toggleLinkedSelection'
  | 'toggleLoop'
>

export function viewSlice({ set, get, currentTimeline }: StoreKit): Actions {
  return {
    // -- selection / view ---------------------------------------------------
    select(itemIds, additive) {
      set((state) => {
        if (!additive) return { selection: itemIds }
        const merged = new Set(state.selection)
        for (const id of itemIds) {
          if (merged.has(id)) merged.delete(id)
          else merged.add(id)
        }
        return { selection: [...merged] }
      })
    },

    clearSelection() {
      set({ selection: [] })
    },

    setPlayhead(frame) {
      const timeline = currentTimeline()
      const max = timeline ? timelineDuration(timeline) : 0
      set({ playhead: Math.max(0, Math.min(Math.round(frame), Math.max(0, max))) })
    },

    nudgePlayhead(deltaFrames) {
      get().setPlayhead(get().playhead + deltaFrames)
    },

    setPlaying(playing) {
      const timeline = currentTimeline()
      if (playing && timeline && timelineDuration(timeline) === 0) return
      set({ playing })
    },

    togglePlay() {
      get().setPlaying(!get().playing)
    },

    setScrubbing(scrubbing) {
      set({ scrubbing })
    },

    setPixelsPerFrame(pixelsPerFrame) {
      set({ pixelsPerFrame: Math.max(0.05, Math.min(60, pixelsPerFrame)) })
    },

    zoomBy(factor) {
      get().setPixelsPerFrame(get().pixelsPerFrame * factor)
    },

    setPanel(panel) {
      set({ panel })
    },

    setRegionHidden(region, hidden) {
      const current = get().hiddenRegions
      if (current[region] === hidden) return
      set({ hiddenRegions: { ...current, [region]: hidden } })
    },

    setSettingsOpen(open) {
      set({ settingsOpen: open })
    },

    setAutoDownloadModels(on) {
      remember('bay.autoDownloadModels', on ? '1' : '0')
      set({ autoDownloadModels: on })
    },

    setWhisperModel(file) {
      remember('bay.whisperModel', file)
      set({ whisperModel: file })
    },

    setWhisperDownload(download) {
      set({ whisperDownload: download })
    },

    toggleDebugMode() {
      const next = !get().debugMode
      set({ debugMode: next })
      try {
        globalThis.localStorage?.setItem('bay.debugMode', next ? '1' : '0')
      } catch {
        // Not remembered this time; still on for this session.
      }
    },

    toggleRegion(region) {
      const current = get().hiddenRegions
      set({ hiddenRegions: { ...current, [region]: !current[region] } })
    },

    enterProject(project) {
      get().setProject(project)
      // In and Out belong to the timeline they were marked on.
      set({ screen: 'editor', rangeIn: null, rangeOut: null })
    },

    showHome() {
      // The agent conversation belongs to the project it was about; carrying it onto the next
      // project would put one timeline's proposals in front of another's.
      set({
        screen: 'home',
        agentLog: [],
        agentProposal: null,
        agentGate: null,
        agentPins: [],
        agentSessionActive: false,
        agentTurnBase: null,
        agentTurnFiles: {},
        agentTurnEdited: false,
        agentTurnUserEdited: false,
        agentCheckpoints: {},
        agentReverts: []
      })
    },

    notify(text, kind = 'info') {
      toastCounter += 1
      set({ toast: { id: toastCounter, kind, text } })
    },

    dismissToast() {
      set({ toast: null })
    },

    // -- in/out, snapping, linked selection, loop ---------------------------
    setRangeIn(frame) {
      if (frame === null) return set({ rangeIn: null })
      const at = Math.max(0, Math.round(frame))
      const out = get().rangeOut
      set({ rangeIn: at, ...(out !== null && out <= at ? { rangeOut: null } : {}) })
    },

    setRangeOut(frame) {
      if (frame === null) return set({ rangeOut: null })
      const at = Math.max(0, Math.round(frame))
      const from = get().rangeIn
      set({ rangeOut: at, ...(from !== null && from >= at ? { rangeIn: null } : {}) })
    },

    clearRange() {
      set({ rangeIn: null, rangeOut: null })
    },

    setSnapping(on) {
      remember('bay.snapping', on ? '1' : '0')
      set({ snapping: on })
    },

    toggleSnapping() {
      get().setSnapping(!get().snapping)
    },

    toggleLinkedSelection() {
      const next = !get().linkedSelection
      remember('bay.linkedSelection', next ? '1' : '0')
      set({ linkedSelection: next })
    },

    toggleLoop() {
      set({ loop: !get().loop })
    }
  }
}
