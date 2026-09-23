import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, Check, ChevronRight, Loader2, Square, Wrench } from 'lucide-react'
import { approvalMessage, DECLINED_MESSAGE, type AgentEntry } from '@shared/agent'
import { Button, EmptyState, Panel, ScrollArea } from '@/components'
import { bay } from '@/lib/bay'
import { useEditor } from '@/store/editor'

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
  const deliver = async (text: string): Promise<void> => {
    if (!text || running) return
    const api = bay()
    if (!api) {
      setProblem('bay is not answering. The main process may still be starting.')
      return
    }
    setProblem(null)
    logUserMessage(text)

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
    const sent = await api.agent.send(text)
    if (!sent.ok) setProblem(sent.error ?? 'The message could not be delivered.')
  }

  const send = async (): Promise<void> => {
    const text = draft.trim()
    if (!text || running) return
    setDraft('')
    await deliver(text)
  }

  const stop = (): void => {
    void bay()?.agent.stop()
  }

  const reset = (): void => {
    void bay()?.agent.dispose()
    endAgentSession()
    clearAgentLog()
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
          <EmptyState
            icon={<Wrench aria-hidden="true" className="size-6" />}
            title="Ask for an edit"
            hint="It reads the project and proposes a plan. Nothing changes until you approve it."
          />
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

      <div className="border-t border-line p-2">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends, Shift+Enter breaks the line. A multi-line box that needs a mouse to
            // send is a box people stop using.
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              void send()
            }
          }}
          rows={3}
          placeholder="Trim the pauses out of the opening…"
          className="w-full resize-none rounded border border-line bg-surface-2 px-2 py-1.5 text-[12px] leading-relaxed text-ink-1 outline-none placeholder:text-ink-3 focus:border-accent"
        />
        <div className="mt-1.5 flex items-center gap-1.5">
          {running ? (
            <Button variant="subtle" icon={<Square className="size-3" />} onClick={stop}>
              Stop
            </Button>
          ) : (
            <Button onClick={() => void send()} disabled={draft.trim().length === 0}>
              Send
            </Button>
          )}
          {running && (
            <span className="flex items-center gap-1 text-[11px] text-ink-2">
              <Loader2 aria-hidden="true" className="size-3 animate-spin" />
              working
            </span>
          )}
        </div>
      </div>
    </Panel>
  )
}

type Deliver = (text: string) => Promise<void>

function Entry({ entry, deliver }: { entry: AgentEntry; deliver: Deliver }): ReactNode {
  switch (entry.kind) {
    case 'user':
      return (
        <p className="self-end rounded bg-surface-3 px-2 py-1.5 text-[12px] leading-relaxed whitespace-pre-wrap text-ink-1">
          {entry.text}
        </p>
      )
    case 'assistant':
      return (
        <p className="text-[12px] leading-relaxed whitespace-pre-wrap text-ink-1">{entry.text}</p>
      )
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
        <span className="font-mono text-ink-1">{entry.tool}</span>
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
