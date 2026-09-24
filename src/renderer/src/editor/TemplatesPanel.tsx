import { useState, type ReactNode } from 'react'
import { ChevronRight, LayoutTemplate, Plus, RotateCcw } from 'lucide-react'
import type { CompositionVariableValue } from '@shared/composition'
import { TEMPLATES, type TemplateSpec } from '@shared/templates'
import { Button, Panel, ScrollArea } from '@/components'
import { addTemplate } from '@/mcp/templates'
import { selectTimeline, useEditor } from '@/store/editor'
import { cn } from '@/lib/cn'
import { VariableControl } from './CompositionSection'

/** The catalog descriptions run to a paragraph for an agent; a list row wants the first line. */
function firstSentence(text: string): string {
  const end = text.indexOf('. ')
  return end === -1 ? text : text.slice(0, end + 1)
}

/**
 * bay's shipped templates, placeable without an agent.
 *
 * Adding goes through `addTemplate`, the function behind the `add_template` tool, so the panel
 * and an agent cannot disagree about what placing a template means: sized to the active
 * timeline's canvas, written by main, imported, placed at the playhead on a track with room,
 * with the values set — one undo step.
 *
 * The values here are a draft for the *next* placement, not an edit to anything placed. Once a
 * clip exists its values live on it and are changed in the inspector, which is why nothing here
 * reaches the store until Add is pressed.
 */
export function TemplatesPanel(): ReactNode {
  const width = useEditor((state) => selectTimeline(state)?.width)
  const height = useEditor((state) => selectTimeline(state)?.height)
  const [open, setOpen] = useState<string | null>(null)

  return (
    <Panel
      title="Templates"
      className="h-full"
      bodyClassName="flex flex-col"
      actions={
        width && height ? (
          <span
            className="text-[10px] text-ink-2 tabular-nums"
            title="Templates are sized to the timeline's canvas when they are added"
          >
            {width}×{height}
          </span>
        ) : null
      }
    >
      <ScrollArea className="flex-1">
        <ul className="flex flex-col">
          {TEMPLATES.map((spec) => (
            <TemplateRow
              key={spec.id}
              spec={spec}
              open={open === spec.id}
              onToggle={() => setOpen((current) => (current === spec.id ? null : spec.id))}
            />
          ))}
        </ul>
        <div className="m-3 flex items-start gap-2 rounded-sm border border-line bg-surface-2 p-2.5">
          <LayoutTemplate aria-hidden="true" className="mt-px size-3.5 shrink-0 text-ink-2" />
          <p className="text-[11px] leading-relaxed text-ink-2">
            A template is added at the playhead, sized to this timeline's canvas. Its text and
            colours stay editable per clip in the inspector.
          </p>
        </div>
      </ScrollArea>
    </Panel>
  )
}

function TemplateRow({
  spec,
  open,
  onToggle
}: {
  spec: TemplateSpec
  open: boolean
  onToggle: () => void
}): ReactNode {
  const notify = useEditor((state) => state.notify)
  const [values, setValues] = useState<Record<string, CompositionVariableValue>>({})
  const [busy, setBusy] = useState(false)

  const edited = Object.keys(values).length > 0

  const setValue = (id: string, value: CompositionVariableValue): void => {
    const declared = spec.variables.find((v) => v.id === id)
    setValues((current) => {
      const next = { ...current }
      // Held as absence when it matches the default, the way a placed clip stores it, so
      // "edited" means something differs rather than that a control was touched.
      if (declared && value === declared.default) delete next[id]
      else next[id] = value
      return next
    })
  }

  const add = async (): Promise<void> => {
    setBusy(true)
    try {
      const result = await addTemplate({ templateId: spec.id, variables: values })
      notify(`${spec.name} added at frame ${String(result.from)} on ${String(result.trackName)}.`)
    } catch (error) {
      // `addTemplate` fails with a message written to be acted on — the same one an agent gets.
      notify(error instanceof Error ? error.message : String(error), 'error')
    } finally {
      setBusy(false)
    }
  }

  const panelId = `template-${spec.id}`

  return (
    <li className="border-b border-line">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
        className="flex w-full items-start gap-2 px-3 py-2.5 text-left t-fast hover:bg-surface-2"
      >
        <ChevronRight
          aria-hidden="true"
          className={cn('mt-0.5 size-3.5 shrink-0 text-ink-2 t-fast', open && 'rotate-90')}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[12px] font-medium text-ink-0">{spec.name}</span>
            <span className="shrink-0 text-[10px] text-ink-2 tabular-nums">
              {spec.durationSeconds}s
            </span>
          </span>
          <span className="mt-0.5 line-clamp-2 block text-[11px] leading-snug text-ink-2">
            {firstSentence(spec.description)}
          </span>
        </span>
      </button>

      {open && (
        <div id={panelId} className="flex flex-col gap-2.5 px-3 pt-1 pb-3">
          {spec.variables.map((variable) => (
            <VariableControl
              key={variable.id}
              variable={variable}
              value={values[variable.id] ?? variable.default}
              onChange={(value) => setValue(variable.id, value)}
            />
          ))}
          <div className="mt-1 grid gap-1.5">
            <Button
              variant="primary"
              icon={<Plus aria-hidden="true" className="size-3.5" />}
              disabled={busy}
              onClick={() => void add()}
            >
              {busy ? 'Adding…' : 'Add to timeline'}
            </Button>
            {edited && (
              <Button
                variant="subtle"
                icon={<RotateCcw aria-hidden="true" className="size-3.5" />}
                disabled={busy}
                onClick={() => setValues({})}
              >
                Reset to defaults
              </Button>
            )}
          </div>
        </div>
      )}
    </li>
  )
}
