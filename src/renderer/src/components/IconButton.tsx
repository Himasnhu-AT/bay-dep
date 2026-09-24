import type { ButtonHTMLAttributes, ReactNode, Ref } from 'react'
import { cn } from '@/lib/cn'
import { Tooltip, type TooltipSide } from './Tooltip'

export type IconButtonVariant = 'ghost' | 'subtle' | 'primary' | 'danger'
export type IconButtonSize = 'xs' | 'sm' | 'md'

const VARIANTS: Record<IconButtonVariant, string> = {
  ghost: 'bg-transparent text-ink-1 hover:bg-surface-3 hover:text-ink-0',
  subtle: 'bg-surface-2 text-ink-1 border border-line hover:bg-surface-3 hover:text-ink-0',
  primary: 'bg-accent text-accent-ink',
  danger: 'bg-transparent text-ink-1 hover:bg-danger/12 hover:text-danger'
}

const SIZES: Record<IconButtonSize, string> = {
  xs: 'size-5',
  sm: 'size-7',
  md: 'size-8'
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required: this control has no visible text, so it must carry its name some other way. */
  label: string
  /** Shown in the tooltip; `@shared/shortcuts` spelling, ideally `shortcutOf(commandId)`. */
  shortcut?: string
  /** React 19 passes `ref` as a prop; it reaches the `<button>` (e.g. a menu trigger). */
  ref?: Ref<HTMLButtonElement>
  icon: ReactNode
  variant?: IconButtonVariant
  size?: IconButtonSize
  /** Set only on toggle controls (mute, lock, hide) — it also emits `aria-pressed`. */
  active?: boolean
  tooltipSide?: TooltipSide
}

export function IconButton({
  label,
  shortcut,
  icon,
  variant = 'ghost',
  size = 'sm',
  active,
  tooltipSide = 'bottom',
  className,
  ...props
}: IconButtonProps): ReactNode {
  return (
    <Tooltip label={label} shortcut={shortcut} side={tooltipSide}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        className={cn(
          'no-drag t-press inline-flex shrink-0 items-center justify-center rounded-sm active:scale-[0.96]',
          'disabled:pointer-events-none disabled:opacity-35',
          VARIANTS[variant],
          SIZES[size],
          active && variant !== 'primary' && 'bg-accent/14 text-accent hover:bg-accent/20',
          className
        )}
        {...props}
      >
        {icon}
      </button>
    </Tooltip>
  )
}
