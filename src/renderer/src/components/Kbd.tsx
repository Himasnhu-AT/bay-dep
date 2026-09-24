import type { ReactNode } from 'react'
import { formatShortcut } from '@shared/shortcuts'
import { cn } from '@/lib/cn'

export interface KbdProps {
  /**
   * A binding in `@shared/shortcuts` spelling (`'Mod+B'`, `'Shift+Delete'`), drawn as the
   * platform shows it (`⌘B`, `⇧⌦`). Take it from the registry — `shortcutOf('clip.split')` —
   * rather than writing it again, so the hint cannot drift from the key that runs. Anything
   * that is not a spelling is drawn as given.
   */
  shortcut: string
  className?: string
}

/** A shortcut hint: in menus, tooltips and the shortcuts sheet. Dim, never a chip. */
export function Kbd({ shortcut, className }: KbdProps): ReactNode {
  return (
    <kbd className={cn('font-sans text-[11px] tracking-wide text-ink-2 tabular-nums', className)}>
      {formatShortcut(shortcut)}
    </kbd>
  )
}
