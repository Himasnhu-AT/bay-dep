/** The registry's runtime: the handler map, the host, and `runCommand`. See `./index.ts`. */

import { COMMANDS, isCommandId, type CommandId } from '@shared/commands'
import { useEditor } from '@/store/editor'
import { clipHandlers } from './clip'
import { editHandlers } from './edit'
import { fileHandlers } from './file'
import { helpHandlers } from './help'
import { markHandlers } from './mark'
import { playbackHandlers } from './playback'
import { timelineHandlers } from './timeline'
import type { CommandContext, CommandHandler, CommandHost } from './types'
import { viewHandlers } from './view'

/** Every declared command's behaviour. Typed as total: a declared id with no handler fails here. */
export const HANDLERS: { readonly [K in CommandId]: CommandHandler } = {
  ...fileHandlers,
  ...editHandlers,
  ...clipHandlers,
  ...markHandlers,
  ...timelineHandlers,
  ...playbackHandlers,
  ...viewHandlers,
  ...helpHandlers
}

let host: CommandHost | null = null

/** Installs the app shell's callbacks; returns the uninstall. Called by `useCommands`. */
export function setCommandHost(next: CommandHost): () => void {
  host = next
  return () => {
    if (host === next) host = null
  }
}

/** True when keystrokes belong to what the user is typing into. */
export function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

function context(source: CommandContext['source'], typing?: boolean): CommandContext {
  return {
    state: useEditor.getState(),
    host,
    typing: typing ?? isTyping(document.activeElement),
    source
  }
}

/** Whether the command would run now (its `when`, or true). */
export function isCommandEnabled(id: CommandId): boolean {
  const handler = HANDLERS[id]
  return handler.when ? handler.when(context('ui')) : true
}

/**
 * Runs a command by id if it is enabled; returns whether it ran. Unknown ids (a stale menu
 * item from main) are ignored rather than thrown — the menu and renderer ship together, but
 * a refactor can still leave one behind for a build.
 */
export function runCommand(
  id: CommandId | string,
  source: CommandContext['source'] = 'ui',
  typing?: boolean
): boolean {
  if (!isCommandId(id)) {
    console.warn(`[commands] no command "${id}"`)
    return false
  }
  const handler = HANDLERS[id]
  const ctx = context(source, typing)
  if (handler.when && !handler.when(ctx)) return false
  handler.run(ctx)
  return true
}

/** Every command in menu order, for a sheet or a palette. */
export function allCommands(): typeof COMMANDS {
  return COMMANDS
}
