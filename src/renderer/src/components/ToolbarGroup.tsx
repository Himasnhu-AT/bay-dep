import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react'
import { cn } from '@/lib/cn'
import { Tooltip, type TooltipSide } from './Tooltip'

export interface ToolbarGroupProps {
  /** The group's name. Shown as a caption under the buttons when `caption`, always its aria-label. */
  label: string
  caption?: boolean
  children: ReactNode
  className?: string
}

/**
 * A run of related toolbar buttons with a separator after it, the way Resolve's timeline
 * toolbar groups Tools | Edit | Modes | Markers | Zoom. The separator is the group's own right
 * edge, so the last group of a bar drops it with `last:border-r-0`.
 */
export function ToolbarGroup({ label, caption = false, children, className }: ToolbarGroupProps): ReactNode {
  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        'flex shrink-0 flex-col items-stretch justify-center border-r border-line-strong px-1.5 last:border-r-0',
        className
      )}
    >
      <div className="flex items-center gap-0.5">{children}</div>
      {caption && (
        <span className="mt-0.5 text-center text-[9px] leading-none tracking-wide text-ink-2 uppercase">
          {label}
        </span>
      )}
    </div>
  )
}

export interface ToolButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** The action's name: visible beside the icon when `showLabel`, and always its accessible name. */
  label: string
  icon: ReactNode
  showLabel?: boolean
  /** `@shared/shortcuts` spelling, shown in the tooltip. */
  shortcut?: string
  /** A toggle or a tool that is currently on. Emits `aria-pressed`. */
  active?: boolean
  tooltipSide?: TooltipSide
  ref?: Ref<HTMLButtonElement>
}

/**
 * A toolbar button with an icon and, room permitting, its name. The labelled form is the point:
 * an icon-only strip is what made bay's actions hard to find, and Resolve's interface toolbar
 * shows words under every icon.
 */
export function ToolButton({
  label,
  icon,
  showLabel = true,
  shortcut,
  active,
  tooltipSide = 'bottom',
  className,
  ...props
}: ToolButtonProps): ReactNode {
  return (
    <Tooltip label={label} shortcut={shortcut} side={tooltipSide}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        className={cn(
          'no-drag t-press inline-flex h-7 shrink-0 items-center justify-center gap-1.5 rounded-sm px-1.5 text-[11px] font-medium',
          'disabled:pointer-events-none disabled:opacity-35',
          active ? 'bg-accent/16 text-accent hover:bg-accent/22' : 'text-ink-1 hover:bg-surface-3 hover:text-ink-0',
          !showLabel && 'w-7 px-0',
          className
        )}
        {...props}
      >
        {icon}
        {showLabel && <span className="whitespace-nowrap">{label}</span>}
      </button>
    </Tooltip>
  )
}
