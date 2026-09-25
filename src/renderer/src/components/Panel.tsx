import { createContext, useContext, useEffect, useId, useState, type ReactNode } from 'react'
import { ChevronRight, Info, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/cn'
import { OPEN_SECTION_EVENT } from '@/lib/openSection'
import { IconButton } from './IconButton'
import { Tooltip } from './Tooltip'

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
 *
 * The title sits in its own 28px `chrome-raised` strip, as every Resolve panel's does ("Media
 * Pool", "Inspector") and as the workspace's `RegionHeader` draws the viewer's: with the header
 * the same grey as the body, regions blurred into one field.
 */
export function Panel({ title, actions, children, className, bodyClassName }: PanelProps): ReactNode {
  return (
    <section className={cn('flex min-h-0 min-w-0 flex-col bg-surface-1', className)}>
      {(title || actions) && (
        <header className="flex h-7 min-w-0 shrink-0 items-center justify-between gap-2 border-b border-line bg-chrome-raised px-2">
          {title && (
            <h2 className="min-w-0 truncate text-[11px] font-semibold text-ink-0 select-none">
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
  /**
   * Guidance about the section — what it is for, how it differs from a neighbour — shown as a
   * tooltip on the title rather than as a paragraph in the body. State (a refusal, a clamp)
   * still belongs in the body, where it cannot be missed.
   */
  hint?: string
}

/**
 * How `Section`s draw their titles below this point: `plain` (a caption over the fields — the
 * Settings dialog) or `bar` (a filled title strip per section, Resolve's inspector). A context
 * rather than a prop, so a section component mounted by the inspector and by a page of its own
 * takes the look of wherever it is mounted without either caller threading a prop through it.
 */
const SectionLook = createContext<'plain' | 'bar'>('plain')

/** Draws every `Section` inside as a titled bar with hairlines between — the inspector's look. */
export function SectionBars({ children }: { children: ReactNode }): ReactNode {
  return <SectionLook.Provider value="bar">{children}</SectionLook.Provider>
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
const BAR_TITLE = 'text-[11px] font-semibold text-ink-0'

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
  id,
  hint
}: SectionProps): ReactNode {
  const look = useContext(SectionLook)
  const bar = look === 'bar'
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
  const titleClass = bar ? BAR_TITLE : SECTION_TITLE
  const info = hint ? <Info aria-hidden="true" className="size-3 shrink-0 text-ink-3" /> : null
  let heading: ReactNode = collapsible ? (
    <h3 className="min-w-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        aria-description={hint}
        onClick={() => {
          setOpen(!open)
          writeOpen(id, !open)
        }}
        className={cn('t-fast -mx-1 flex h-5 min-w-0 items-center gap-1 rounded-sm px-1 hover:text-ink-0', titleClass)}
      >
        <ChevronRight
          aria-hidden="true"
          className={cn(
            'size-3 shrink-0 transition-[rotate] duration-(--duration-fast)',
            bar && 'text-ink-2',
            open && 'rotate-90'
          )}
        />
        <span className="truncate">{title}</span>
        {info}
      </button>
    </h3>
  ) : (
    <h3 className={cn('flex min-w-0 items-center gap-1', titleClass)} aria-description={hint}>
      <span className="truncate">{title}</span>
      {info}
    </h3>
  )
  if (hint) {
    heading = (
      <Tooltip label={title} detail={hint} side="left">
        <div className="min-w-0">{heading}</div>
      </Tooltip>
    )
  }
  if (bar) {
    return (
      <div className={cn('border-b border-line last:border-b-0', className)}>
        <div
          className={cn(
            'flex h-7 items-center justify-between gap-2 bg-chrome-raised px-3',
            open && 'border-b border-line'
          )}
        >
          {heading}
          {actions}
        </div>
        <div id={bodyId} hidden={!open} className="px-3 pt-2 pb-3">
          {children}
        </div>
      </div>
    )
  }
  return (
    <div className={cn('border-b border-line px-3 py-3 last:border-b-0', className)}>
      <div className={cn('flex h-4 items-center justify-between gap-2', open && 'mb-2')}>
        {heading}
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
