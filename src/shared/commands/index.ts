/**
 * Every command bay has, declared once — the menu bar, the key handler and the shortcuts sheet
 * all read this list, so a shortcut shown anywhere is the one that runs.
 *
 * To add a command: one entry in the group's file here (`clip.ts`, `mark.ts`, …) and one
 * handler under the same id in `src/renderer/src/lib/commands/<group>.ts`. Typecheck fails
 * until both exist. A new group is a new file in each place plus one line in each index.
 * The full how-to is the header of `src/renderer/src/lib/commands/index.ts`.
 */

import { canonicalShortcut, matchesShortcut, parseShortcut, type KeyLike } from '../shortcuts'
import { clipCommands } from './clip'
import { editCommands } from './edit'
import { fileCommands } from './file'
import { helpCommands } from './help'
import { markCommands } from './mark'
import { playbackCommands } from './playback'
import { timelineCommands } from './timeline'
import { COMMAND_GROUPS, SEPARATOR, type CommandEntry, type CommandGroup, type CommandSpec } from './types'
import { viewCommands } from './view'

export { COMMAND_GROUPS, SEPARATOR, type CommandEntry, type CommandGroup, type CommandSpec }

/** Each group's entries in menu order, separators included. One line per group file. */
const BY_GROUP = {
  File: fileCommands,
  Edit: editCommands,
  Clip: clipCommands,
  Mark: markCommands,
  Timeline: timelineCommands,
  Playback: playbackCommands,
  View: viewCommands,
  Help: helpCommands
} as const satisfies Record<CommandGroup, readonly CommandEntry[]>

type AnyEntry = (typeof BY_GROUP)[CommandGroup][number]

/** The id of every declared command — the renderer's handler map is keyed by exactly these. */
export type CommandId = Extract<AnyEntry, { id: string }>['id']

export const MENU_GROUPS: readonly { group: CommandGroup; entries: readonly CommandEntry[] }[] =
  COMMAND_GROUPS.map((group) => ({ group, entries: BY_GROUP[group] }))

export const COMMANDS: readonly CommandSpec[] = MENU_GROUPS.flatMap(({ entries }) =>
  entries.filter((entry): entry is CommandSpec => entry !== SEPARATOR)
)

const BY_ID = new Map<string, CommandSpec>(COMMANDS.map((spec) => [spec.id, spec]))

export function commandSpec(id: CommandId): CommandSpec
export function commandSpec(id: string): CommandSpec | undefined
export function commandSpec(id: string): CommandSpec | undefined {
  return BY_ID.get(id)
}

export function isCommandId(id: string): id is CommandId {
  return BY_ID.has(id)
}

/** Every binding of a command, primary first. */
export function shortcutsOf(spec: Pick<CommandSpec, 'shortcut'> | undefined): readonly string[] {
  const shortcut = spec?.shortcut
  if (shortcut === undefined) return []
  return typeof shortcut === 'string' ? [shortcut] : shortcut
}

/**
 * The binding a tooltip or menu shows for a command, in `@shared/shortcuts` spelling — pass it
 * to `formatShortcut`, `<Kbd shortcut>` or a Tooltip/IconButton `shortcut` prop.
 */
export function shortcutOf(id: CommandId): string | undefined {
  return shortcutsOf(BY_ID.get(id))[0]
}

/**
 * The command a key press runs in the renderer, or undefined.
 *
 * The dispatch rules, in one pure place: native-accelerator commands are main's (the menu
 * sends them), and nothing but a `whileTyping` command fires while a text field has focus —
 * otherwise typing "s" into a clip name razors the timeline.
 */
export function commandForKey(
  event: KeyLike,
  typing: boolean,
  specs: readonly CommandSpec[] = COMMANDS
): CommandSpec | undefined {
  for (const spec of specs) {
    if (spec.accelerator === 'native') continue
    if (typing && !spec.whileTyping) continue
    for (const shortcut of shortcutsOf(spec)) {
      const parsed = parseShortcut(shortcut)
      if (parsed && matchesShortcut(parsed, event)) return spec
    }
  }
  return undefined
}

export interface ShortcutProblem {
  shortcut: string
  ids: string[]
  problem: 'unparseable' | 'duplicate'
}

/**
 * Bindings that cannot work: spellings that do not parse, and two commands (or one command
 * twice) claiming the same keys. Pure over a list so the test can prove it against a specimen.
 */
export function shortcutProblems(specs: readonly CommandSpec[]): ShortcutProblem[] {
  const problems: ShortcutProblem[] = []
  const claimed = new Map<string, { shortcut: string; ids: string[] }>()
  for (const spec of specs) {
    for (const shortcut of shortcutsOf(spec)) {
      const parsed = parseShortcut(shortcut)
      if (!parsed) {
        problems.push({ shortcut, ids: [spec.id], problem: 'unparseable' })
        continue
      }
      const key = canonicalShortcut(parsed)
      const entry = claimed.get(key)
      if (entry) entry.ids.push(spec.id)
      else claimed.set(key, { shortcut, ids: [spec.id] })
    }
  }
  for (const { shortcut, ids } of claimed.values()) {
    if (ids.length > 1) problems.push({ shortcut, ids, problem: 'duplicate' })
  }
  return problems
}
