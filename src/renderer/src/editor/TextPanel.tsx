import { useState, type ReactNode } from 'react'
import { Type as TypeIcon } from 'lucide-react'
import { Button, Panel, ScrollArea } from '@/components'
import { addTitle } from '@/lib/mediaActions'
import { SubtitlesSection } from './SubtitlesSection'

export function TextPanel(): ReactNode {
  const [draft, setDraft] = useState('')

  const add = (place: boolean): void => {
    const text = draft.trim()
    if (!text) return
    addTitle(text, place)
    setDraft('')
  }

  return (
    <Panel title="Text" className="h-full" bodyClassName="flex flex-col">
      <ScrollArea className="flex-1 p-3">
        <SubtitlesSection />
        <label htmlFor="text-draft" className="mb-1.5 block text-[11px] text-ink-1">
          Title text
        </label>
        <textarea
          id="text-draft"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter inserts a line break, because titles are frequently two lines.
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault()
              add(true)
            }
          }}
          rows={4}
          placeholder="Type a title…"
          className="w-full resize-y rounded-sm border border-line bg-surface-2 p-2 text-[12px] leading-snug text-ink-0 outline-none placeholder:text-ink-2 focus:border-accent/70"
        />
        {/* Stacked, not side by side: the rail is 212px and two labelled buttons in a row
            clip the second one off the edge of the panel. */}
        <div className="mt-2 grid gap-1.5">
          <Button variant="primary" disabled={!draft.trim()} onClick={() => add(true)}>
            Add at playhead
          </Button>
          <Button variant="subtle" disabled={!draft.trim()} onClick={() => add(false)}>
            Add to media only
          </Button>
        </div>

        <div className="mt-4 flex items-start gap-2 rounded-sm border border-line bg-surface-2 p-2.5">
          <TypeIcon aria-hidden="true" className="mt-px size-3.5 shrink-0 text-ink-2" />
          <p className="text-[11px] leading-relaxed text-ink-2">
            A title becomes an asset in the media pool and can be placed more than once. Once
            it is on the timeline, select it to change its words, font, colour, outline and
            position in the inspector.
          </p>
        </div>
      </ScrollArea>
    </Panel>
  )
}
