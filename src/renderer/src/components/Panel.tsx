import { useEffect, useId, useState, type ReactNode } from 'react'
import { ChevronRight, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/cn'
import { OPEN_SECTION_EVENT } from '@/lib/openSection'
import { IconButton } from './IconButton'

export interface PanelProps {
  title?: string
  /** Controls that sit on the title row, right-aligned. */
  actions?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
}

/**
 * A titled region. Panels are separated by a 1px `line`, never by a gap or a shadow —
 * borders are what keep a dense tool from looking like a page of floating cards.
 */
export function Panel({ title, actions, children, className, bodyClassName }: PanelProps): ReactNode {
  return (
    <section className={cn('flex min-h-0 min-w-0 flex-col bg-surface-1', className)}>
      {(title || actions) && (
        <header className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-line px-3">
          {title && (
            <h2 className="text-[11px] font-semibold tracking-[0.08em] text-ink-0 uppercase">
              {title}
            </h2>
          )}
          {actions && <div className="flex items-center gap-1">{actions}</div>}
        </header>
      )}
      <div className={cn('min-h-0 flex-1', bodyClassName)}>{children}</div>
    </section>
  )
}

export interface SectionProps {
  title: string
  children: ReactNode
  /** Controls on the title row, right-aligned — `IconButton size="xs"`, or `SectionReset`. */
  actions?: ReactNode
  className?: string
  /** The title becomes a disclosure button (with `aria-expanded`) that shows and hides the body. */
  collapsible?: boolean
  /** Open on first sight; after that the user's choice is remembered. Default true. */
  defaultOpen?: boolean
  /**
   * Remembers the open state across sessions, per id — `'inspector.adjustments'`. Without one a
   * collapsible section starts at `defaultOpen` every time it mounts.
   */
  id?: string
}

const sectionKey = (id: string): string => `bay.section.${id}`

function readOpen(id: string | undefined, fallback: boolean): boolean {
  if (!id) return fallback
  try {
    const stored = localStorage.getItem(sectionKey(id))
    return stored === null ? fallback : stored === '1'
  } catch {
    return fallback
  }
}

function writeOpen(id: string | undefined, open: boolean): void {
  if (!id) return
  try {
    localStorage.setItem(sectionKey(id), open ? '1' : '0')
  } catch {
    // Not remembered this time; the section still opens and closes.
  }
}

const SECTION_TITLE = 'text-[10px] font-semibold tracking-[0.08em] text-ink-1 uppercase'

/**
 * A labelled group inside a panel body — the Inspector is built out of these.
 *
 * `collapsible` turns the title into the toggle. The actions stay outside that button (a
 * button inside a button is invalid, and a reset must not also collapse the section), and a
 * collapsed section keeps its actions visible, so "this is off-default" shows either way.
 */
export function Section({
  title,
  children,
  actions,
  className,
  collapsible,
  defaultOpen = true,
  id
}: SectionProps): ReactNode {
  const [open, setOpen] = useState(() => (collapsible ? readOpen(id, defaultOpen) : true))
  const bodyId = useId()
  // `openSection(id)` from outside (a field inside is about to be focused).
  useEffect(() => {
    if (!collapsible || !id) return
    const onOpen = (event: Event): void => {
      if ((event as CustomEvent<{ id?: string }>).detail?.id !== id) return
      setOpen(true)
      writeOpen(id, true)
    }
    window.addEventListener(OPEN_SECTION_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_SECTION_EVENT, onOpen)
  }, [collapsible, id])
  return (
    <div className={cn('border-b border-line px-3 py-3 last:border-b-0', className)}>
      <div className={cn('flex h-4 items-center justify-between gap-2', open && 'mb-2')}>
        {collapsible ? (
          <h3 className="min-w-0">
            <button
              type="button"
              aria-expanded={open}
              aria-controls={bodyId}
              onClick={() => {
                setOpen(!open)
                writeOpen(id, !open)
              }}
              className={cn(
                't-fast -mx-1 flex h-5 items-center gap-1 rounded-sm px-1 hover:text-ink-0',
                SECTION_TITLE
              )}
            >
              <ChevronRight
                aria-hidden="true"
                className={cn(
                  'size-3 shrink-0 transition-[rotate] duration-(--duration-fast)',
                  open && 'rotate-90'
                )}
              />
              {title}
            </button>
          </h3>
        ) : (
          <h3 className={SECTION_TITLE}>{title}</h3>
        )}
        {actions}
      </div>
      <div id={bodyId} hidden={!open}>
        {children}
      </div>
    </div>
  )
}

export interface SectionResetProps {
  /** Show it only when something in the section is off its default. */
  show: boolean
  /** Names what is reset — "Reset adjustments", not "Reset". */
  label: string
  onReset(): void
}

/**
 * The one reset affordance for a Section, for its `actions`: an `xs` icon button on the title
 * row, present only when there is something to reset — so it never grows the row, and its
 * appearance is itself the sign that the section is off-default.
 *
 *     <Section title="Adjustments"
 *       actions={<SectionReset show={touched} label="Reset adjustments" onReset={reset} />}>
 */
export function SectionReset({ show, label, onReset }: SectionResetProps): ReactNode {
  if (!show) return null
  return (
    <IconButton
      size="xs"
      tooltipSide="left"
      label={label}
      icon={<RotateCcw aria-hidden="true" className="size-3" />}
      onClick={onReset}
    />
  )
}

export interface FieldProps {
  label: string
  children: ReactNode
  /** Right-hand readout, e.g. the numeric value beside a slider. */
  hint?: ReactNode
  className?: string
}

/** A label above (or beside) a control, on the 4px grid. */
export function Field({ label, children, hint, className }: FieldProps): ReactNode {
  return (
    <div className={cn('grid grid-cols-[64px_1fr] items-center gap-2', className)}>
      <span className="truncate text-[11px] text-ink-1">{label}</span>
      <div className="flex min-w-0 items-center gap-2">
        <div className="min-w-0 flex-1">{children}</div>
        {hint && (
          <span className="shrink-0 text-right text-[11px] text-ink-2 tabular-nums">{hint}</span>
        )}
      </div>
    </div>
  )
}
