import { useRef, type ReactNode } from 'react'
import { Check, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/cn'
import { FloatingSurface, type Anchor, type Dismiss } from './Floating'
import { Kbd } from './Kbd'
import type { FloatingAlign, FloatingSide } from './placement'

export interface MenuAction {
  kind?: 'item'
  label: string
  onSelect(): void
  icon?: ReactNode
  /** A binding in `@shared/shortcuts` spelling, drawn with `Kbd`: `shortcutOf('clip.split')`. */
  shortcut?: string
  disabled?: boolean
  /** Destructive: drawn in `danger`. */
  danger?: boolean
  /** A toggle. Any item that sets it (true or false) makes the menu reserve a check column. */
  checked?: boolean
  /**
   * The row opens more rows (the clip menu's Trim, Audio, Ripple Delete pages) and is drawn with
   * a right-aligned chevron. A label ending in " ›" means the same, so the callers written before
   * this field keep working; the character is taken off the label and drawn as the icon.
   */
  submenu?: boolean
}

const SUBMENU_SUFFIX = ' ›'

/** The row's label without a trailing " ›", and whether it opens more rows. */
function rowOf(entry: MenuAction): { label: string; submenu: boolean } {
  const suffixed = entry.label.endsWith(SUBMENU_SUFFIX)
  return {
    label: suffixed ? entry.label.slice(0, -SUBMENU_SUFFIX.length) : entry.label,
    submenu: entry.submenu ?? suffixed
  }
}

export type MenuEntry = MenuAction | { kind: 'separator' } | { kind: 'label'; label: string }

export interface MenuProps {
  open: boolean
  onClose(): void
  /** The trigger element (a dropdown) or a point in viewport coordinates (a context menu). */
  anchor: Anchor | null
  items: readonly MenuEntry[]
  /** The menu's accessible name — "Clip", "Project actions". */
  label: string
  side?: FloatingSide
  align?: FloatingAlign
  /** `'first'` when opened from the keyboard; `'surface'` for a pointer (no row lit yet). */
  initialFocus?: 'first' | 'surface'
  className?: string
}

const ITEM_SELECTOR = '[data-menu-item]:not([aria-disabled="true"])'

function itemsIn(menu: HTMLElement | null): HTMLElement[] {
  return menu ? Array.from(menu.querySelectorAll<HTMLElement>(ITEM_SELECTOR)) : []
}

/**
 * A menu: rows of actions in a floating surface, with the desktop keyboard contract — focus
 * moves in, ↑/↓/Home/End move (wrapping), a letter jumps to the next row starting with it,
 * Enter/Space choose, Escape and Tab close and hand focus back to the trigger. It closes on a
 * pointer-down outside, the window losing focus, scroll and resize, and is kept on screen.
 *
 * Styled as the Composer's `@`/`/` list: `surface-2`, `line-strong`, `shadow-pop`, inset rounded
 * rows lit `surface-4`. A dropdown takes its wiring from `useFloatingTrigger()`; a right-click
 * menu is `ContextMenu`.
 */
export function Menu({
  open,
  onClose,
  anchor,
  items,
  label,
  side,
  align,
  initialFocus = 'surface',
  className
}: MenuProps): ReactNode {
  const surface = useRef<HTMLDivElement | null>(null)
  const dismiss = useRef<Dismiss | null>(null)
  const checkColumn = items.some((entry) => entry.kind !== 'separator' && entry.kind !== 'label' && entry.checked !== undefined)

  const move = (to: (index: number, count: number) => number): void => {
    const rows = itemsIn(surface.current)
    if (rows.length === 0) return
    const at = rows.indexOf(document.activeElement as HTMLElement)
    rows[to(at, rows.length)]?.focus({ preventScroll: true })
  }

  const choose = (item: MenuAction): void => {
    if (item.disabled) return
    // Close first, so focus is back on the trigger before the action runs — an action that
    // opens a dialog then takes focus from there, and returns it there.
    dismiss.current?.('select')
    item.onSelect()
  }

  let actionIndex = -1
  return (
    <FloatingSurface
      open={open}
      anchor={anchor}
      onClose={onClose}
      side={side}
      align={align}
      role="menu"
      label={label}
      surfaceRef={surface}
      dismissRef={dismiss}
      onPlaced={(element) => {
        if (initialFocus === 'first') itemsIn(element)[0]?.focus({ preventScroll: true })
        else element.focus({ preventScroll: true })
      }}
      onKeyDown={(event) => {
        switch (event.key) {
          case 'ArrowDown':
            event.preventDefault()
            move((at, n) => (at + 1) % n)
            return
          case 'ArrowUp':
            event.preventDefault()
            move((at, n) => (at <= 0 ? n - 1 : at - 1))
            return
          case 'Home':
            event.preventDefault()
            move(() => 0)
            return
          case 'End':
            event.preventDefault()
            move((_, n) => n - 1)
            return
          case 'Tab':
            event.preventDefault()
            dismiss.current?.('tab')
            return
          default:
            break
        }
        // Typeahead: a printable letter jumps to the next row whose label starts with it.
        if (event.key.length === 1 && /\S/.test(event.key) && !event.metaKey && !event.ctrlKey) {
          const rows = itemsIn(surface.current)
          const at = rows.indexOf(document.activeElement as HTMLElement)
          const needle = event.key.toLowerCase()
          for (let step = 1; step <= rows.length; step++) {
            const row = rows[(at + step) % rows.length]
            if (row?.dataset.menuLabel?.toLowerCase().startsWith(needle)) {
              row.focus({ preventScroll: true })
              break
            }
          }
        }
      }}
      className={cn(
        'max-h-[min(24rem,calc(100vh-16px))] min-w-44 max-w-80 overflow-y-auto overscroll-contain rounded-md border border-line-strong bg-surface-2 py-1 shadow-pop',
        className
      )}
    >
      {items.map((entry, index) => {
        if (entry.kind === 'separator') {
          return <div key={`sep-${index}`} role="separator" className="mx-1 my-1 h-px bg-line" />
        }
        if (entry.kind === 'label') {
          return (
            <div key={`label-${index}`} role="presentation" className="px-2.5 pt-1.5 pb-1 text-[11px] text-ink-2">
              {entry.label}
            </div>
          )
        }
        actionIndex++
        const toggle = entry.checked !== undefined
        const row = rowOf(entry)
        return (
          <div
            key={`${actionIndex}-${entry.label}`}
            data-menu-item=""
            data-menu-label={row.label}
            role={toggle ? 'menuitemcheckbox' : 'menuitem'}
            aria-haspopup={row.submenu ? 'menu' : undefined}
            aria-checked={toggle ? entry.checked : undefined}
            aria-disabled={entry.disabled || undefined}
            tabIndex={-1}
            onClick={() => choose(entry)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                choose(entry)
              }
            }}
            // The pointer and the keyboard share one highlight: hovering a row focuses it, so an
            // arrow key continues from where the mouse is, as a native menu does.
            onPointerMove={(event) => {
              if (!entry.disabled && document.activeElement !== event.currentTarget) {
                event.currentTarget.focus({ preventScroll: true })
              }
            }}
            onPointerLeave={() => surface.current?.focus({ preventScroll: true })}
            className={cn(
              't-press mx-1 flex h-7 cursor-default items-center gap-2 rounded-sm px-2 text-[12px] outline-none select-none',
              entry.disabled
                ? 'text-ink-3'
                : entry.danger
                  ? 'text-danger focus:bg-danger/12 active:scale-[0.98]'
                  : 'text-ink-0 focus:bg-surface-4 active:scale-[0.98]'
            )}
          >
            {checkColumn && (
              <span aria-hidden="true" className="flex size-3.5 shrink-0 items-center justify-center">
                {entry.checked && <Check className="size-3.5" />}
              </span>
            )}
            {entry.icon && (
              <span aria-hidden="true" className={cn('flex shrink-0', !entry.danger && 'text-ink-2')}>
                {entry.icon}
              </span>
            )}
            <span className="min-w-0 flex-1 truncate">{row.label}</span>
            {entry.shortcut && <Kbd shortcut={entry.shortcut} className="ml-4 shrink-0" />}
            {row.submenu && (
              <ChevronRight aria-hidden="true" className={cn('ml-2 size-3.5 shrink-0', !entry.disabled && 'text-ink-2')} />
            )}
          </div>
        )
      })}
    </FloatingSurface>
  )
}

export interface ContextMenuProps extends Omit<MenuProps, 'anchor' | 'open' | 'side' | 'align'> {
  /** Where the pointer was, in viewport coordinates (`event.clientX/Y`); null when closed. */
  at: { x: number; y: number } | null
}

/**
 * A menu at the pointer: open it from `onContextMenu` with `{ x: event.clientX, y:
 * event.clientY }` (and from Shift+F10 on a focused target with that element's corner, passing
 * `initialFocus: 'first'`). Opens down-right of the point, flipping at the window edges.
 */
export function ContextMenu({ at, ...props }: ContextMenuProps): ReactNode {
  return <Menu {...props} open={at !== null} anchor={at} />
}
