import { useEffect, useRef } from 'react'
import { commandForKey, commandSpec } from '@shared/commands'
import { bay } from '@/lib/bay'
import { isTyping, runCommand, setCommandHost } from './registry'
import type { CommandHost } from './types'
import { keyMayRun, menuCommandMayRun } from './keyGate'
import { useEditor } from '@/store/editor'

/**
 * Every shortcut and every menu command in the app, mounted once at the root.
 *
 * Keys go through `commandForKey` (`@shared/commands`), which holds the rules: nothing fires
 * while a text field has focus — otherwise typing "s" into a clip name silently razors the
 * timeline — and native-accelerator commands are left to the menu. Escape is the one key that
 * works everywhere, because Escape is how you get out; it goes to `host.escape`.
 *
 * Menu clicks arrive as `{ type: 'command', id }` over the app-menu channel and run through the
 * same `runCommand`, so a menu item and its key cannot do different things. An open dialog
 * refuses them as it refuses keys (`menuCommandMayRun`), with a note rather than silence.
 */
export function useCommands(host: CommandHost): void {
  // Read through a ref so the listeners are registered once, not on every parent render.
  const latest = useRef(host)
  latest.current = host

  useEffect(() => {
    const proxy: CommandHost = {
      save: () => latest.current.save(),
      saveAs: () => latest.current.saveAs(),
      open: () => latest.current.open(),
      newProject: () => latest.current.newProject(),
      importMedia: () => latest.current.importMedia(),
      openExport: () => latest.current.openExport(),
      openShortcuts: () => latest.current.openShortcuts(),
      escape: () => latest.current.escape()
    }
    const uninstall = setCommandHost(proxy)

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        proxy.escape()
        return
      }
      const typing = isTyping(event.target)
      const spec = commandForKey(event, typing)
      if (!spec) return
      const modalOpen = document.querySelector('[aria-modal="true"]') !== null
      const whileTyping = 'whileTyping' in spec && spec.whileTyping === true
      const whileModal = !('whileModal' in spec && spec.whileModal === false)
      if (!keyMayRun({ defaultPrevented: event.defaultPrevented, modalOpen, typing, whileTyping, whileModal })) return
      // Claimed even when the command is disabled: Space would otherwise activate the last
      // button clicked, and arrows would scroll a panel.
      event.preventDefault()
      runCommand(spec.id, 'key', typing)
    }
    window.addEventListener('keydown', onKeyDown)

    const unsubscribe = bay()?.app.onMenuCommand((command) => {
      if (command.type !== 'command') return
      const spec = commandSpec(command.id)
      const allowed = menuCommandMayRun({
        modalOpen: document.querySelector('[aria-modal="true"]') !== null,
        typing: isTyping(document.activeElement),
        whileTyping: spec?.whileTyping === true,
        native: spec?.accelerator === 'native',
        whileModal: spec?.whileModal !== false
      })
      if (!allowed) {
        // Said, not swallowed: a menu item that does nothing reads as broken.
        useEditor.getState().notify(`Close the dialog first to use ${spec?.label ?? 'that command'}.`, 'info')
        return
      }
      runCommand(command.id, 'menu')
    })

    return () => {
      uninstall()
      window.removeEventListener('keydown', onKeyDown)
      unsubscribe?.()
    }
  }, [])
}
