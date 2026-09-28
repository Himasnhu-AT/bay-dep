/**
 * The declarative half of a command: what it is called, where it sits in the menu bar and which
 * keys run it. Main builds the menu bar from these; the renderer attaches `run`/`when` by id
 * (`src/renderer/src/lib/commands/`). The split exists because main cannot import renderer
 * code, and a menu item with no renderer behaviour is exactly the dead item `menu.test.ts`
 * forbids — so the renderer's handler map is typed against these ids and a spec without a
 * handler fails `pnpm typecheck`.
 */

/** Menu-bar order. A group with no menu entries gets no menu. */
export const COMMAND_GROUPS = [
  'File',
  'Edit',
  'Clip',
  'Mark',
  'Timeline',
  'Playback',
  'View',
  'Workspace',
  'Help'
] as const

export type CommandGroup = (typeof COMMAND_GROUPS)[number]

export interface CommandSpec {
  /** `<group>.<verb>`, stable: menus, tests and other code refer to it. */
  readonly id: string
  /** Title Case, as a menu item reads. End with `…` when it opens a dialog. */
  readonly label: string
  readonly group: CommandGroup
  /**
   * The keys that run it, in `@shared/shortcuts` spelling. The first is the one menus and
   * tooltips show; the rest are aliases (`Delete` and `Backspace`).
   */
  readonly shortcut?: string | readonly string[]
  /**
   * Who owns the key. `'renderer'` (the default): the renderer's key handler runs it, and the
   * menu only *shows* the shortcut (`registerAccelerator: false`) — so single keys never
   * steal a keystroke from a text field, and nothing fires twice. `'native'`: main registers
   * the accelerator and the renderer's key handler ignores it — for ⌘-combos that must work
   * while a text field has focus (Save) or that the renderer never handled (Open).
   */
  readonly accelerator?: 'renderer' | 'native'
  /** Renderer-owned only: also runs while a text field has focus. Default false. */
  readonly whileTyping?: boolean
  /**
   * False: never runs while a dialog is open, even from the dialog's own text field. For
   * `whileTyping` commands that are not text editing (the layout switch): `whileTyping` alone lets
   * a key through the dialog gate when a field inside the dialog has focus. Default true.
   */
  readonly whileModal?: boolean
  /** False keeps it out of the native menu bar (it stays in the shortcuts sheet). Default true. */
  readonly menu?: boolean
}

/** A menu separator, placed between entries in a group's list. */
export const SEPARATOR = '-' as const
export type Separator = typeof SEPARATOR

export type CommandEntry = CommandSpec | Separator
