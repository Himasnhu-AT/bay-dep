/**
 * The application menu.
 *
 * The template is built as a plain value, separately from installing it, so the rule that
 * governs it can actually be checked: **every item either has a `role` or a `click`.** A
 * greyed-out or dead menu item is the most common way a desktop app tells a user it is a
 * prototype, and it is the kind of thing that survives review because nobody clicks every
 * item. `menu.test.ts` walks the template and fails on any leaf with neither.
 *
 * Two deliberate absences:
 *
 * - **No Edit → Undo/Redo.** The `role: 'undo'` items drive the *system text* undo stack,
 *   which is the right behaviour inside a text field and the wrong behaviour everywhere else
 *   in an editor — a user pressing Cmd+Z expecting their last cut back would get their last
 *   typed character instead. bay's undo lives in the renderer's store and has no channel
 *   here, so the items are absent rather than present and wrong.
 * - **No View → Reload.** Standard in Electron templates, and in an editor Cmd+R means
 *   "discard everything since the last save". The accelerator is too close to Cmd+T and Cmd+E
 *   to leave armed for that.
 */

import type { MenuItemConstructorOptions } from 'electron'
import type { MenuCommand } from '@shared/ipc'

export interface MenuOptions {
  appName: string
  /** Sends a command to the focused window's renderer. */
  onCommand: (command: MenuCommand) => void
  /** DevTools is a developer affordance; it stays out of a release build's menu. */
  includeDevTools: boolean
  isMac: boolean
}

export function menuTemplate(options: MenuOptions): MenuItemConstructorOptions[] {
  const { appName, onCommand, includeDevTools, isMac } = options
  const send = (command: MenuCommand) => () => onCommand(command)

  const appMenu: MenuItemConstructorOptions[] = isMac
    ? [
        {
          label: appName,
          submenu: [
            { role: 'about' },
            { type: 'separator' },
            { role: 'services' },
            { type: 'separator' },
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            { type: 'separator' },
            { role: 'quit' }
          ]
        }
      ]
    : []

  const file: MenuItemConstructorOptions = {
    label: 'File',
    submenu: [
      { label: 'Open…', accelerator: 'CmdOrCtrl+O', click: send({ type: 'open' }) },
      { type: 'separator' },
      { label: 'Save', accelerator: 'CmdOrCtrl+S', click: send({ type: 'save' }) },
      { label: 'Save As…', accelerator: 'CmdOrCtrl+Shift+S', click: send({ type: 'save-as' }) },
      { type: 'separator' },
      { label: 'Import Media…', accelerator: 'CmdOrCtrl+I', click: send({ type: 'import' }) },
      { label: 'Export…', accelerator: 'CmdOrCtrl+E', click: send({ type: 'export' }) },
      { type: 'separator' },
      isMac ? { role: 'close' } : { role: 'quit' }
    ]
  }

  const edit: MenuItemConstructorOptions = {
    label: 'Edit',
    submenu: [
      // Text-field editing only — see the header for why undo/redo are not here.
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      ...(isMac ? ([{ role: 'pasteAndMatchStyle' }] as MenuItemConstructorOptions[]) : []),
      { role: 'delete' },
      { type: 'separator' },
      { role: 'selectAll' }
    ]
  }

  const view: MenuItemConstructorOptions = {
    label: 'View',
    submenu: [
      { role: 'resetZoom' },
      { role: 'zoomIn' },
      { role: 'zoomOut' },
      { type: 'separator' },
      { role: 'togglefullscreen' },
      { type: 'separator' },
      {
        label: 'Toggle Debug Mode',
        accelerator: 'CmdOrCtrl+Alt+D',
        click: send({ type: 'toggle-debug' })
      },
      ...(includeDevTools
        ? ([{ type: 'separator' }, { role: 'toggleDevTools' }] as MenuItemConstructorOptions[])
        : [])
    ]
  }

  const window: MenuItemConstructorOptions = {
    label: 'Window',
    submenu: [
      { role: 'minimize' },
      { role: 'zoom' },
      ...(isMac
        ? ([{ type: 'separator' }, { role: 'front' }] as MenuItemConstructorOptions[])
        : ([{ role: 'close' }] as MenuItemConstructorOptions[]))
    ]
  }

  return [...appMenu, file, edit, view, window]
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
