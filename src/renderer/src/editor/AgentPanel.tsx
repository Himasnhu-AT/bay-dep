import { useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react'
import {
  AlertTriangle,
  Brain,
  Check,
  ChevronRight,
  Film,
  Loader2,
  MessageSquarePlus,
  MessagesSquare,
  MoreHorizontal,
  Paperclip,
  Sparkles,
  Undo2,
  X
} from 'lucide-react'
import { approvalMessage, DECLINED_MESSAGE, formatElapsed, type AgentEntry } from '@shared/agent'
import {
  BayMark,
  Button,
  IconButton,
  Markdown,
  Menu,
  ScrollArea,
  Tabs,
  Tooltip,
  useFloatingTrigger,
  type MenuEntry
} from '@/components'
import { AGENT_STARTERS, STARTERS_SHOWN, type AgentStarter } from './agentStarters'
import { GeneratePanel } from './ai/GeneratePanel'
import { bay } from '@/lib/bay'
import { PROVIDER_LABELS, useAgentProvider } from '@/lib/agentProvider'
import { revertImpact, selectFps, useEditor } from '@/store/editor'
import { composeMessage, pinLabel, type Pin } from '@shared/pins'
import { insertSkill, skillSegments } from '@shared/skills'
import { estimateToolCallUsd } from '@shared/generation'
import { estimateSpeechToolCallUsd } from '@shared/speech'
import { toolPreview } from '@shared/tool-preview'
import { Composer } from './Composer'
import { ASSET_DRAG_TYPE } from './AssetTile'
import { findAsset } from '@shared/project'
import { isAttachableFile, manyImagesNote, splitDrop, type AgentAttachmentView } from '@shared/agent-attachments'
import {
  deliverMessage,
  IMPORT_FILES_EVENT,
  makeThumb,
  pendingFromAsset,
  pendingFromFile,
  picturesSent,
  roomFor,
  toInput,
  toView,
  type PendingAttachment
} from '@/lib/agentAttachments'
import { cn } from '@/lib/cn'

/**
 * Claude Code, in the editor.
 *
 * Three things this panel deliberately does not do.
 *
 * It does not render permission prompts. Permission is decided once, on a proposal card, and a
 * prompt per call is answered by reflex within about three calls — after that it is a button
 * that means nothing. The agent runs with bay's tools and nothing else; the gate in
 * `@shared/agent` is what stops it writing until the user has agreed to a plan.
 *
 * It does not show raw arguments by default. A reader following an edit wants "remove_range"
 * and whether it worked; the arguments matter when something went wrong, so they are one click
 * away rather than always on screen.
 *
 * It does not collapse a refusal into a red icon. In bay a refusal is a recovery instruction —
 * it names the ids to use or the range that is occupied — and the whole point of writing that
 * is that somebody reads it.
 */
export function AgentPanel(): ReactNode {
  const log = useEditor((state) => state.agentLog)
  const running = useEditor((state) => state.agentRunning)
  const logUserMessage = useEditor((state) => state.logUserMessage)
  const startAgentSession = useEditor((state) => state.startAgentSession)
  const endAgentSession = useEditor((state) => state.endAgentSession)
  const clearAgentLog = useEditor((state) => state.clearAgentLog)

  const [draft, setDraft] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [attachments, setAttachments] = useState<PendingAttachment[]>([])
  const [dragOver, setDragOver] = useState(false)
  const [sending, setSending] = useState(false)
  const sendingNow = useRef(false)
  const manyPictures = manyImagesNote(picturesSent(log))

  /**
   * Add what the user attached, up to the limit, saying what was refused and why. Thumbnails are
   * made after the chips appear, so a large video does not hold the chip back.
   */
  const addAttachments = (candidates: Array<{ ok: true; pending: PendingAttachment } | { ok: false; error: string }>): void => {
    const refused = candidates.flatMap((c) => (c.ok ? [] : [c.error]))
    const accepted = candidates.flatMap((c) => (c.ok ? [c.pending] : []))
    const room = roomFor(attachments.length, accepted.length)
    const taken = accepted.slice(0, room.take)
    if (room.error) refused.push(room.error)
    setProblem(refused.length > 0 ? refused.join(' ') : null)
    if (taken.length === 0) return
    setAttachments((list) => [...list, ...taken])
    for (const pending of taken) {
      void makeThumb(pending).then((thumb) =>
        setAttachments((list) => list.map((a) => (a.id === pending.id ? { ...a, thumb } : a)))
      )
    }
  }
  const addFiles = (files: readonly File[]): void => {
    let pasted = 0
    addAttachments(files.map((file) => pendingFromFile(file, `Pasted image ${(pasted += 1)}`)))
  }
  const removeAttachment = (id: string): void => setAttachments((list) => list.filter((a) => a.id !== id))

  // Files from Finder and assets from the media bin. Only pictures and video are the panel's: a
  // drop here is taken (`preventDefault`, which the window's own handler respects) only when it
  // holds at least one, and whatever else it holds is handed to the window's import
  // (`IMPORT_FILES_EVENT`) — dropping a song or a caption file here imports it, as anywhere else.
  // While dragging, only MIME types are visible, so a Finder file without one (some `.mkv`) shows
  // the import overlay but is still attached on drop, where its name can be read.
  const mediaDrag = (event: DragEvent): boolean =>
    event.dataTransfer.types.includes(ASSET_DRAG_TYPE) ||
    Array.from(event.dataTransfer.items).some((item) => item.kind === 'file' && isAttachableFile('', item.type))
  const onDragOver = (event: DragEvent): void => {
    if (!mediaDrag(event)) {
      setDragOver(false)
      return
    }
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    setDragOver(true)
  }
  const onDrop = (event: DragEvent): void => {
    setDragOver(false)
    const assetId = event.dataTransfer.getData(ASSET_DRAG_TYPE)
    if (assetId) {
      event.preventDefault()
      const asset = findAsset(useEditor.getState().project, assetId)
      addAttachments([asset ? pendingFromAsset(asset) : { ok: false, error: 'That asset is no longer in the project.' }])
      return
    }
    const files = Array.from(event.dataTransfer.files)
    const { attach, importRest } = splitDrop(files.map((file) => ({ name: file.name, type: file.type })))
    // Nothing to attach: not the panel's drop. The window imports it all.
    if (attach.length === 0) return
    event.preventDefault()
    addFiles(attach.map((i) => files[i]!))
    if (importRest.length > 0) window.dispatchEvent(new CustomEvent(IMPORT_FILES_EVENT, { detail: importRest.map((i) => files[i]!) }))
  }
  const bottom = useRef<HTMLDivElement | null>(null)
  const composer = useRef<HTMLTextAreaElement | null>(null)
  const [tab, setTab] = useState<AgentTab>('chat')

  const focusComposer = (): void => {
    requestAnimationFrame(() => {
      const box = composer.current
      if (!box) return
      box.focus()
      box.setSelectionRange(box.value.length, box.value.length)
    })
  }

  // A starter fills the composer and hands it back to the user — never sends. The prompt is a
  // draft: which clip, whose name, what style are theirs to add, and sending on click would
  // start a paid turn from a single mis-click.
  const pickStarter = (starter: AgentStarter): void => {
    setDraft(insertSkill(draft, starter.skill))
    focusComposer()
  }

  // A quick action on the Generate tab: the same, from the other tab. What was already typed is
  // kept, with the action's words after it.
  const pickQuickAction = (text: string): void => {
    const body = draft.replace(/\s+$/, '')
    setDraft(body ? `${body} ${text}` : text)
    setTab('chat')
    focusComposer()
  }

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [log])

  // Switching provider in Settings starts a new conversation: the other model has none of this
  // one's context, so carrying the log over would show a history it never saw.
  const provider = useAgentProvider((state) => state.provider)
  const startedWith = useRef(provider)
  useEffect(() => {
    if (startedWith.current === provider) return
    startedWith.current = provider
    if (useEditor.getState().agentSessionActive || useEditor.getState().agentLog.length > 0) reset()
    // `reset` is recreated each render and reads only store actions; the provider is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider])

  /**
   * One user turn, from the text box or from a decision on a proposal card.
   *
   * The card goes through here too, and has to: an approval that only changed the gate would
   * leave the model waiting — correctly, since it was told to end its turn and wait — for a
   * message that never comes. The decision *is* the next message.
   */
  /**
   * `shown` is what the conversation displays when it differs from what the agent receives — an
   * approval is one short line to the user and the full list of calls to the model.
   */
  const deliver = async (
    text: string,
    pins: Pin[] = [],
    shown?: string,
    attached: PendingAttachment[] = []
  ): Promise<void> => {
    // `sendingNow` rather than the state: two clicks in one frame both read the state as false.
    if ((!text && attached.length === 0) || running || sendingNow.current) return
    const api = bay()
    if (!api) {
      setProblem('bay is not answering. The main process may still be starting.')
      if (attached.length > 0) setAttachments((list) => [...attached, ...list])
      return
    }
    setProblem(null)
    logUserMessage(shown ?? text, pins, attached.map(toView))

    // From the click until main has the message — the start, reading the files, main preparing a
    // video — the composer says so and takes no second message, which would otherwise be sent
    // while this one was still on its way.
    sendingNow.current = true
    setSending(true)
    try {
      await deliverMessage(attached, {
        // Starting is separate from sending so a missing `claude` binary reads as "could not
        // start" rather than as a model that ignored the message.
        start: async () => {
          if (useEditor.getState().agentSessionActive) return { ok: true }
          const started = await api.agent.start({ provider: useAgentProvider.getState().provider })
          if (started.ok) startAgentSession()
          return started.ok ? { ok: true } : started
        },
        toInputs: (list) => Promise.all(list.map(toInput)),
        // The log shows what was typed, with the pins as chips; the agent receives the pins
        // spelled out as ids and frames ahead of it.
        send: (inputs) => api.agent.send(composeMessage(text, pins, selectFps(useEditor.getState())), inputs),
        // Given back rather than lost: the user removes the one that was refused and sends again.
        giveBack: (list) => setAttachments((current) => [...list, ...current]),
        problem: setProblem
      })
    } finally {
      sendingNow.current = false
      setSending(false)
    }
  }

  // Typed messages carry the pins; a decision on a proposal card does not — it already names
  // the exact calls it approves.
  const send = async (text: string): Promise<void> => {
    const attached = attachments
    setDraft('')
    setAttachments([])
    await deliver(text, useEditor.getState().agentPins, undefined, attached)
  }

  const stop = (): void => {
    void bay()?.agent.stop()
  }

  const debugMode = useEditor((state) => state.debugMode)
  const notify = useEditor((state) => state.notify)
  const [exporting, setExporting] = useState(false)
  const exportTranscript = async (): Promise<void> => {
    const api = bay()
    if (!api) return
    setExporting(true)
    try {
      const state = useEditor.getState()
      const result = await api.agent.exportTranscript(state.project.name, state.agentLog)
      if (result.ok) notify(`Transcript exported to ${result.folder}`)
      else notify(result.error, 'error')
    } finally {
      setExporting(false)
    }
  }

  const reset = (): void => {
    void bay()?.agent.dispose()
    endAgentSession()
    clearAgentLog()
    useEditor.getState().clearAgentPins()
    setAttachments([])
    setDraft('')
    setProblem(null)
  }

  const moreItems: MenuEntry[] = [
    { label: 'Agent settings…', onSelect: () => useEditor.getState().setSettingsOpen(true, 'agent') },
    ...(debugMode
      ? [
          { kind: 'separator' as const },
          {
            label: exporting ? 'Exporting transcript…' : 'Export transcript',
            disabled: log.length === 0 || exporting,
            onSelect: () => void exportTranscript()
          }
        ]
      : [])
  ]

  return (
    <section aria-labelledby="agent-dock-title" className="flex h-full min-h-0 flex-col bg-surface-1">
      <AgentHeader
        canReset={log.length > 0 || attachments.length > 0 || draft.length > 0}
        onReset={reset}
        moreItems={moreItems}
      />
      <Tabs<AgentTab>
        label="Agent views"
        value={tab}
        onChange={setTab}
        items={[
          { value: 'chat', label: 'Chat', icon: <MessagesSquare aria-hidden="true" className="size-3.5" /> },
          { value: 'generate', label: 'Generate', icon: <Sparkles aria-hidden="true" className="size-3.5" /> }
        ]}
      />
      {tab === 'generate' ? (
        <ScrollArea className="min-h-0 flex-1">
          <GeneratePanel onDraft={pickQuickAction} />
        </ScrollArea>
      ) : (
      <div
        className={cn('relative flex min-h-0 flex-1 flex-col', dragOver && 'ring-2 ring-accent ring-inset')}
        onDragOver={onDragOver}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOver(false)
        }}
        onDrop={onDrop}
      >
      {dragOver && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-10 grid place-items-center bg-accent/5 text-[12px] font-medium text-ink-0"
        >
          <span className="flex items-center gap-1.5 rounded-md bg-surface-2 px-2 py-1 shadow-pop">
            <Paperclip className="size-3.5" /> Attach to the message
          </span>
        </div>
      )}
      <ScrollArea className="flex-1">
        {log.length === 0 ? (
          <Starters onPick={pickStarter} />
        ) : (
          <div className="flex flex-col gap-2 p-2">
            {log.map((entry) => (
              <Entry key={entry.id} entry={entry} deliver={deliver} />
            ))}
            <ThinkingNow />
            <div ref={bottom} />
          </div>
        )}
      </ScrollArea>

      {problem && (
        <div className="flex items-start gap-2 border-t border-line px-2 py-1.5 text-[11px] text-danger">
          <AlertTriangle aria-hidden="true" className="mt-px size-3.5 shrink-0" />
          <p className="leading-relaxed">{problem}</p>
        </div>
      )}

      {manyPictures && (
        <p className="border-t border-line px-2 py-1.5 text-[11px] leading-relaxed text-ink-2">{manyPictures}</p>
      )}

      <Composer
        running={running}
        sending={sending}
        onSend={send}
        onStop={stop}
        onNewConversation={reset}
        draft={draft}
        setDraft={setDraft}
        textareaRef={composer}
        attachments={attachments}
        onAddFiles={addFiles}
        onRemoveAttachment={removeAttachment}
      />
      </div>
      )}
    </section>
  )
}

type AgentTab = 'chat' | 'generate'

/**
 * The dock's title strip: the mark and "Agent", which model is answering, and the three things
 * a person does to the conversation as a whole — start over, the rare options, close.
 */
function AgentHeader({
  canReset,
  onReset,
  moreItems
}: {
  canReset: boolean
  onReset: () => void
  moreItems: MenuEntry[]
}): ReactNode {
  const provider = useAgentProvider((state) => state.provider)
  const running = useEditor((state) => state.agentRunning)
  const setAgentDocked = useEditor((state) => state.setAgentDocked)
  const more = useFloatingTrigger()
  return (
    <header className="@container flex h-9 shrink-0 items-center gap-1.5 border-b border-line bg-chrome pr-1 pl-2.5">
      <BayMark variant="glyph" size={15} />
      <h2 id="agent-dock-title" className="text-[13px] font-semibold text-ink-0">
        Agent
      </h2>
      <Tooltip label={`Answered by ${PROVIDER_LABELS[provider]}, with bay's tools and nothing else. Change it in Preferences › Agent.`}>
        <button
          type="button"
          onClick={() => useEditor.getState().setSettingsOpen(true, 'agent')}
          className="t-fast flex h-5 items-center gap-1 rounded-full border border-line-strong px-1.5 text-[10.5px] text-ink-1 hover:border-line-hover hover:text-ink-0"
        >
          {running && <Loader2 aria-hidden="true" className="size-2.5 animate-spin" />}
          {PROVIDER_LABELS[provider]}
        </button>
      </Tooltip>
      <div className="flex-1" />
      <Tooltip label="New conversation" detail="Clears the chat and the pins. The project is not touched.">
        <button
          type="button"
          aria-label="New conversation"
          disabled={!canReset}
          onClick={onReset}
          className="t-press flex h-7 items-center gap-1 rounded-sm px-1.5 text-[11px] font-medium text-ink-1 hover:bg-surface-3 hover:text-ink-0 disabled:pointer-events-none disabled:opacity-35"
        >
          <MessageSquarePlus aria-hidden="true" className="size-3.5" />
          <span className="hidden @[260px]:inline">New</span>
        </button>
      </Tooltip>
      <IconButton {...more.triggerProps} label="More agent options" icon={<MoreHorizontal className="size-3.5" />} />
      <Menu {...more.surfaceProps} label="Agent options" side="bottom" align="end" items={moreItems} />
      <IconButton label="Close the agent" icon={<X className="size-3.5" />} onClick={() => setAgentDocked(false)} />
    </header>
  )
}

type Deliver = (text: string, pins?: Pin[], shown?: string, attached?: PendingAttachment[]) => Promise<void>

/** An attachment as the transcript shows it: its thumbnail, or its name when there is none. */
function AttachmentThumb({ view }: { view: AgentAttachmentView }): ReactNode {
  return (
    <li
      title={view.name}
      className="relative grid size-14 place-items-center overflow-hidden rounded-md border border-line-strong bg-surface-2"
    >
      {view.thumb ? (
        <img src={view.thumb} alt={view.name} className="size-full object-cover" draggable={false} />
      ) : (
        <span className="px-1 text-center text-[9.5px] leading-tight break-all text-ink-2">{view.name}</span>
      )}
      {view.kind === 'video' && (
        <Film aria-label="video" className="absolute right-0.5 bottom-0.5 size-3 rounded-sm bg-black/60 p-px text-white" />
      )}
    </li>
  )
}

/** What the user sent: their words, with what they had pinned shown as chips above them. */
function UserEntry({ entry }: { entry: Extract<AgentEntry, { kind: 'user' }> }): ReactNode {
  const fps = useEditor(selectFps)

  return (
    <div className="flex max-w-[92%] flex-col items-end gap-1 self-end">
      {entry.attachments && entry.attachments.length > 0 && (
        <ul aria-label="Attached to this message" className="flex flex-wrap justify-end gap-1">
          {entry.attachments.map((view, index) => (
            <AttachmentThumb key={index} view={view} />
          ))}
        </ul>
      )}
      {entry.pins && entry.pins.length > 0 && (
        <ul aria-label="Pinned for this message" className="flex flex-wrap justify-end gap-1">
          {entry.pins.map((pin) => (
            <li
              key={`${pin.kind}:${pinLabel(pin, fps)}`}
              className={`rounded-md border px-1.5 py-0.5 text-[10.5px] tabular-nums ${
                pin.kind === 'range' ? 'border-accent/50 bg-accent/10 text-ink-0' : 'border-line-strong bg-surface-2 text-ink-1'
              }`}
            >
              {pinLabel(pin, fps)}
            </li>
          ))}
        </ul>
      )}
      {entry.text && <p className="rounded-lg bg-surface-3 px-2.5 py-1.5 text-[12px] leading-relaxed whitespace-pre-wrap text-ink-0">
        {skillSegments(entry.text).map((part, index) =>
          part.skill ? (
            <span
              key={index}
              title={part.skill.title}
              className="rounded-sm bg-accent/15 px-1 py-px font-medium text-accent"
            >
              {part.text}
            </span>
          ) : (
            <span key={index}>{part.text}</span>
          )
        )}
      </p>}
    </div>
  )
}

/** The empty conversation: a question and a grid of places to start. */
function Starters({ onPick }: { onPick: (starter: AgentStarter) => void }): ReactNode {
  const [all, setAll] = useState(false)
  const shown = all ? AGENT_STARTERS : AGENT_STARTERS.slice(0, STARTERS_SHOWN)
  return (
    <div className="@container flex min-h-full flex-col justify-center px-3 py-6">
      <h3 className="mb-3 text-center text-[14px] font-medium text-balance text-ink-0">
        What do you want to create today?
      </h3>
      <div className="grid grid-cols-1 gap-1.5 @[300px]:grid-cols-2">
        {shown.map((starter) => {
          const Icon = starter.icon
          return (
            <button
              key={starter.skill}
              type="button"
              onClick={() => onPick(starter)}
              className="t-fast flex min-w-0 items-center gap-2 rounded-lg border border-line bg-surface-2 p-1.5 text-left hover:border-line-hover hover:bg-surface-3"
            >
              <span
                aria-hidden="true"
                className="grid size-7 shrink-0 place-items-center rounded-md text-on-media"
                style={{
                  backgroundImage: `linear-gradient(135deg, ${starter.tint[0]}, ${starter.tint[1]})`
                }}
              >
                <Icon className="size-4" />
              </span>
              <span className="line-clamp-2 min-w-0 flex-1 text-[12px] leading-snug font-medium text-ink-0">
                {starter.title}
              </span>
              {starter.badge && (
                <span className="shrink-0 text-[9px] font-semibold tracking-[0.08em] text-accent uppercase">
                  {starter.badge}
                </span>
              )}
            </button>
          )
        })}
      </div>
      {AGENT_STARTERS.length > STARTERS_SHOWN && (
        <button
          type="button"
          onClick={() => setAll((value) => !value)}
          className="t-fast mx-auto mt-3 flex items-center gap-1 rounded-sm px-2 py-1 text-[11px] text-ink-1 hover:text-ink-0"
        >
          {all ? 'Less' : 'More'}
          <ChevronRight
            aria-hidden="true"
            className={`size-3 transition-transform ${all ? '-rotate-90' : ''}`}
          />
        </button>
      )}
      <p className="mt-4 text-center text-[11px] leading-relaxed text-ink-2">
        It reads the project and makes the edits. Every change shows as a diff you can revert.
      </p>
    </div>
  )
}

function Entry({ entry, deliver }: { entry: AgentEntry; deliver: Deliver }): ReactNode {
  switch (entry.kind) {
    case 'user':
      return <UserEntry entry={entry} />
    case 'assistant':
      return <Markdown className="text-[12px] leading-relaxed text-ink-1">{entry.text}</Markdown>
    case 'thought':
      return (
        <p className="border-l-2 border-line pl-2 text-[11px] leading-relaxed whitespace-pre-wrap text-ink-2">
          {entry.text}
        </p>
      )
    case 'error':
      return (
        <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-danger">
          <AlertTriangle aria-hidden="true" className="mt-px size-3.5 shrink-0" />
          {entry.text}
        </p>
      )
    case 'tool':
      // A proposal that landed is shown as its card, directly below; the call that carried it
      // would be the same thing twice. One that was refused keeps its card, because the refusal
      // is what the reader needs.
      if (entry.tool === 'propose_edit' && entry.state === 'done') return null
      return <ToolCard entry={entry} />
    case 'proposal':
      return <ProposalCard entry={entry} deliver={deliver} />
    case 'changes':
      return <ChangesCard entry={entry} />
    case 'thinking':
      return (
        <p className="flex items-center gap-1.5 text-[11px] text-ink-2 tabular-nums">
          <Brain aria-hidden="true" className="size-3 shrink-0" />
          Thought for {formatElapsed(entry.seconds)}
        </p>
      )
  }
}

/**
 * While the model thinks: a live line with the time so far. Its reasoning is not sent (current
 * models default to omitting it), so this is the only sign a long think is progress rather than a
 * hang — the case that read as "stuck for three minutes".
 */
function ThinkingNow(): ReactNode {
  const since = useEditor((state) => state.agentThinkingSince)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (since === null) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [since])
  if (since === null) return null
  return (
    <p role="status" className="flex items-center gap-1.5 text-[11px] text-ink-2 tabular-nums">
      <Brain aria-hidden="true" className="size-3 shrink-0 animate-pulse" />
      Thinking · {formatElapsed((now - since) / 1000)}
    </p>
  )
}

function ToolCard({ entry }: { entry: Extract<AgentEntry, { kind: 'tool' }> }): ReactNode {
  const [open, setOpen] = useState(false)
  const hasArgs = Object.keys(entry.args).length > 0
  // A failed call opens itself. Its text is the recovery instruction, and hiding that behind a
  // click is hiding the only part that helps.
  const expanded = open || entry.state === 'failed'
  // A paid call says what it costs where the user already looks: on the card, not in its result.
  const costUsd = estimateToolCallUsd(entry.tool, entry.args) ?? estimateSpeechToolCallUsd(entry.tool, entry.args)

  return (
    <div className="rounded border border-line bg-surface-2 text-[11px]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-1.5 px-2 py-1 text-left"
      >
        {entry.state === 'running' ? (
          <Loader2 aria-hidden="true" className="size-3 shrink-0 animate-spin text-ink-2" />
        ) : entry.state === 'failed' ? (
          <AlertTriangle aria-hidden="true" className="size-3 shrink-0 text-danger" />
        ) : (
          <Check aria-hidden="true" className="size-3 shrink-0 text-ink-2" />
        )}
        <span className="font-mono text-ink-1">
          {/* A skill load reads as the skill, the way it was asked for — "Skill" alone says
              nothing about which one. */}
          {entry.tool === 'Skill' && typeof entry.args['skill'] === 'string'
            ? `/${entry.args['skill']} loaded`
            : entry.tool}
        </span>
        {costUsd !== null && (
          <span className="font-mono text-ink-2" title="Estimated from list prices; the provider bills the actual amount.">
            ~${costUsd.toFixed(2)}
          </span>
        )}
        {(hasArgs || entry.result) && (
          <ChevronRight
            aria-hidden="true"
            className={`ml-auto size-3 shrink-0 text-ink-3 transition-transform ${expanded ? 'rotate-90' : ''}`}
          />
        )}
      </button>
      {entry.state === 'running' && entry.input && <StreamingInput tool={entry.tool} input={entry.input} />}
      {expanded && (
        <div className="border-t border-line px-2 py-1.5">
          {hasArgs && (
            <pre className="overflow-x-auto font-mono text-[10px] leading-relaxed text-ink-2">
              {JSON.stringify(entry.args, null, 2)}
            </pre>
          )}
          {entry.result && (
            <p
              className={`mt-1 leading-relaxed whitespace-pre-wrap ${entry.state === 'failed' ? 'text-danger' : 'text-ink-2'}`}
            >
              {entry.result}
            </p>
          )}
        </div>
      )}
    </div>
  )
}

/**
 * A tool call while the model is still writing it: what is being written, how much so far, and the
 * end of it, kept scrolled to the newest line — the way a terminal shows a file being written.
 */
function StreamingInput({ tool, input }: { tool: string; input: string }): ReactNode {
  const { label, tail } = toolPreview(tool, input)
  const boxRef = useRef<HTMLPreElement>(null)
  useEffect(() => {
    const box = boxRef.current
    if (box) box.scrollTop = box.scrollHeight
  }, [tail])
  return (
    <div className="border-t border-line px-2 py-1.5">
      <div className="mb-1 text-[10.5px] text-ink-2 tabular-nums">{label}</div>
      <pre
        ref={boxRef}
        aria-live="off"
        className="max-h-40 overflow-hidden font-mono text-[10px] leading-relaxed whitespace-pre-wrap text-ink-2"
      >
        {tail}
      </pre>
    </div>
  )
}

/**
 * The approval card.
 *
 * Every operation is listed with its arguments, because approving a plan you cannot see is not
 * approving anything. Once a choice is made the card stays in place showing what was approved —
 * a card that vanished would leave the conversation claiming an edit nobody could point at.
 */
/**
 * The approval card, for when "Ask before editing" is on. Trimmed to the decision: each option is
 * its label, one line of what it does, and Approve. The exact calls — what the gate will hold the
 * agent to — are one click away rather than on screen, and once decided the card is one line.
 */
function ProposalCard({
  entry,
  deliver
}: {
  entry: Extract<AgentEntry, { kind: 'proposal' }>
  deliver: Deliver
}): ReactNode {
  const pending = useEditor((state) => state.agentProposal?.id === entry.proposal.id)
  const running = useEditor((state) => state.agentRunning)
  const approved = useEditor((state) => state.agentGate?.approved)
  const approveProposal = useEditor((state) => state.approveProposal)
  const declineProposal = useEditor((state) => state.declineProposal)
  const chosen = entry.proposal.options.find(
    (option) => approved?.proposalId === entry.proposal.id && approved.option.id === option.id
  )
  const [details, setDetails] = useState<string | null>(null)

  // The decision is a turn, and a turn cannot start while the agent is still in one.
  const approve = (optionId: string): void => {
    const option = entry.proposal.options.find((o) => o.id === optionId)
    if (!option || running) return
    approveProposal(entry.proposal, optionId)
    void deliver(approvalMessage(option), [], `Approved “${option.label}”`)
  }
  const decline = (): void => {
    if (running) return
    declineProposal()
    void deliver(DECLINED_MESSAGE, [], 'None of these')
  }

  if (!pending) {
    return (
      <p className="flex items-center gap-1.5 text-[11px] text-ink-2">
        <Check aria-hidden="true" className="size-3 shrink-0" />
        {chosen ? `Approved: ${chosen.label}` : `Asked: ${entry.proposal.question}`}
      </p>
    )
  }

  return (
    <div className="rounded-lg border border-accent/60 bg-surface-2 p-2 text-[11px]">
      <p className="mb-1.5 text-[12px] font-medium text-ink-0">{entry.proposal.question}</p>
      <ul className="flex flex-col gap-1">
        {entry.proposal.options.map((option) => (
          <li key={option.id} className="rounded-md border border-line bg-surface-1 px-2 py-1.5">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-[12px] text-ink-0">{option.label}</p>
                <p className="line-clamp-1 text-ink-2" title={option.summary}>
                  {option.summary}
                </p>
              </div>
              <Button variant="primary" disabled={running} onClick={() => approve(option.id)}>
                Approve
              </Button>
            </div>
            <button
              type="button"
              aria-expanded={details === option.id}
              onClick={() => setDetails((value) => (value === option.id ? null : option.id))}
              className="t-fast mt-1 flex items-center gap-0.5 text-[10.5px] text-ink-2 hover:text-ink-1"
            >
              <ChevronRight
                aria-hidden="true"
                className={`size-3 transition-transform ${details === option.id ? 'rotate-90' : ''}`}
              />
              {option.operations.length} edit{option.operations.length === 1 ? '' : 's'}
            </button>
            {details === option.id && (
              <ul className="mt-1 flex flex-col gap-0.5">
                {option.operations.map((operation) => (
                  <li key={operation.index} className="font-mono text-[10px] break-all whitespace-pre-wrap text-ink-2">
                    {operation.tool} {JSON.stringify(operation.args)}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
      <div className="mt-1.5 flex items-center gap-1.5">
        <Button variant="subtle" disabled={running} onClick={decline}>
          None of these
        </Button>
        {running && <span className="text-ink-2">Waiting for the agent to finish…</span>}
      </div>
    </div>
  )
}

/**
 * What an agent turn changed, like a commit: the diff, and Revert. Revert puts the project back
 * as it was before the turn — as one undoable step, so ⌘Z brings the change back — and says when
 * later turns will go with it, because restoring an earlier state undoes everything after it.
 */
function ChangesCard({ entry }: { entry: Extract<AgentEntry, { kind: 'changes' }> }): ReactNode {
  const revert = useEditor((state) => state.revertAgentChange)
  const notify = useEditor((state) => state.notify)
  const running = useEditor((state) => state.agentRunning)
  // Two numbers, not an object: a selector returning a fresh object re-renders on every change.
  const laterTurns = useEditor((state) => revertImpact(state, entry.id).laterTurns)
  const laterEdits = useEditor((state) => revertImpact(state, entry.id).laterEdits)
  const [open, setOpen] = useState(false)
  // A revert that would also discard edits made since asks once, in place.
  const [confirming, setConfirming] = useState(false)
  const settled = entry.state !== 'applied'
  const shown = open ? entry.lines : entry.lines.slice(0, 4)
  const glyph = { added: '+', removed: '−', changed: '~' } as const
  const tone = { added: 'text-success', removed: 'text-danger', changed: 'text-ink-2' } as const
  const heading =
    entry.state === 'reverted'
      ? 'Reverted'
      : entry.state === 'expired'
        ? 'Can no longer be reverted'
        : `${entry.lines.length} change${entry.lines.length === 1 ? '' : 's'}`

  const doRevert = (): void => {
    setConfirming(false)
    revert(entry.id)
    if (useEditor.getState().agentLog.find((e) => e.id === entry.id && e.kind === 'changes' && e.state === 'reverted')) {
      notify(
        laterTurns > 0
          ? `Reverted this and ${laterTurns} later change${laterTurns === 1 ? '' : 's'}. ⌘Z to undo.`
          : 'Reverted. ⌘Z to undo.'
      )
    }
  }

  return (
    <div className={`rounded-lg border border-line bg-surface-2 text-[11px] ${settled ? 'opacity-60' : ''}`}>
      <div className="flex items-center gap-2 border-b border-line px-2 py-1.5">
        <span className="font-medium text-ink-0">{heading}</span>
        <div className="flex-1" />
        {entry.state === 'applied' && !confirming && (
          <Button
            variant="subtle"
            icon={<Undo2 className="size-3" />}
            disabled={running}
            title={running ? 'Wait for the agent to finish, or stop it, to revert' : 'Put the project back as it was before this — ⌘Z brings it back'}
            onClick={() => (laterEdits ? setConfirming(true) : doRevert())}
          >
            {laterTurns > 0 ? `Revert (+${laterTurns} later)` : 'Revert'}
          </Button>
        )}
      </div>
      {confirming && (
        <div className="flex items-center gap-2 border-b border-line bg-warning/10 px-2 py-1.5">
          <span className="min-w-0 flex-1 text-pretty text-ink-1">
            The project has changed since. Reverting also undoes those changes (⌘Z brings them back).
          </span>
          <Button variant="ghost" onClick={() => setConfirming(false)}>
            Cancel
          </Button>
          <Button variant="subtle" icon={<Undo2 className="size-3" />} onClick={doRevert}>
            Revert anyway
          </Button>
        </div>
      )}
      {entry.note && entry.state === 'applied' && (
        <p className="border-b border-line px-2 py-1 text-pretty text-ink-2">{entry.note}</p>
      )}
      <ul className="flex flex-col gap-0.5 px-2 py-1.5">
        {shown.map((line, index) => (
          <li key={index} className={`flex gap-1.5 leading-relaxed ${entry.state === 'reverted' ? 'line-through' : ''}`}>
            <span aria-hidden="true" className={`w-2 shrink-0 font-mono ${tone[line.kind]}`}>
              {glyph[line.kind]}
            </span>
            <span className="min-w-0 text-ink-1">{line.text}</span>
          </li>
        ))}
      </ul>
      {entry.lines.length > 4 && (
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="t-fast px-2 pb-1.5 text-[10.5px] text-ink-2 hover:text-ink-1"
        >
          {open ? 'Show less' : `Show all ${entry.lines.length}`}
        </button>
      )}
    </div>
  )
}
