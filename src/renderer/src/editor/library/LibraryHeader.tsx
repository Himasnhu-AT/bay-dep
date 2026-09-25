import type { ReactNode } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { IconButton, Menu, useFloatingTrigger, type MenuEntry } from '@/components'

/**
 * A library panel's title strip, the way every Resolve panel has one: the panel's name, a count
 * beside it, its few everyday controls on the right, and a ⋯ option menu for the rare ones. It is
 * a band of its own (`chrome-raised`), so the panel reads as a panel rather than as more list.
 */
export function LibraryHeader({
  title,
  count,
  actions,
  menu,
  menuLabel
}: {
  title: string
  /** Shown after the title in the dim tone: "12", "3 open". */
  count?: string
  actions?: ReactNode
  /** The ⋯ menu's rows. No menu when empty. */
  menu?: readonly MenuEntry[]
  menuLabel?: string
}): ReactNode {
  const more = useFloatingTrigger()
  return (
    <header className="flex h-8 shrink-0 items-center gap-2 border-b border-line bg-chrome-raised px-3">
      <h2 className="min-w-0 truncate text-[12px] font-semibold text-ink-0">
        {title}
        {count && <span className="ml-1.5 font-normal text-ink-2 tabular-nums">{count}</span>}
      </h2>
      <span className="flex-1" />
      {actions && <div className="flex shrink-0 items-center gap-0.5">{actions}</div>}
      {menu && menu.length > 0 && (
        <>
          <IconButton
            {...more.triggerProps}
            label={menuLabel ?? `More ${title} options`}
            icon={<MoreHorizontal className="size-4" />}
          />
          <Menu {...more.surfaceProps} label={menuLabel ?? `${title} options`} align="end" items={menu} />
        </>
      )}
    </header>
  )
}
