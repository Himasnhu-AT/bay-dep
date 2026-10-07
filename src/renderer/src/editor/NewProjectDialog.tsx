import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { HOST_LABEL, type ProjectHost } from '@shared/host'
import { Badge, Button, InlineAlert, Modal } from '@/components'
import { cn } from '@/lib/cn'
import {
  hostAfterKey,
  hostToRemember,
  NEW_PROJECT_HOST_KEY,
  rememberedHost,
  resolveChoiceNote
} from '@/lib/projectHost'
import { remember, remembered } from '@/store/prefs'
import { ResolveStatusLine } from './resolve/ResolveStatusLine'
import { useResolveStatus } from './resolve/useResolveStatus'

export interface NewProjectDialogProps {
  open: boolean
  onClose(): void
  /** The choice was confirmed. Nothing has been created yet; the caller creates. */
  onCreate(host: ProjectHost): void
}

const DETAIL: Record<ProjectHost, string> = {
  bay: 'Edit in bay. The agent and you work on the same timeline here.',
  resolve: 'Edit in Resolve. bay’s agent builds and changes the timeline there; you finish in Resolve.'
}

/**
 * The one question a new project asks: which editor it is edited in. Opens on the editor chosen
 * last time, so Enter repeats it; Escape creates nothing.
 */
export function NewProjectDialog({ open, onClose, onCreate }: NewProjectDialogProps): ReactNode {
  // The form is mounted per opening, so the footer's Create reads the choice through this.
  const confirm = useRef<() => void>(() => {})
  return (
    <Modal
      open={open}
      title="New project"
      width={600}
      onClose={onClose}
      footer={
        <>
          <Button variant="subtle" data-new-project-cancel="" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" data-new-project-confirm="" onClick={() => confirm.current()}>
            Create project
          </Button>
        </>
      }
    >
      {open && <HostChoice confirm={confirm} onCreate={onCreate} />}
    </Modal>
  )
}

function HostChoice({
  confirm,
  onCreate
}: {
  confirm: { current: () => void }
  onCreate(host: ProjectHost): void
}): ReactNode {
  const [host, setHost] = useState<ProjectHost>(() => rememberedHost(remembered(NEW_PROJECT_HOST_KEY)))
  const connection = useResolveStatus(true, false)
  const cards = useRef<Partial<Record<ProjectHost, HTMLButtonElement | null>>>({})

  const create = (chosen: ProjectHost): void => {
    remember(NEW_PROJECT_HOST_KEY, hostToRemember(chosen))
    onCreate(chosen)
  }
  confirm.current = () => create(host)

  // Focus starts on the remembered card, so Enter creates there. This runs before the Modal's own
  // focus effect (a child's effects run first), which leaves focus alone once it is inside.
  useEffect(() => {
    cards.current[host]?.focus()
    // Once, on opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, card: ProjectHost): void => {
    if (event.key === 'Enter') {
      // Not the button's own click, which only selects.
      event.preventDefault()
      create(card)
      return
    }
    const next = hostAfterKey(card, event.key)
    if (next === card) return
    event.preventDefault()
    setHost(next)
    cards.current[next]?.focus()
  }

  const card = (id: ProjectHost): ReactNode => {
    const selected = host === id
    return (
      <button
        key={id}
        ref={(element) => {
          cards.current[id] = element
        }}
        type="button"
        role="radio"
        aria-checked={selected}
        data-host-card={id}
        // Every card is a Tab stop. Tab moves focus without choosing — tabbing past Resolve on
        // the way to Create must not change the choice — while the arrows move both, and Enter
        // creates in the card that has focus.
        onClick={() => setHost(id)}
        onDoubleClick={() => create(id)}
        onKeyDown={(event) => onKeyDown(event, id)}
        className={cn(
          't-fast flex min-w-0 flex-1 basis-0 flex-col gap-1.5 rounded-sm border p-3 text-left outline-none',
          'focus-visible:ring-2 focus-visible:ring-accent/60',
          selected
            ? 'border-accent bg-accent/10'
            : 'border-line bg-surface-2 hover:border-line-strong hover:bg-surface-3'
        )}
      >
        <span className="text-[13px] font-semibold text-ink-0">{HOST_LABEL[id]}</span>
        <span className="text-[11px] leading-relaxed text-pretty text-ink-1">{DETAIL[id]}</span>
      </button>
    )
  }

  const note = host === 'resolve' ? resolveChoiceNote(connection.status) : null

  return (
    <div data-new-project="" className="flex flex-col gap-3 px-4 py-3">
      <p className="text-[12px] text-ink-1">Where do you want to edit?</p>
      <div role="radiogroup" aria-label="Where do you want to edit?" className="flex items-stretch gap-2">
        {card('bay')}
        {card('resolve')}
        <button
          type="button"
          role="radio"
          aria-checked={false}
          disabled
          data-host-card="premiere"
          className="flex min-w-0 flex-1 basis-0 flex-col gap-1.5 rounded-sm border border-line bg-surface-2 p-3 text-left opacity-50"
        >
          <span className="flex items-center gap-1.5">
            <span className="text-[13px] font-semibold text-ink-0">Premiere Pro</span>
            <Badge>Later</Badge>
          </span>
          <span className="text-[11px] leading-relaxed text-pretty text-ink-1">Not available yet.</span>
        </button>
      </div>

      <section aria-label="DaVinci Resolve connection" className="rounded-sm border border-line bg-surface-0 p-3">
        <h3 className="mb-2 text-[11px] font-medium text-ink-2">DaVinci Resolve</h3>
        <ResolveStatusLine connection={connection} />
        {note && (
          <InlineAlert tone="notice" className="mt-2.5">
            <span data-new-project-note="">{note}</span>
          </InlineAlert>
        )}
      </section>
    </div>
  )
}
