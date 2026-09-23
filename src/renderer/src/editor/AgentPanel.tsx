import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, Check, ChevronRight, Loader2 } from 'lucide-react'
import { approvalMessage, DECLINED_MESSAGE, type AgentEntry } from '@shared/agent'
import { Button, Markdown, Panel, ScrollArea } from '@/components'
import { AGENT_STARTERS, STARTERS_SHOWN, type AgentStarter } from './agentStarters'
import { bay } from '@/lib/bay'
import { selectFps, useEditor } from '@/store/editor'
import { composeMessage, pinLabel, type Pin } from '@shared/pins'
import { insertSkill, skillSegments } from '@shared/skills'
import { Composer } from './Composer'

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
  const gate = useEditor((state) => state.agentGate)
  const logUserMessage = useEditor((state) => state.logUserMessage)
  const startAgentSession = useEditor((state) => state.startAgentSession)
  const endAgentSession = useEditor((state) => state.endAgentSession)
  const clearAgentLog = useEditor((state) => state.clearAgentLog)

  const [draft, setDraft] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const bottom = useRef<HTMLDivElement | null>(null)
  const composer = useRef<HTMLTextAreaElement | null>(null)

  // A starter fills the composer and hands it back to the user — never sends. The prompt is a
  // draft: which clip, whose name, what style are theirs to add, and sending on click would
  // start a paid turn from a single mis-click.
  const pickStarter = (starter: AgentStarter): void => {
    setDraft(insertSkill(draft, starter.skill))
    requestAnimationFrame(() => {
      const box = composer.current
      if (!box) return
      box.focus()
      box.setSelectionRange(box.value.length, box.value.length)
    })
  }

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' })
  }, [log])

  /**
   * One user turn, from the text box or from a decision on a proposal card.
   *
   * The card goes through here too, and has to: an approval that only changed the gate would
   * leave the model waiting — correctly, since it was told to end its turn and wait — for a
   * message that never comes. The decision *is* the next message.
   */
  const deliver = async (text: string, pins: Pin[] = []): Promise<void> => {
    if (!text || running) return
    const api = bay()
    if (!api) {
      setProblem('bay is not answering. The main process may still be starting.')
      return
    }
    setProblem(null)
    logUserMessage(text, pins)

    // Starting is separate from sending so a missing `claude` binary reads as "could not start"
    // rather than as a model that ignored the message.
    if (!gate) {
      const started = await api.agent.start()
      if (!started.ok) {
        setProblem(started.error)
        return
      }
      startAgentSession()
    }
    // The log shows what was typed, with the pins as chips; the agent receives the pins spelled
    // out as ids and frames ahead of it.
    const sent = await api.agent.send(composeMessage(text, pins, selectFps(useEditor.getState())))
    if (!sent.ok) setProblem(sent.error ?? 'The message could not be delivered.')
  }

  // Typed messages carry the pins; a decision on a proposal card does not — it already names
  // the exact calls it approves.
  const send = async (text: string): Promise<void> => {
    setDraft('')
    await deliver(text, useEditor.getState().agentPins)
  }

  const stop = (): void => {
    void bay()?.agent.stop()
  }

  const reset = (): void => {
    void bay()?.agent.dispose()
    endAgentSession()
    clearAgentLog()
    useEditor.getState().clearAgentPins()
    setDraft('')
    setProblem(null)
  }

  return (
    <Panel
      title="Agent"
      className="h-full"
      bodyClassName="flex flex-col"
      actions={
        log.length > 0 ? (
          <Button variant="subtle" onClick={reset}>
            New
          </Button>
        ) : undefined
      }
    >
      <ScrollArea className="flex-1">
        {log.length === 0 ? (
          <Starters onPick={pickStarter} />
        ) : (
          <div className="flex flex-col gap-2 p-2">
            {log.map((entry) => (
              <Entry key={entry.id} entry={entry} deliver={deliver} />
            ))}
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

      <Composer
        running={running}
        onSend={send}
        onStop={stop}
        onNewConversation={reset}
        draft={draft}
        setDraft={setDraft}
        textareaRef={composer}
      />
    </Panel>
  )
}

type Deliver = (text: string) => Promise<void>

/** What the user sent: their words, with what they had pinned shown as chips above them. */
function UserEntry({ entry }: { entry: Extract<AgentEntry, { kind: 'user' }> }): ReactNode {
  const fps = useEditor(selectFps)

  return (
    <div className="flex max-w-[92%] flex-col items-end gap-1 self-end">
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
      <p className="rounded-lg bg-surface-3 px-2.5 py-1.5 text-[12px] leading-relaxed whitespace-pre-wrap text-ink-0">
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
      </p>
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
        It reads the project and proposes a plan. Nothing changes until you approve it.
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
        <p className="border-l-2 border-line pl-2 text-[11px] leading-relaxed whitespace-pre-wrap text-ink-3">
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
  }
}

function ToolCard({ entry }: { entry: Extract<AgentEntry, { kind: 'tool' }> }): ReactNode {
  const [open, setOpen] = useState(false)
  const hasArgs = Object.keys(entry.args).length > 0
  // A failed call opens itself. Its text is the recovery instruction, and hiding that behind a
  // click is hiding the only part that helps.
  const expanded = open || entry.state === 'failed'

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
        {(hasArgs || entry.result) && (
          <ChevronRight
            aria-hidden="true"
            className={`ml-auto size-3 shrink-0 text-ink-3 transition-transform ${expanded ? 'rotate-90' : ''}`}
          />
        )}
      </button>
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
 * The approval card.
 *
 * Every operation is listed with its arguments, because approving a plan you cannot see is not
 * approving anything. Once a choice is made the card stays in place showing what was approved —
 * a card that vanished would leave the conversation claiming an edit nobody could point at.
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
  const chosen = approved?.proposalId === entry.proposal.id ? approved.option.id : null

  // The decision is a turn, and a turn cannot start while the agent is still in one — it was
  // told to stop after proposing, and it is allowed to finish its sentence first.
  const approve = (optionId: string): void => {
    const option = entry.proposal.options.find((o) => o.id === optionId)
    if (!option || running) return
    approveProposal(entry.proposal, optionId)
    void deliver(approvalMessage(option))
  }
  const decline = (): void => {
    if (running) return
    declineProposal()
    void deliver(DECLINED_MESSAGE)
  }

  return (
    <div className="rounded border border-accent bg-surface-2 p-2 text-[11px]">
      <p className="mb-1.5 text-[12px] leading-relaxed text-ink-1">{entry.proposal.question}</p>
      <div className="flex flex-col gap-1.5">
        {entry.proposal.options.map((option) => (
          <div
            key={option.id}
            className={`rounded border p-1.5 ${chosen === option.id ? 'border-accent' : 'border-line'}`}
          >
            <p className="text-ink-1">{option.label}</p>
            <p className="mt-0.5 leading-relaxed text-ink-2">{option.summary}</p>
            <ul className="mt-1 flex flex-col gap-0.5">
              {option.operations.map((operation) => (
                <li
                  key={operation.index}
                  // Wrapped, never clipped: the arguments are what is being approved, and a card
                  // that cut them off at `"fadeInF` asked the user to approve what they could not
                  // read.
                  className="font-mono text-[10px] break-all whitespace-pre-wrap text-ink-3"
                >
                  {operation.tool} {JSON.stringify(operation.args)}
                </li>
              ))}
            </ul>
            {pending && (
              <Button
                className="mt-1.5"
                variant="subtle"
                disabled={running}
                onClick={() => approve(option.id)}
              >
                Approve
              </Button>
            )}
            {chosen === option.id && <p className="mt-1.5 text-ink-2">Approved.</p>}
          </div>
        ))}
      </div>
      {pending && (
        <div className="mt-1.5 flex items-center gap-1.5">
          <Button variant="subtle" disabled={running} onClick={decline}>
            None of these
          </Button>
          {running && <span className="text-ink-3">waiting for the agent to finish its turn</span>}
        </div>
      )}
    </div>
  )
}
