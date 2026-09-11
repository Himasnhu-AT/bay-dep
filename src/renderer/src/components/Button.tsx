import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/cn'

export type ButtonVariant = 'ghost' | 'subtle' | 'primary' | 'danger'
export type ButtonSize = 'sm' | 'md'

const VARIANTS: Record<ButtonVariant, string> = {
  ghost: 'bg-transparent text-ink-1 hover:bg-surface-3 hover:text-ink-0',
  subtle: 'bg-surface-2 text-ink-0 border border-line hover:bg-surface-3 hover:border-line-strong',
  primary: 'bg-accent text-accent-ink font-medium hover:brightness-110',
  danger: 'bg-transparent text-danger hover:bg-danger/12'
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-[12px] gap-1.5',
  md: 'h-8 px-3 text-[12px] gap-2'
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: ReactNode
}

export function Button({
  variant = 'subtle',
  size = 'sm',
  icon,
  className,
  children,
  ...props
}: ButtonProps): ReactNode {
  return (
    <button
      type="button"
      className={cn(
        'no-drag t-fast inline-flex shrink-0 items-center justify-center rounded-sm',
        'whitespace-nowrap select-none',
        // A disabled control is drawn, not hidden — the greyed-out ones are the map of
        // what the engine cannot do yet.
        'disabled:pointer-events-none disabled:opacity-40',
        VARIANTS[variant],
        SIZES[size],
        className
      )}
      {...props}
    >
      {icon}
      {children}
    </button>
  )
}
