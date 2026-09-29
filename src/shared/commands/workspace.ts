import { SEPARATOR, type CommandEntry } from './types'

/**
 * Workspace: the page bar's pages, on DaVinci Resolve's ⇧-digit keys (⇧3 Cut and ⇧5 Fusion
 * have no page here and stay free), and the panels that sit beside every page.
 */
export const workspaceCommands = [
  { id: 'workspace.media', label: 'Media Page', group: 'Workspace', shortcut: 'Shift+2' },
  { id: 'workspace.edit', label: 'Edit Page', group: 'Workspace', shortcut: 'Shift+4' },
  { id: 'workspace.color', label: 'Color Page', group: 'Workspace', shortcut: 'Shift+6' },
  { id: 'workspace.audio', label: 'Audio Page', group: 'Workspace', shortcut: 'Shift+7' },
  { id: 'workspace.deliver', label: 'Deliver Page', group: 'Workspace', shortcut: 'Shift+8' },
  SEPARATOR,
  { id: 'workspace.toggleAgent', label: 'Show Agent Panel', group: 'Workspace' },
  { id: 'workspace.toggleInspector', label: 'Show Inspector', group: 'Workspace' },
  { id: 'workspace.toggleLibrary', label: 'Show Library', group: 'Workspace' },
  { id: 'workspace.toggleTimeline', label: 'Show Timeline', group: 'Workspace' },
  SEPARATOR,
  // ⌘⇧A, "A" for AI. Runs from a text field too: in the AI layout the composer usually has focus,
  // and the way back to Resolve's pages must not need a click first. Never behind a dialog, though:
  // swapping the layout under Project Settings is not text editing.
  { id: 'workspace.toggleLayoutMode', label: 'AI Layout', group: 'Workspace', shortcut: 'Mod+Shift+A', whileTyping: true, whileModal: false }
] as const satisfies readonly CommandEntry[]
