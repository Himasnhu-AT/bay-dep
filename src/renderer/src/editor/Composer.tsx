import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import {
  ArrowUp,
  AtSign,
  Bot,
  Clock,
  Film,
  Loader2,
  MessageSquarePlus,
  Square,
  SquareStop,
  Type as TypeIcon,
  Volume2,
  X,
  type LucideIcon
} from 'lucide-react'
import { allItems, findAsset, formatTimecode, itemEnd, type Project } from '@shared/project'
import {
  activeTrigger,
  matchMentions,
  parseTime,
  pinKey,
  pinLabel,
  type MentionCandidate,
  type Pin
} from '@shared/pins'
import { cn } from '@/lib/cn'
import { selectFps, selectTimeline, useEditor } from '@/store/editor'
import { AGENT_STARTERS } from './agentStarters'

/**
 * The agent's composer: the text box, what is pinned, and the `@` and `/` menus.
 *
 * `@` offers what the user can point at — a stretch of time, a clip on the timeline, an imported
 * asset — and pins it as a chip. Pins are sticky and reach the agent with every message as ids
 * and frames (see `@shared/pins`). `/` at the start of a message offers commands (a new
 * conversation, stop) and skills — the same starters as the empty panel, as a prompt to finish.
 *
 * The menus are one listbox driven from the text box, in the combobox pattern: focus never
 * leaves the textarea, the arrow keys move the highlight, Enter or Tab picks, Escape closes. A
 * menu that stole focus would lose the half-typed query the moment it opened.
 */

type Command = { id: 'new' | 'stop'; label: string; detail: string; icon: LucideIcon }

interface MenuRow {
  key: string
  group: string
  label: string
  detail: string
  icon: LucideIcon
  choose: () => void
}

export interface ComposerProps {
  running: boolean
  /** Send one message. Resolves once it has been handed over. */
  onSend: (text: string) => Promise<void>
  onStop: () => void
  onNewConversation: () => void
  draft: string
  setDraft: (text: string) => void
  textareaRef: React.RefObject<HTMLTextAreaElement | null>
}

const PIN_ICON: Record<Pin['kind'], LucideIcon> = { asset: Film, clip: Film, range: Clock }

function candidatesFor(project: Project, timelineId: string | undefined, selection: readonly string[], fps: number): MentionCandidate[] {
  const out: MentionCandidate[] = []
  const tc = (frame: number): string => formatTimecode(frame, fps, true)
  const timeline = project.timelines.find((t) => t.id === timelineId)
  if (timeline) {
    // The selected clips' span is the most useful range there is — it is what the user is
    // already looking at — so it comes first when there is one.
    const selected = allItems(timeline).filter((item) => selection.includes(item.id))
    if (selected.length > 0) {
      const from = Math.min(...selected.map((item) => item.from))
      const to = Math.max(...selected.map(itemEnd))
      out.push({
        pin: { kind: 'range', fromFrame: from, toFrame: to },
        label: 'Selection',
        detail: `${tc(from)}–${tc(to)} · the selected clip${selected.length === 1 ? '' : 's'}`,
        group: 'Time'
      })
    }
    for (const track of timeline.tracks) {
      for (const item of track.items) {
        const asset = findAsset(project, item.assetId)
        const name = asset?.kind === 'text' ? `“${asset.text ?? asset.name}”` : asset?.name ?? item.id
        out.push({
          pin: {
            kind: 'clip',
            itemId: item.id,
            name,
            trackName: track.name,
            fromFrame: item.from,
            toFrame: itemEnd(item)
          },
          label: name,
          detail: `${track.name} · ${tc(item.from)}–${tc(itemEnd(item))}`,
          group: 'Clips'
        })
      }
    }
  }
  for (const asset of project.assets) {
    out.push({
      pin: {
        kind: 'asset',
        assetId: asset.id,
        name: asset.name,
        assetKind: asset.kind,
        durationUs: asset.durationUs ?? null
      },
      label: asset.name,
      detail: asset.kind,
      group: 'Assets'
    })
  }
  return out
}

function iconForCandidate(candidate: MentionCandidate, project: Project): LucideIcon {
  const pin = candidate.pin
  if (pin.kind === 'range') return Clock
  const assetId =
    pin.kind === 'asset'
      ? pin.assetId
      : project.timelines.flatMap((t) => allItems(t)).find((item) => item.id === pin.itemId)?.assetId
  const kind = assetId ? findAsset(project, assetId)?.kind : undefined
  if (kind === 'audio') return Volume2
  if (kind === 'text') return TypeIcon
  return Film
}

export function Composer({
  running,
  onSend,
  onStop,
  onNewConversation,
  draft,
  setDraft,
  textareaRef
}: ComposerProps): ReactNode {
  const project = useEditor((state) => state.project)
  const timeline = useEditor(selectTimeline)
  const fps = useEditor(selectFps)
  const selection = useEditor((state) => state.selection)
  const playhead = useEditor((state) => state.playhead)
  const pins = useEditor((state) => state.agentPins)
  const addPin = useEditor((state) => state.addAgentPin)
  const removePin = useEditor((state) => state.removeAgentPin)

  const [caret, setCaret] = useState(0)
  const [dismissed, setDismissed] = useState<number | null>(null)
  const [highlight, setHighlight] = useState(0)
  const [rangeOpen, setRangeOpen] = useState(false)
  const listId = useId()

  const trigger = activeTrigger(draft, caret)
  // Escape closes the menu for this trigger only; typing a new `@` opens it again.
  const menuTrigger = trigger && trigger.start !== dismissed ? trigger : null

  const replaceTrigger = (replacement: string): void => {
    if (!menuTrigger) return
    const before = draft.slice(0, menuTrigger.start)
    const after = draft.slice(menuTrigger.start + 1 + menuTrigger.query.length)
    const next = `${before}${replacement}${after}`
    setDraft(next)
    const position = before.length + replacement.length
    requestAnimationFrame(() => {
      const box = textareaRef.current
      box?.focus()
      box?.setSelectionRange(position, position)
      setCaret(position)
    })
  }

  // Rebuilt every render: it is a few dozen rows at most, and memoising it only bought a stale
  // closure over the draft.
  const rows: MenuRow[] = (() => {
    if (!menuTrigger) return []
    if (menuTrigger.char === '@') {
      const found = matchMentions(
        menuTrigger.query,
        candidatesFor(project, timeline?.id, selection, fps)
      )
      const custom: MenuRow[] =
        'time range'.includes(menuTrigger.query.toLowerCase()) || 'range'.startsWith(menuTrigger.query.toLowerCase())
          ? [
              {
                key: 'range-custom',
                group: 'Time',
                label: 'Time range…',
                detail: 'Pick a start and end; the agent works only inside it',
                icon: Clock,
                choose: () => {
                  replaceTrigger('')
                  setRangeOpen(true)
                }
              }
            ]
          : []
      return [
        ...custom,
        ...found.map((candidate) => ({
          key: pinKey(candidate.pin),
          group: candidate.group,
          label: candidate.label,
          detail: candidate.detail,
          icon: iconForCandidate(candidate, project),
          choose: () => {
            addPin(candidate.pin)
            replaceTrigger('')
          }
        }))
      ]
    }
    const needle = menuTrigger.query.toLowerCase()
    const commands: Command[] = [
      { id: 'new', label: 'New conversation', detail: 'Clear the chat and the pins', icon: MessageSquarePlus },
      ...(running ? [{ id: 'stop' as const, label: 'Stop', detail: 'Stop the agent’s current turn', icon: SquareStop }] : [])
    ]
    const commandRows: MenuRow[] = commands
      .filter((command) => !needle || command.label.toLowerCase().includes(needle) || command.id.startsWith(needle))
      .map((command) => ({
        key: `command:${command.id}`,
        group: 'Commands',
        label: command.label,
        detail: command.detail,
        icon: command.icon,
        choose: () => {
          replaceTrigger('')
          if (command.id === 'new') onNewConversation()
          else onStop()
        }
      }))
    const skillRows: MenuRow[] = AGENT_STARTERS.filter(
      (starter) => !needle || starter.title.toLowerCase().includes(needle)
    ).map((starter) => ({
      key: `skill:${starter.id}`,
      group: 'Skills',
      label: starter.title,
      detail: starter.prompt.split('. ')[0] ?? '',
      icon: starter.icon,
      choose: () => replaceTrigger(starter.prompt)
    }))
    return [...commandRows, ...skillRows]
  })()

  // Open whenever a trigger is live, even with nothing to offer: typing @ or / should always
  // answer, and a menu that vanishes on a query with no matches reads as "the feature broke".
  const open = menuTrigger !== null
  const active = rows.length > 0 ? Math.min(highlight, rows.length - 1) : 0
  useEffect(() => setHighlight(0), [menuTrigger?.char, menuTrigger?.query])
  // Keep the highlighted row visible as the arrows move it past the menu's edge.
  useEffect(() => {
    if (!open || rows.length === 0) return
    const row = document.getElementById(`${listId}-${active}`)
    // The first row of a group brings its heading with it, or wrapping back to the top would
    // show "New conversation" with the "Commands" heading scrolled away above it.
    const target = row?.previousElementSibling?.tagName === 'P' ? row.parentElement : row
    target?.scrollIntoView({ block: 'nearest' })
  }, [open, active, rows.length, listId])

  const syncCaret = (): void => setCaret(textareaRef.current?.selectionStart ?? 0)

  const send = (): void => {
    const text = draft.trim()
    if (!text || running) return
    void onSend(text)
  }

  const openMention = (): void => {
    const box = textareaRef.current
    const at = box?.selectionStart ?? draft.length
    const needsSpace = at > 0 && !/\s/.test(draft[at - 1] ?? '')
    const insert = `${needsSpace ? ' ' : ''}@`
    const next = draft.slice(0, at) + insert + draft.slice(at)
    setDraft(next)
    setDismissed(null)
    requestAnimationFrame(() => {
      box?.focus()
      box?.setSelectionRange(at + insert.length, at + insert.length)
      setCaret(at + insert.length)
    })
  }

  return (
    <div className="relative p-2">
      {open && (
        <div
          id={listId}
          role="listbox"
          aria-label={menuTrigger?.char === '@' ? 'Pin to this conversation' : 'Commands and skills'}
          className="absolute inset-x-2 bottom-full mb-1 max-h-72 overflow-y-auto overscroll-contain rounded-lg border border-line-strong bg-surface-2 py-1 shadow-pop"
        >
          {rows.length === 0 && (
            <p className="px-3 py-2 text-[12px] text-ink-2">
              {menuTrigger?.char === '@'
                ? `Nothing to pin matches “${menuTrigger.query}”.`
                : `No command or skill matches “${menuTrigger?.query ?? ''}”.`}
            </p>
          )}
          {rows.map((row, index) => {
            const Icon = row.icon
            const firstOfGroup = index === 0 || rows[index - 1]?.group !== row.group
            return (
              <div key={row.key}>
                {firstOfGroup && (
                  <p className="px-2.5 pt-1.5 pb-1 text-[10px] font-semibold tracking-[0.08em] text-ink-2 uppercase">
                    {row.group}
                  </p>
                )}
                <div
                  id={`${listId}-${index}`}
                  role="option"
                  aria-selected={index === active}
                  // Pointer-down, not click: a click lands after the textarea's blur, which is too
                  // late on some platforms to keep the query the row was chosen for.
                  onPointerDown={(event) => {
                    event.preventDefault()
                    row.choose()
                  }}
                  onPointerMove={() => setHighlight(index)}
                  className={cn(
                    'mx-1 flex cursor-default items-center gap-2 rounded-md px-1.5 py-1.5',
                    index === active ? 'bg-surface-4 text-ink-0' : 'text-ink-1'
                  )}
                >
                  <Icon aria-hidden="true" className="size-3.5 shrink-0 text-ink-2" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px]">{row.label}</span>
                    {row.detail && <span className="block truncate text-[11px] text-ink-2">{row.detail}</span>}
                  </span>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="t-fast rounded-xl border border-line-strong bg-surface-2 focus-within:border-line-hover">
        {pins.length > 0 && (
          <ul aria-label="Pinned" className="flex flex-wrap gap-1 px-2 pt-2">
            {pins.map((pin) => {
              const Icon = PIN_ICON[pin.kind]
              const label = pinLabel(pin, fps)
              return (
                <li
                  key={pinKey(pin)}
                  className={cn(
                    'flex max-w-full items-center gap-1 rounded-md border py-0.5 pr-0.5 pl-1.5 text-[11px]',
                    pin.kind === 'range' ? 'border-accent/50 bg-accent/10 text-ink-0' : 'border-line-strong bg-surface-3 text-ink-0'
                  )}
                >
                  <Icon aria-hidden="true" className="size-3 shrink-0 text-ink-2" />
                  <span className="truncate tabular-nums" title={label}>
                    {label}
                  </span>
                  <button
                    type="button"
                    aria-label={`Unpin ${label}`}
                    onClick={() => removePin(pinKey(pin))}
                    className="t-fast grid size-4 shrink-0 place-items-center rounded-sm text-ink-2 hover:bg-surface-4 hover:text-ink-0"
                  >
                    <X aria-hidden="true" className="size-3" />
                  </button>
                </li>
              )
            })}
          </ul>
        )}

        {rangeOpen && (
          <RangeEditor
            fps={fps}
            initial={(() => {
              const selected = timeline
                ? allItems(timeline).filter((item) => selection.includes(item.id))
                : []
              if (selected.length > 0) {
                return {
                  from: Math.min(...selected.map((item) => item.from)),
                  to: Math.max(...selected.map(itemEnd))
                }
              }
              return { from: playhead, to: playhead + Math.round(5 * fps) }
            })()}
            onCancel={() => {
              setRangeOpen(false)
              textareaRef.current?.focus()
            }}
            onPin={(fromFrame, toFrame) => {
              addPin({ kind: 'range', fromFrame, toFrame })
              setRangeOpen(false)
              textareaRef.current?.focus()
            }}
          />
        )}

        <textarea
          ref={textareaRef}
          value={draft}
          aria-label="Message the agent"
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={open && rows.length > 0 ? `${listId}-${active}` : undefined}
          onChange={(event) => {
            setDraft(event.target.value)
            setCaret(event.target.selectionStart)
            setDismissed(null)
          }}
          onSelect={syncCaret}
          onClick={syncCaret}
          onKeyDown={(event) => {
            if (open) {
              if (event.key === 'ArrowDown' && rows.length > 0) {
                event.preventDefault()
                setHighlight((active + 1) % rows.length)
                return
              }
              if (event.key === 'ArrowUp' && rows.length > 0) {
                event.preventDefault()
                setHighlight((active - 1 + rows.length) % rows.length)
                return
              }
              if ((event.key === 'Enter' || event.key === 'Tab') && rows.length > 0) {
                event.preventDefault()
                rows[active]?.choose()
                return
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                setDismissed(menuTrigger?.start ?? null)
                return
              }
            }
            // Enter sends, Shift+Enter breaks the line.
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              send()
            }
          }}
          rows={draft.length > 120 ? 6 : 3}
          placeholder="Describe what you'd like to create… (@ to pin, / for skills)"
          className="block w-full resize-none bg-transparent px-3 pt-2.5 text-[12.5px] leading-relaxed text-ink-0 outline-none placeholder:text-ink-2"
        />

        <div className="flex items-center gap-1 px-2 pt-1 pb-2">
          <span
            className="flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] text-ink-1"
            title="Claude Code, with bay's tools and nothing else"
          >
            <Bot aria-hidden="true" className="size-3.5" />
            Agent
          </span>
          <ToolbarButton label="Pin an asset, clip or time" icon={AtSign} onClick={openMention} />
          <ToolbarButton
            label="Pin a time range"
            icon={Clock}
            pressed={rangeOpen}
            onClick={() => setRangeOpen((value) => !value)}
          />
          {running && (
            <span className="ml-1 flex items-center gap-1 text-[11px] text-ink-2">
              <Loader2 aria-hidden="true" className="size-3 animate-spin" />
              Working…
            </span>
          )}
          <div className="flex-1" />
          {running ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop"
              title="Stop"
              className="t-press grid size-7 place-items-center rounded-full bg-surface-4 text-ink-0 hover:bg-line-hover active:scale-[0.96]"
            >
              <Square aria-hidden="true" className="size-3 fill-current" />
            </button>
          ) : (
            <button
              type="button"
              onClick={send}
              disabled={draft.trim().length === 0}
              aria-label="Send"
              title="Send (Enter)"
              className="t-press grid size-7 place-items-center rounded-full bg-accent text-accent-ink hover:bg-accent-hover active:scale-[0.96] disabled:bg-surface-4 disabled:text-ink-3"
            >
              <ArrowUp aria-hidden="true" className="size-4" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

function ToolbarButton({
  label,
  icon: Icon,
  onClick,
  pressed
}: {
  label: string
  icon: LucideIcon
  onClick: () => void
  pressed?: boolean
}): ReactNode {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
      className={cn(
        't-press grid size-7 place-items-center rounded-md hover:bg-surface-3 hover:text-ink-0 active:scale-[0.96]',
        pressed ? 'bg-surface-3 text-ink-0' : 'text-ink-2'
      )}
    >
      <Icon aria-hidden="true" className="size-3.5" />
    </button>
  )
}

/**
 * Two time fields and a Pin button. Accepts what the timeline shows (`0:10:00`), seconds
 * (`4.5s`) or frames (`135f`), and refuses anything else with the reason — a bound that was
 * guessed is a range the agent then keeps to wrongly.
 */
function RangeEditor({
  fps,
  initial,
  onPin,
  onCancel
}: {
  fps: number
  initial: { from: number; to: number }
  onPin: (fromFrame: number, toFrame: number) => void
  onCancel: () => void
}): ReactNode {
  const [from, setFrom] = useState(formatTimecode(initial.from, fps, true))
  const [to, setTo] = useState(formatTimecode(initial.to, fps, true))
  const fromRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => fromRef.current?.select(), [])

  const fromFrame = parseTime(from, fps)
  const toFrame = parseTime(to, fps)
  const problem =
    fromFrame === null
      ? 'Start is not a time. Use 0:10:00, 4.5s or 135f.'
      : toFrame === null
        ? 'End is not a time. Use 0:10:00, 4.5s or 135f.'
        : toFrame <= fromFrame
          ? 'End must be after the start.'
          : null

  const submit = (): void => {
    if (problem || fromFrame === null || toFrame === null) return
    onPin(fromFrame, toFrame)
  }

  const field = (
    label: string,
    value: string,
    set: (value: string) => void,
    ref?: React.RefObject<HTMLInputElement | null>
  ): ReactNode => (
    <label className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="text-[10px] font-semibold tracking-[0.08em] text-ink-2 uppercase">{label}</span>
      <input
        ref={ref}
        value={value}
        onChange={(event) => set(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            submit()
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            onCancel()
          }
        }}
        spellCheck={false}
        autoComplete="off"
        className="h-7 w-full rounded-md border border-line-strong bg-surface-1 px-2 font-mono text-[11px] text-ink-0 tabular-nums outline-none focus:border-accent"
      />
    </label>
  )

  return (
    <div role="group" aria-label="Pin a time range" className="mx-2 mt-2 rounded-lg border border-line bg-surface-1 p-2">
      <div className="flex items-end gap-2">
        {field('Start', from, setFrom, fromRef)}
        {field('End', to, setTo)}
        <button
          type="button"
          onClick={submit}
          disabled={problem !== null}
          className="t-press h-7 shrink-0 rounded-md bg-accent px-2.5 text-[11px] font-medium text-accent-ink hover:bg-accent-hover active:scale-[0.96] disabled:bg-surface-4 disabled:text-ink-3"
        >
          Pin range
        </button>
      </div>
      <p aria-live="polite" className={cn('mt-1.5 text-[11px]', problem ? 'text-danger' : 'text-ink-2')}>
        {problem ?? 'The agent will change nothing outside this range.'}
      </p>
    </div>
  )
}
