/**
 * Which inspector tabs a selection gets, and which one to show.
 *
 * Resolve greys out a tab that does not apply rather than removing it, so the row never shifts
 * under the pointer; this decides the grey, the reason in its tooltip, and — when the tab the
 * person last chose does not apply to what is selected now — which tab to fall back to. Pure, so
 * the acceptance cases (a video clip, a title, a music bed) are tests rather than a probe.
 */
import type { InspectorTab } from '@/store/types'

/** How many selected clips fall in each group the inspector's sections are decided by. */
export interface SelectionShape {
  count: number
  /** Clips with a picture (video, image, text, composition…) on a video track. */
  visual: number
  /** Text titles. */
  text: number
  /** HTML compositions and `.brf` motion graphics — clips that declare their own controls. */
  composed: number
  /** Picture sources a grade and a crop reach (not text). */
  source: number
  /** Clips that can sound. */
  sound: number
  /** Pictures whose sound was detached to a linked audio clip. */
  detached: number
}

export interface TabState {
  value: InspectorTab
  label: string
  enabled: boolean
  /** Why it is greyed, for the tooltip. */
  hint?: string
}

/** The tabs a selection shows, in Resolve's order with bay's Title and Color in theirs. */
export const SELECTION_TABS = ['video', 'title', 'audio', 'effects', 'transition', 'color', 'file'] as const

export const TAB_LABEL: Record<InspectorTab, string> = {
  video: 'Video',
  title: 'Title',
  audio: 'Audio',
  effects: 'Effects',
  transition: 'Transition',
  color: 'Color',
  file: 'File',
  timeline: 'Timeline'
}

export function inspectorTabs(shape: SelectionShape): TabState[] {
  if (shape.count === 0) return [{ value: 'timeline', label: TAB_LABEL.timeline, enabled: true }]
  const tab = (value: InspectorTab, enabled: boolean, hint: string): TabState =>
    enabled ? { value, label: TAB_LABEL[value], enabled } : { value, label: TAB_LABEL[value], enabled, hint }
  return [
    tab('video', shape.visual > 0, 'Nothing selected has a picture'),
    tab('title', shape.text + shape.composed > 0, 'Select a title, composition or motion graphic'),
    tab('audio', shape.sound + shape.detached > 0, 'Nothing selected has sound'),
    tab('effects', true, ''),
    // Transitions join clips on a video track; a sound on its own has no cut to dissolve.
    tab('transition', shape.visual > 0, 'Transitions go between clips on a video track'),
    tab('color', shape.source > 0, 'Only video, images and compositions can be graded'),
    tab('file', true, '')
  ]
}

/**
 * The tab to show: the remembered one when it applies, else the first that does. With nothing
 * selected that is always Timeline, and choosing a clip again returns to the remembered tab —
 * the fallback is shown, never stored, so it does not overwrite what the person chose.
 */
export function chooseTab(remembered: InspectorTab, tabs: readonly TabState[]): InspectorTab {
  const match = tabs.find((tab) => tab.value === remembered && tab.enabled)
  if (match) return match.value
  return tabs.find((tab) => tab.enabled)?.value ?? 'file'
}

/**
 * Which tab holds a section, so `openSection(id)` from outside the inspector (a double-click on
 * a title in the viewer asks for `inspector.clip`) can switch to it before the section opens.
 * Null for an id the inspector does not own.
 */
export function tabForSection(id: string, shape: SelectionShape): InspectorTab | null {
  if (shape.count === 0) return id === 'inspector.canvas' || id === 'inspector.selection' ? 'timeline' : null
  switch (id) {
    // A title's words are in its Clip section, and the Title tab shows it first.
    case 'inspector.clip':
      return shape.text > 0 ? 'title' : 'file'
    case 'inspector.timing':
      return 'file'
    case 'inspector.retime':
      return shape.visual > 0 ? 'video' : 'audio'
    case 'inspector.transform':
    case 'inspector.crop':
    case 'inspector.masks':
    case 'inspector.blend':
      return 'video'
    case 'inspector.type':
    case 'inspector.outline':
    case 'inspector.shadow':
    case 'inspector.plate':
    case 'inspector.looks':
    case 'inspector.fill':
    case 'inspector.glow':
    case 'inspector.composition':
      return 'title'
    case 'inspector.adjustments':
    case 'inspector.animation':
    case 'inspector.keyframes':
    case 'inspector.effects':
      return 'effects'
    case 'inspector.grade':
      return 'color'
    case 'inspector.audio':
      return 'audio'
    case 'inspector.transition':
      return 'transition'
    default:
      return null
  }
}
