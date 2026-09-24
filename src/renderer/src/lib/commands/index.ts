/**
 * The command registry: every action a key, a menu item or a button can trigger, run through one
 * function so the three cannot disagree. The declarations (id, label, group, shortcut) live in
 * `@shared/commands`, because main builds the native menu bar from them; the behaviour lives
 * here, keyed by the same ids.
 *
 * ── Add a command ────────────────────────────────────────────────────────────────────────────
 *  1. Declare it in `src/shared/commands/<group>.ts` (clip, mark, timeline, …):
 *       { id: 'clip.splitAll', label: 'Split All Tracks', group: 'Clip', shortcut: 'Mod+Shift+B' }
 *     Ids are `<group>.<verb>`; labels are Title Case, `…` if it opens a dialog. Shortcuts use
 *     `@shared/shortcuts` spelling (`Mod` is ⌘/Ctrl). `commands.test.ts` fails on a key two
 *     commands claim, so run `pnpm test`.
 *  2. Handle it in `./<group>.ts` here: `'clip.splitAll': { run: ({ state }) => …, when? }`.
 *     `pnpm typecheck` fails until both halves exist. Need something that is not a store
 *     action (IPC, App-level React state)? Add a method to `CommandHost` (`./types.ts`) and
 *     provide it in `App.tsx`'s `useCommands({...})`.
 *  That is all: the key works, the native menu shows it (under its group, with the shortcut),
 *  and the shortcuts sheet lists it. A new *group* is a file in each folder plus one line in
 *  each index (`BY_GROUP` in shared, `HANDLERS` in `./registry.ts`) and one in `COMMAND_GROUPS`.
 *
 * ── Keys: who owns them ──────────────────────────────────────────────────────────────────────
 *  By default the renderer's key handler runs the command and the native menu only *shows* the
 *  key. Single keys (S, M, I/O, J/K/L, arrows, Delete) must stay that way — a registered native
 *  `S` is taken from every text field. `accelerator: 'native'` is only for ⌘-combos that must
 *  work while a text field has focus (Save) or that the renderer does not handle; main then
 *  owns the key and the renderer ignores it. No key fires while typing unless `whileTyping`.
 *
 * ── Run one from UI ──────────────────────────────────────────────────────────────────────────
 *  `runCommand('clip.split')` from a button or a `Menu` item's `onSelect`, and show the key with
 *  `shortcutOf('clip.split')` — passed to `IconButton`/`Tooltip` `shortcut`, a `MenuAction`
 *  `shortcut`, or `<Kbd shortcut>`, which all draw it as the platform does (⌘B).
 *  `isCommandEnabled(id)` for a `disabled` prop. (`components/` may not import this module —
 *  it reaches the store — so the caller in `editor/` passes the result down.)
 *
 * ── Which primitive (`@/components`) ─────────────────────────────────────────────────────────
 *  A list of actions from a button → `Menu` + `useFloatingTrigger()`. Right-click → `ContextMenu`.
 *  A small form or editor hanging off a control → `Popover` + `useFloatingTrigger('dialog')`.
 *  Must be answered before going on → `Modal`. Immediate on/off → `Switch`; an option in a
 *  form or list → `Checkbox`. Text → `TextField` / `SearchField`. Off-default section →
 *  `SectionReset` in `Section` `actions`; long sections → `Section collapsible id=…`.
 *  Status → `Badge`; progress → `ProgressBar`; "this will not do what you asked" →
 *  `InlineAlert tone="warning"`, "it cannot be done" → `tone="danger"`.
 */

export {
  COMMAND_GROUPS,
  COMMANDS,
  commandSpec,
  shortcutOf,
  shortcutsOf,
  type CommandGroup,
  type CommandId,
  type CommandSpec
} from '@shared/commands'
export { formatShortcut } from '@shared/shortcuts'
export {
  allCommands,
  HANDLERS,
  isCommandEnabled,
  isTyping,
  runCommand,
  setCommandHost
} from './registry'
export type { CommandContext, CommandHandler, CommandHost, Handlers } from './types'
export { useCommands } from './useCommands'
