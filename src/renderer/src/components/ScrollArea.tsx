import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/cn'

export interface ScrollAreaProps extends HTMLAttributes<HTMLDivElement> {
  axis?: 'y' | 'x' | 'both'
}

/**
 * A scroll container that is allowed to shrink. `min-h-0` is doing the real work: a flex
 * child defaults to `min-height: auto`, so without it a long list pushes its own parent
 * past the window instead of scrolling, and the panel below disappears off the bottom.
 */
export function ScrollArea({ axis = 'y', className, children, ...props }: ScrollAreaProps): ReactNode {
  return (
    <div
      className={cn(
        'min-h-0 min-w-0',
        axis === 'y' && 'overflow-y-auto overflow-x-hidden',
        axis === 'x' && 'overflow-x-auto overflow-y-hidden',
        axis === 'both' && 'overflow-auto',
        className
      )}
      {...props}
    >
      {children}
    </div>
  )
}
