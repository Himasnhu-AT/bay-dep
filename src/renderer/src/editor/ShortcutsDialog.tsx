import { useMemo, useState, type ReactNode } from 'react'
import { Kbd, Modal, SearchField } from '@/components'
import { COMMAND_GROUPS, COMMANDS, formatShortcut, shortcutsOf } from '@/lib/commands'
import { MOUSE_GESTURES } from './mouseGestures'

export interface ShortcutsDialogProps {
  open: boolean
  onClose(): void
}

/**
 * Every command that has a key, grouped as the menu bar groups them — read straight from the
 * registry, so a key listed here is a key that works. Opened by Help › Keyboard Shortcuts, ⌘/
 * and ?. A search matches the command's name or the key as drawn ("⌘B", "delete").
 */
export function ShortcutsDialog({ open, onClose }: ShortcutsDialogProps): ReactNode {
  const [query, setQuery] = useState('')

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return COMMAND_GROUPS.map((group) => ({
      group,
      commands: COMMANDS.filter((command) => {
        if (command.group !== group) return false
        const keys = shortcutsOf(command)
        if (keys.length === 0) return false
        if (!needle) return true
        return (
          command.label.toLowerCase().includes(needle) ||
          keys.some(
            (key) =>
              key.toLowerCase().includes(needle) || formatShortcut(key).toLowerCase().includes(needle)
          )
        )
      })
    })).filter((entry) => entry.commands.length > 0)
  }, [query])

  // Drags have no key, so they are not commands; the sheet lists them after the keys, in the
  // same look, and the same search reaches them ("slip", "⌥", "edge").
  const gestures = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return MOUSE_GESTURES.map(({ group, gestures: list }) => ({
      group,
      gestures: list.filter(
        (gesture) => !needle || gesture.label.toLowerCase().includes(needle) || gesture.how.toLowerCase().includes(needle)
      )
    })).filter((entry) => entry.gestures.length > 0)
  }, [query])

  return (
    <Modal
      open={open}
      title="Keyboard shortcuts"
      width={560}
      onClose={() => {
        setQuery('')
        onClose()
      }}
    >
      <div className="border-b border-line p-3">
        {/* Focused on open: the sheet is opened to find a key, and focus on Close made the first
            keystroke of the search go nowhere. `Modal` leaves a field that took focus alone. */}
        <SearchField
          autoFocus
          label="Search shortcuts"
          placeholder="Search shortcuts…"
          value={query}
          onValueChange={setQuery}
        />
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 p-4">
        {groups.length === 0 && gestures.length === 0 && (
          <p className="col-span-2 text-[12px] text-ink-2">No shortcut matches “{query}”.</p>
        )}
        {groups.map(({ group, commands }) => (
          <section key={group} aria-labelledby={`shortcuts-${group}`}>
            <h3 id={`shortcuts-${group}`} className="mb-1.5 text-[11px] font-semibold text-ink-1">
              {group}
            </h3>
            <dl className="space-y-1">
              {commands.map((command) => (
                <div key={command.id} className="flex items-baseline justify-between gap-3">
                  <dt className="min-w-0 truncate text-[12px] text-ink-0">{command.label}</dt>
                  <dd className="flex shrink-0 items-baseline gap-1.5">
                    {shortcutsOf(command).map((key, index) => (
                      <span key={key} className="flex items-baseline gap-1.5">
                        {index > 0 && <span className="text-[10px] text-ink-2">or</span>}
                        <Kbd shortcut={key} className="text-[12px] text-ink-1" />
                      </span>
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
        {gestures.length > 0 && (
          <h3 className="col-span-2 -mb-2 border-t border-line pt-3 text-[11px] font-semibold text-ink-0">Mouse gestures</h3>
        )}
        {gestures.map(({ group, gestures: list }) => (
          <section key={`gestures-${group}`} aria-labelledby={`gestures-${group}`}>
            <h3 id={`gestures-${group}`} className="mb-1.5 text-[11px] font-semibold text-ink-1">
              {group}
            </h3>
            <dl className="space-y-1">
              {list.map((gesture) => (
                <div key={gesture.label} className="flex items-baseline justify-between gap-3">
                  <dt className="min-w-0 truncate text-[12px] text-ink-0" title={gesture.label}>
                    {gesture.label}
                  </dt>
                  <dd className="shrink-0">
                    <Kbd shortcut={gesture.how} className="text-[12px] text-ink-1" />
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Modal>
  )
}
