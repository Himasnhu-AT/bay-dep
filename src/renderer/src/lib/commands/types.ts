import type { CommandId } from '@shared/commands'
import type { EditorStore } from '@/store/editor'

/**
 * What only the app shell can do — things that are not store actions: an IPC round trip
 * (save, open, import) or a piece of React state (the export dialog, the shortcuts sheet).
 * `App` registers these once with `useCommands(host)`; a command reaches them as `ctx.host`.
 * Add a method here when a new command needs one, and provide it in `App.tsx`.
 */
export interface CommandHost {
  save(): void
  saveAs(): void
  open(): void
  /** Create a project in the projects folder and open it — from the editor or the projects screen. */
  newProject(): void
  importMedia(): void
  openExport(): void
  openShortcuts(): void
  /** Escape, not typed or claimed by anything focused: closes whatever App-level modal is open. */
  escape(): void
}

export interface CommandContext {
  /** The store, read at the moment the command runs — never a snapshot from before. */
  state: EditorStore
  /** Null until `App` mounts; a command that needs it no-ops without it. */
  host: CommandHost | null
  /** A text field has focus. Only menu clicks and `whileTyping` commands can see this true. */
  typing: boolean
  /** Where the command came from; most commands do not care. */
  source: 'key' | 'menu' | 'ui'
}

export interface CommandHandler {
  run(ctx: CommandContext): void
  /**
   * Whether it can run now. A disabled command does nothing (a key press is still claimed, so
   * the browser does not act on it instead). Leave it out when the action already explains
   * itself — e.g. a store action that raises "Nothing selected" — so the explanation is kept.
   */
  when?(ctx: CommandContext): boolean
}

/** A group file's handlers: keyed by the ids of `@shared/commands`, so a typo fails typecheck. */
export type Handlers = { readonly [K in CommandId]?: CommandHandler }
