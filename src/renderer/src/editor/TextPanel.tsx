import { useId, useState, type ReactNode } from 'react'
import { Button, Panel, ScrollArea } from '@/components'
import { addTitle } from '@/lib/mediaActions'

/**
 * A plain title: type the words, add it at the playhead (or to the pool only). It becomes a text
 * asset, placeable more than once, whose words, font, colour, outline and position are then set
 * in the inspector. Shared by the old Text page and the Effects Library's Titles.
 */
export function QuickTitle(): ReactNode {
  const [draft, setDraft] = useState('')
  const id = useId()

  const add = (place: boolean): void => {
    const text = draft.trim()
    if (!text) return
    addTitle(text, place)
    setDraft('')
  }

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-[11px] text-ink-1">
        Title text
      </label>
      <textarea
        id={id}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          // Enter inserts a line break, because titles are frequently two lines.
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            add(true)
          }
        }}
        rows={3}
        placeholder="Type a title…"
        className="w-full resize-y rounded-sm border border-line bg-surface-2 p-2 text-[12px] leading-snug text-ink-0 outline-none placeholder:text-ink-2 focus:border-accent/70"
      />
      {/* Wrapping, not a fixed row: in a narrow column two labelled buttons side by side clipped
          the second one off the edge of the panel. */}
      <div className="mt-2 flex flex-wrap gap-1.5">
        <Button variant="primary" className="flex-1" disabled={!draft.trim()} onClick={() => add(true)} title="⌘Enter">
          Add at playhead
        </Button>
        <Button variant="subtle" className="flex-1" disabled={!draft.trim()} onClick={() => add(false)}>
          Add to media only
        </Button>
      </div>
    </div>
  )
}

/**
 * The old left rail's Text page. Word-by-word subtitles moved to the Transcript tab, beside the
 * words they are made from; titles are also in the Effects Library under Titles.
 */
export function TextPanel(): ReactNode {
  return (
    <Panel title="Text" className="h-full" bodyClassName="flex flex-col">
      <ScrollArea className="flex-1 p-3">
        <QuickTitle />
        <p className="mt-4 text-[11px] leading-relaxed text-ink-2">
          Select a title on the timeline to change its words and style in the inspector. Word-by-word
          subtitles are in the Transcript tab.
        </p>
      </ScrollArea>
    </Panel>
  )
}
