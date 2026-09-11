import type { ReactNode } from 'react'
import { Panel, ScrollArea } from '@/components'
import { ExportForm } from './ExportDialog'

/** The left rail's Export page. Same form as the dialog, same state shape, one source. */
export function ExportPanel(): ReactNode {
  return (
    <Panel title="Export" className="h-full" bodyClassName="flex flex-col">
      <ScrollArea className="flex-1">
        <ExportForm compact />
      </ScrollArea>
    </Panel>
  )
}
