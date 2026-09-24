/**
 * The application menu.
 *
 * The template is built as a plain value, separately from installing it, so the rule that
 * governs it can actually be checked: **every item either has a `role` or a `click`.** A
 * greyed-out or dead menu item is the most common way a desktop app tells a user it is a
 * prototype, and it is the kind of thing that survives review because nobody clicks every
 * item. `menu.test.ts` walks the template and fails on any leaf with neither.
 *
 * bay's own items come from `@shared/commands`, the list the renderer's key handler and the
 * shortcuts sheet also read, and a click sends `{ type: 'command', id }` for the renderer to
 * run. Main only lays them out and adds the system roles around them.
 *
 * **Accelerators.** A command whose keys the renderer owns (the default) is drawn with its
 * shortcut but `registerAccelerator: false`: a registered `S` or `Delete` would be taken from
 * every text field in the window, and a ⌘-combo the renderer also handles would run twice.
 * Only `accelerator: 'native'` commands (Open, Save, Export…) register — those must work while
 * a text field has focus, and the renderer's key handler ignores them.
 *
 * **Undo/Redo are commands, never `role: 'undo'`.** The role drives the *system text* undo
 * stack, which is right inside a text field and wrong everywhere else in an editor — a user
 * pressing ⌘Z expecting their last cut back would get their last typed character instead. The
 * keys are renderer-owned, so in a text field ⌘Z is left to the field; a menu click runs the
 * `edit.undo` handler, which undoes the text if a field has focus and the project otherwise.
 * Cut, Copy and Paste are commands for the same reason: as roles they could only ever act on text,
 * so ⌘C could not copy a clip. Their handlers hand the key back to a focused text field (or a text
 * selection) through `document.execCommand`, so text fields keep working. Select All stays a role.
 *
 * **No page zoom in View.** ⌘= and ⌘- zoom the *timeline*, as in every NLE; the zoomIn/zoomOut
 * roles registered them natively and zoomed the whole window instead. Actual Size (⌘0) stays, so
 * a window zoomed some other way (a pinch) can always be put back.
 *
 * **No View → Reload.** Standard in Electron templates, and in an editor ⌘R means "discard
 * everything since the last save". The accelerator is too close to ⌘T and ⌘E to leave armed.
 *
 * **File › Open Recent is the one part built from data, not the registry.** Main rebuilds the
 * whole menu when the recents change (`onRecentsChanged` in `project/store.ts`). A recent sends
 * `open-path`, the same command as a document double-clicked in Finder, so the renderer's
 * unsaved-changes guard runs before anything is replaced. With no recents the submenu holds one
 * disabled "No Recent Projects": the single item allowed to have neither role nor click
 * (`STATE_ITEM_IDS`), because it reports a state rather than offering an action, and a submenu
 * that opens onto nothing reads as broken.
 */

import type { MenuItemConstructorOptions } from 'electron'
import type { MenuCommand, RecentProject } from '@shared/ipc'
import { MENU_GROUPS, SEPARATOR, shortcutsOf, type CommandEntry, type CommandGroup, type CommandSpec } from '@shared/commands'
import { toAccelerator } from '@shared/shortcuts'

export interface MenuOptions {
  appName: string
  /** Sends a command to the focused window's renderer. */
  onCommand: (command: MenuCommand) => void
  /** DevTools is a developer affordance; it stays out of a release build's menu. */
  includeDevTools: boolean
  isMac: boolean
  /** File › Open Recent, newest first (`recentForMenu`). */
  recents: readonly Pick<RecentProject, 'name' | 'filePath' | 'folder'>[]
  /** Clear Menu. */
  onClearRecents: () => void
}

/**
 * Items that report a state and do nothing, so have neither role nor click. `menu.test.ts`
 * allows exactly these, disabled, and nothing else without an action.
 */
export const STATE_ITEM_IDS: ReadonlySet<string> = new Set(['recent.none'])

/** File › Open Recent's submenu. */
export function openRecentMenu(
  recents: MenuOptions['recents'],
  onCommand: MenuOptions['onCommand'],
  onClear: () => void
): MenuItemConstructorOptions[] {
  const clear: MenuItemConstructorOptions = {
    id: 'recent.clear',
    label: 'Clear Menu',
    enabled: recents.length > 0,
    click: () => onClear()
  }
  if (recents.length === 0) {
    return [{ id: 'recent.none', label: 'No Recent Projects', enabled: false }, SEP, clear]
  }
  return [
    ...recents.map(
      (recent): MenuItemConstructorOptions => ({
        label: recent.name || recent.filePath,
        // The folder tells two projects of one name apart. macOS 14.4+ draws it under the name.
        ...(recent.folder ? { sublabel: recent.folder } : {}),
        click: () => onCommand({ type: 'open-path', path: recent.filePath })
      })
    ),
    SEP,
    clear
  ]
}

/** On macOS these live in the application menu, where every Mac app keeps them. */
const APP_MENU_IDS = new Set(['app.settings'])

const SEP: MenuItemConstructorOptions = { type: 'separator' }

export function menuTemplate(options: MenuOptions): MenuItemConstructorOptions[] {
  const { appName, onCommand, includeDevTools, isMac, recents, onClearRecents } = options

  const item = (spec: CommandSpec): MenuItemConstructorOptions => {
    const shortcut = shortcutsOf(spec)[0]
    const accelerator = shortcut === undefined ? undefined : toAccelerator(shortcut)
    return {
      id: spec.id,
      label: spec.label,
      click: () => onCommand({ type: 'command', id: spec.id }),
      ...(accelerator
        ? { accelerator, registerAccelerator: spec.accelerator === 'native' }
        : {})
    }
  }

  /** A group's entries as menu items: hidden ones dropped, separators never doubled. */
  const entries = (list: readonly CommandEntry[], skip: (spec: CommandSpec) => boolean) => {
    const out: MenuItemConstructorOptions[] = []
    for (const entry of list) {
      if (entry === SEPARATOR) {
        if (out.length > 0 && out[out.length - 1]?.type !== 'separator') out.push(SEP)
        continue
      }
      if (entry.menu === false || skip(entry)) continue
      out.push(item(entry))
    }
    while (out[out.length - 1]?.type === 'separator') out.pop()
    return out
  }

  const commandsOf = (group: CommandGroup): MenuItemConstructorOptions[] => {
    const list = MENU_GROUPS.find((g) => g.group === group)?.entries ?? []
    return entries(list, (spec) => isMac && APP_MENU_IDS.has(spec.id))
  }
  const withSep = (items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] =>
    items.length > 0 ? [...items, SEP] : []

  const appCommands = MENU_GROUPS.flatMap((g) =>
    entries(g.entries, (spec) => !APP_MENU_IDS.has(spec.id))
  )

  const appMenu: MenuItemConstructorOptions[] = isMac
    ? [
        {
          label: appName,
          submenu: [
            { role: 'about' },
            SEP,
            ...withSep(appCommands),
            { role: 'services' },
            SEP,
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            SEP,
            { role: 'quit' }
          ]
        }
      ]
    : []

  const fileCommands = commandsOf('File')
  // Open Recent directly under Open…, where every Mac app has it.
  const afterOpen = fileCommands.findIndex((entry) => entry.id === 'file.open') + 1
  fileCommands.splice(afterOpen > 0 ? afterOpen : fileCommands.length, 0, {
    id: 'file.openRecent',
    label: 'Open Recent',
    submenu: openRecentMenu(recents, onCommand, onClearRecents)
  })
  const file: MenuItemConstructorOptions = {
    label: 'File',
    submenu: [...withSep(fileCommands), isMac ? { role: 'close' } : { role: 'quit' }]
  }

  const edit: MenuItemConstructorOptions = {
    label: 'Edit',
    submenu: [
      ...withSep(commandsOf('Edit')),
      // Text-field editing. See the header for why Undo/Redo and Cut/Copy/Paste above are
      // commands, not roles. Paste and Match Style is gone with them: bay has no styled text,
      // and its registered ⌥⇧⌘V would take the key from Paste Attributes.
      { role: 'delete' },
      SEP,
      { role: 'selectAll' }
    ]
  }

  const plain = (group: CommandGroup): MenuItemConstructorOptions[] => {
    const submenu = commandsOf(group)
    return submenu.length > 0 ? [{ label: group, submenu }] : []
  }

  const view: MenuItemConstructorOptions = {
    label: 'View',
    submenu: [
      ...withSep(commandsOf('View')),
      { role: 'resetZoom' },
      SEP,
      { role: 'togglefullscreen' },
      ...(includeDevTools ? ([SEP, { role: 'toggleDevTools' }] as MenuItemConstructorOptions[]) : [])
    ]
  }

  const window: MenuItemConstructorOptions = {
    label: 'Window',
    submenu: [
      { role: 'minimize' },
      { role: 'zoom' },
      ...(isMac
        ? ([SEP, { role: 'front' }] as MenuItemConstructorOptions[])
        : ([{ role: 'close' }] as MenuItemConstructorOptions[]))
    ]
  }

  const help: MenuItemConstructorOptions[] = plain('Help').map((menu) => ({ ...menu, role: 'help' }))

  return [
    ...appMenu,
    file,
    edit,
    ...plain('Clip'),
    ...plain('Mark'),
    ...plain('Timeline'),
    ...plain('Playback'),
    view,
    window,
    ...help
  ]
}

/**
 * Every leaf item in a template, flattened. Exported for the test that enforces the wiring
 * rule; a menu is a tree and the rule applies to all of it, not to the top level.
 */
export function menuLeaves(
  template: readonly MenuItemConstructorOptions[]
): MenuItemConstructorOptions[] {
  const out: MenuItemConstructorOptions[] = []
  for (const item of template) {
    if (Array.isArray(item.submenu)) out.push(...menuLeaves(item.submenu))
    else out.push(item)
  }
  return out
}
