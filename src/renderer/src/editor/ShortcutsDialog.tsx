import { useMemo, useState, type ReactNode } from 'react'
import { Kbd, Modal, SearchField } from '@/components'
import { cn } from '@/lib/cn'
import { COMMAND_GROUPS, COMMANDS, formatShortcut, shortcutsOf } from '@/lib/commands'
import { MOUSE_GESTURES } from './mouseGestures'

export interface ShortcutsDialogProps {
  open: boolean
  onClose(): void
}

/**
 * Every command that has a key, grouped as the menu bar groups them (File, Edit, …, Workspace,
 * Help) — read straight from the registry, so a key listed here is a key that works. Opened by
 * Help › Keyboard Shortcuts, ⌘/ and ?; the same sheet is Preferences › Keyboard.
 */
export function ShortcutsDialog({ open, onClose }: ShortcutsDialogProps): ReactNode {
  return (
    <Modal open={open} title="Keyboard shortcuts" width={660} onClose={onClose}>
      {/* Mounted per opening, so the search starts empty each time. */}
      {open && <ShortcutsSheet autoFocus />}
    </Modal>
  )
}

export interface ShortcutsSheetProps {
  /**
   * Focus the search on mount: the dialog is opened to find a key, and focus on Close made the
   * first keystroke of the search go nowhere. Embedded in Preferences it stays off, so arriving
   * on the page does not take focus from the page list.
   */
  autoFocus?: boolean
  className?: string
}

/**
 * The searchable sheet itself. A search matches the command's name, its menu group ("workspace"
 * lists that whole group), or the key as drawn ("⌘B", "delete").
 */
export function ShortcutsSheet({ autoFocus = false, className }: ShortcutsSheetProps): ReactNode {
  const [query, setQuery] = useState('')
  const needle = query.trim().toLowerCase()

  const groups = useMemo(
    () =>
      COMMAND_GROUPS.map((group) => {
        const groupMatches = needle !== '' && group.toLowerCase().includes(needle)
        return {
          group,
          commands: COMMANDS.filter((command) => {
            if (command.group !== group) return false
            const keys = shortcutsOf(command)
            if (keys.length === 0) return false
            if (!needle || groupMatches) return true
            return (
              command.label.toLowerCase().includes(needle) ||
              keys.some((key) => key.toLowerCase().includes(needle) || formatShortcut(key).toLowerCase().includes(needle))
            )
          })
        }
      }).filter((entry) => entry.commands.length > 0),
    [needle]
  )

  // Drags have no key, so they are not commands; the sheet lists them after the keys, in the
  // same look, and the same search reaches them ("slip", "⌥", "edge").
  const gestures = useMemo(
    () =>
      MOUSE_GESTURES.map(({ group, gestures: list }) => ({
        group,
        gestures: list.filter(
          (gesture) =>
            !needle ||
            group.toLowerCase().includes(needle) ||
            gesture.label.toLowerCase().includes(needle) ||
            gesture.how.toLowerCase().includes(needle)
        )
      })).filter((entry) => entry.gestures.length > 0),
    [needle]
  )

  return (
    <div className={cn('flex flex-col', className)}>
      <div className="border-b border-line p-3">
        {/* `Modal` leaves a field that took focus alone. */}
        <SearchField
          autoFocus={autoFocus}
          label="Search shortcuts"
          placeholder="Search by command, menu or key…"
          value={query}
          onValueChange={setQuery}
        />
      </div>
      <div className="grid grid-cols-2 items-start gap-x-5 gap-y-4 p-4">
        {groups.length === 0 && gestures.length === 0 && (
          <p className="col-span-2 text-[12px] text-ink-2">No shortcut matches “{query}”.</p>
        )}
        {groups.map(({ group, commands }) => (
          <SheetGroup key={group} id={`shortcuts-${group}`} title={group} count={commands.length}>
            {commands.map((command) => (
              <SheetRow key={command.id} label={command.label}>
                {shortcutsOf(command).map((key, index) => (
                  <span key={key} className="flex items-baseline gap-1.5">
                    {index > 0 && <span className="text-[10px] text-ink-2">or</span>}
                    <Kbd shortcut={key} className="text-[12px] text-ink-1" />
                  </span>
                ))}
              </SheetRow>
            ))}
          </SheetGroup>
        ))}
        {gestures.length > 0 && (
          <h3 className="col-span-2 -mb-1 border-t border-line pt-3 text-[12px] font-semibold text-ink-0">Mouse gestures</h3>
        )}
        {gestures.map(({ group, gestures: list }) => (
          <SheetGroup key={`gestures-${group}`} id={`gestures-${group}`} title={group} count={list.length}>
            {list.map((gesture) => (
              <SheetRow key={gesture.label} label={gesture.label}>
                <Kbd shortcut={gesture.how} className="text-[12px] text-ink-1" />
              </SheetRow>
            ))}
          </SheetGroup>
        ))}
      </div>
    </div>
  )
}

function SheetGroup({ id, title, count, children }: { id: string; title: string; count: number; children: ReactNode }): ReactNode {
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-baseline justify-between px-0.5">
        <h3 id={id} className="text-[11px] font-semibold tracking-wide text-ink-1 uppercase">
          {title}
        </h3>
        <span className="text-[10px] text-ink-2 tabular-nums">{count}</span>
      </div>
      <dl className="flex flex-col divide-y divide-line overflow-hidden rounded-md border border-line bg-surface-0/40">
        {children}
      </dl>
    </section>
  )
}

function SheetRow({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div className="flex min-h-7 items-center justify-between gap-3 px-2.5 py-1">
      <dt className="min-w-0 truncate text-[12px] text-ink-0" title={label}>
        {label}
      </dt>
      <dd className="flex shrink-0 items-baseline gap-1.5">{children}</dd>
    </div>
  )
}
