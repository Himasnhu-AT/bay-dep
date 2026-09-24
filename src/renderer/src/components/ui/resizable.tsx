/**
 * shadcn/ui's Resizable, over `react-resizable-panels` v4.
 *
 * Copied in the shadcn way rather than generated: `shadcn init` rewrites the stylesheet with its
 * own theme variables, which would replace bay's token palette. This is the component's source
 * with its colours pointed at bay's tokens (`line`, `accent`, `surface-*`) instead of shadcn's
 * `border`/`ring`, and the same `data-slot` attributes so it stays recognisably shadcn's.
 *
 * The separator is a 1px hairline — the same line that separated panels before they could be
 * resized — with an invisible wider hit area, and it turns accent while hovered, dragged or
 * focused. The library makes each separator focusable and arrow-key resizable, which keeps the
 * keyboard path the old hand-rolled timeline splitter had.
 */

import type { ReactNode } from 'react'
import { GripVertical } from 'lucide-react'
import * as ResizablePrimitive from 'react-resizable-panels'
import { cn } from '@/lib/cn'

export function ResizablePanelGroup({
  className,
  ...props
}: ResizablePrimitive.GroupProps): ReactNode {
  return (
    <ResizablePrimitive.Group
      data-slot="resizable-panel-group"
      className={cn('flex h-full w-full min-h-0 min-w-0', className)}
      {...props}
    />
  )
}

export function ResizablePanel({ className, ...props }: ResizablePrimitive.PanelProps): ReactNode {
  return (
    <ResizablePrimitive.Panel
      data-slot="resizable-panel"
      className={cn('min-h-0 min-w-0', className)}
      {...props}
    />
  )
}

export function ResizableHandle({
  withHandle,
  className,
  ...props
}: ResizablePrimitive.SeparatorProps & { withHandle?: boolean }): ReactNode {
  return (
    <ResizablePrimitive.Separator
      data-slot="resizable-handle"
      className={cn(
        // A hairline in the flow, a wider target around it. `aria-orientation` is set by the
        // library: "vertical" for a separator between side-by-side panels, "horizontal" for
        // one between stacked panels.
        'group/handle t-fast relative flex shrink-0 items-center justify-center bg-line outline-none',
        'aria-[orientation=vertical]:w-px aria-[orientation=horizontal]:h-px',
        'after:absolute after:content-[""]',
        'aria-[orientation=vertical]:after:inset-y-0 aria-[orientation=vertical]:after:-left-1 aria-[orientation=vertical]:after:w-2',
        'aria-[orientation=horizontal]:after:inset-x-0 aria-[orientation=horizontal]:after:-top-1 aria-[orientation=horizontal]:after:h-2',
        'hover:bg-accent/70 focus-visible:bg-accent data-[separator=active]:bg-accent data-[separator=focus]:bg-accent data-[separator=hover]:bg-accent/70',
        className
      )}
      {...props}
    >
      {withHandle && (
        <div className="z-10 flex h-4 w-3 items-center justify-center rounded-xs border border-line-strong bg-surface-3 group-aria-[orientation=horizontal]/handle:rotate-90">
          <GripVertical aria-hidden="true" className="size-2.5 text-ink-2" />
        </div>
      )}
    </ResizablePrimitive.Separator>
  )
}
