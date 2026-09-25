import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, AudioLines, Check, Download, Film, ImageIcon, KeyRound, LoaderCircle, Sparkles } from 'lucide-react'
import type { GenerationJob, GenerationKind, GenerationSpending, ProviderKeyStatus } from '@shared/generation'
import { PROVIDERS } from '@shared/generation'
import { Button, ProgressBar, Select, Tabs, Tooltip } from '@/components'
import { bay } from '@/lib/bay'
import { cn } from '@/lib/cn'
import { handlers as generationTools } from '@/mcp/generation'
import { ToolError } from '@/mcp/helpers'
import { useEditor } from '@/store/editor'
import { AGENT_QUICK_ACTIONS } from '../agentStarters'
import {
  checkForm,
  initialForm,
  jobStatusLine,
  modelChoices,
  OPTION_LABELS,
  optionValue,
  optionValues,
  providerOf,
  speechModel,
  startBlocker,
  STYLE_CHOICES,
  toolCall,
  usd,
  type GenerateForm
} from './generateForm'

/**
 * AI actions without typing a prompt to the agent: generate a picture, a clip or a voiceover
 * directly, and hand the agent's bigger jobs (highlights, dub, cuts) a prefilled message.
 *
 * Generation runs through the same handlers the agent's tools do (`@/mcp/generation`) — the
 * catalog check, the key check, main's spend guard on start, and on landing the ordinary import,
 * one undo step. So a picture made here and one the agent made are the same kind of asset, and
 * the price and refusals read the same numbers. The panel adds only what a person needs before
 * clicking: the price, and when it cannot start, why and where to fix it.
 */
export interface GeneratePanelProps {
  /** Put a prefilled message in the agent's composer and show the conversation. Never sends. */
  onDraft(text: string): void
}

const KIND_ICONS: Record<GenerationKind, ReactNode> = {
  image: <ImageIcon className="size-3.5" />,
  video: <Film className="size-3.5" />,
  speech: <AudioLines className="size-3.5" />
}
const KIND_LABELS: Record<GenerationKind, string> = { image: 'Image', video: 'Video', speech: 'Speech' }

/** How often the job list is read while something is generating. Video takes minutes. */
const POLL_MS = 3000

export function GeneratePanel({ onDraft }: GeneratePanelProps): ReactNode {
  return (
    <div className="flex flex-col">
      <AskTheAgent onDraft={onDraft} />
      <GenerateSection />
    </div>
  )
}

function SectionHeading({ children }: { children: ReactNode }): ReactNode {
  return <h3 className="px-3 pt-3 pb-1.5 text-[10px] font-semibold tracking-[0.08em] text-ink-2 uppercase">{children}</h3>
}

/** The agent's jobs as buttons. Each fills the composer; the user finishes the sentence and sends. */
function AskTheAgent({ onDraft }: { onDraft: (text: string) => void }): ReactNode {
  return (
    <section aria-labelledby="ai-ask-heading">
      <SectionHeading>
        <span id="ai-ask-heading">Ask the agent</span>
      </SectionHeading>
      <ul className="flex flex-col gap-1 px-2">
        {AGENT_QUICK_ACTIONS.map((action) => {
          const Icon = action.icon
          return (
            <li key={action.id}>
              <button
                type="button"
                onClick={() => onDraft(action.draft)}
                className="t-fast flex w-full items-center gap-2 rounded-md border border-line bg-surface-2 px-2 py-1.5 text-left hover:border-line-hover hover:bg-surface-3"
              >
                <Icon aria-hidden="true" className="size-4 shrink-0 text-ink-1" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] font-medium text-ink-0">{action.title}</span>
                  <span className="block text-[11px] leading-snug text-pretty text-ink-2">{action.detail}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function openProviders(): void {
  // Settings has no way to open on a page from outside yet (WP6); it opens where it was left.
  useEditor.getState().setSettingsOpen(true, 'providers')
}

function GenerateSection(): ReactNode {
  const notify = useEditor((state) => state.notify)
  const assetPaths = useEditor((state) => state.project.assets.map((a) => a.path).join('\n'))
  const settingsOpen = useEditor((state) => state.settingsOpen)

  const [forms, setForms] = useState<Record<GenerationKind, GenerateForm>>(() => ({
    image: initialForm('image'),
    video: initialForm('video'),
    speech: initialForm('speech')
  }))
  const [kind, setKind] = useState<GenerationKind>('image')
  const form = forms[kind]
  const update = (patch: Partial<GenerateForm>): void => setForms((all) => ({ ...all, [kind]: { ...all[kind], ...patch } }))

  const [keys, setKeys] = useState<ProviderKeyStatus[] | null>(null)
  const [spending, setSpending] = useState<GenerationSpending | null>(null)
  const [jobs, setJobs] = useState<GenerationJob[]>([])
  const [starting, setStarting] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  // Jobs started from this panel import themselves when they land; the agent's own it imports.
  const mine = useRef(new Set<string>())
  const importing = useRef(new Set<string>())
  const available = bay() !== null

  const refresh = useCallback(async (): Promise<void> => {
    const api = bay()
    if (!api) return
    const [nextKeys, nextSpending, nextJobs] = await Promise.all([
      api.generation.keys(),
      api.generation.spending(),
      api.generation.jobs()
    ])
    setKeys(nextKeys)
    setSpending(nextSpending)
    setJobs(nextJobs)
    setNow(Date.now())
  }, [])

  // On mount, and again when Settings closes: a key added there should unlock the button here.
  useEffect(() => {
    if (!settingsOpen) void refresh()
  }, [settingsOpen, refresh])

  const active = jobs.some((job) => job.status === 'queued' || job.status === 'running')
  useEffect(() => {
    if (!active) return
    const timer = setInterval(() => void refresh(), POLL_MS)
    return () => clearInterval(timer)
  }, [active, refresh])

  const imported = (job: GenerationJob): boolean => job.outputPath !== undefined && assetPaths.split('\n').includes(job.outputPath)

  const importJob = useCallback(
    async (job: GenerationJob): Promise<void> => {
      if (importing.current.has(job.id)) return
      importing.current.add(job.id)
      try {
        // The agent's own `track_generation`: import through `media.importPaths`, one undo step.
        const result = (await generationTools.track_generation!({ jobId: job.id })) as { asset?: { name: string }; error?: string }
        if (result.asset) notify(`${KIND_LABELS[job.kind]} “${result.asset.name}” is in the media pool.`)
        else notify(result.error ?? 'The generated file could not be imported.', 'error')
      } catch (error) {
        notify(error instanceof Error ? error.message : String(error), 'error')
      } finally {
        importing.current.delete(job.id)
      }
    },
    [notify]
  )

  useEffect(() => {
    for (const job of jobs) {
      if (job.status === 'done' && mine.current.has(job.id)) {
        mine.current.delete(job.id)
        if (!imported(job)) void importJob(job)
      }
    }
    // `imported` reads `assetPaths`, which is in the list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, assetPaths, importJob])

  const checked = checkForm(form)
  const provider = providerOf(kind, form.model)
  const blocker = startBlocker({ provider, keys, spending, estimatedCostUsd: checked.estimatedCostUsd })
  const canStart = available && checked.ok && !blocker && !starting

  const start = async (): Promise<void> => {
    if (!canStart) return
    setStarting(true)
    setProblem(null)
    const call = toolCall(form)
    try {
      const result = (await generationTools[call.tool]!(call.args)) as { jobId?: string }
      if (result.jobId) mine.current.add(result.jobId)
      notify(`Generating ${KIND_LABELS[kind].toLowerCase()}. It lands in the media pool when it is done.`)
      await refresh()
    } catch (error) {
      setProblem(error instanceof ToolError || error instanceof Error ? error.message : String(error))
      void refresh()
    } finally {
      setStarting(false)
    }
  }

  const recent = jobs.slice(0, 6)

  return (
    <section aria-labelledby="ai-generate-heading" className="mt-2 border-t border-line">
      <SectionHeading>
        <span id="ai-generate-heading">Generate</span>
      </SectionHeading>
      <div className="flex flex-col gap-2 px-3 pb-3">
        <Tabs
          label="What to generate"
          variant="pill"
          value={kind}
          onChange={(next) => {
            setKind(next)
            setProblem(null)
          }}
          items={(['image', 'video', 'speech'] as const).map((value) => ({ value, label: KIND_LABELS[value], icon: KIND_ICONS[value] }))}
        />

        <Labelled label="Model">
          <Select
            label="Model"
            value={form.model}
            onChange={(model) => update({ model })}
            options={modelChoices(kind).map((m) => ({ value: m.id, label: `${m.label} · ${PROVIDERS[m.provider].label}` }))}
          />
        </Labelled>

        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-ink-1">{kind === 'speech' ? 'Words to speak' : 'Prompt'}</span>
          <textarea
            value={form.prompt}
            onChange={(event) => update({ prompt: event.target.value })}
            rows={kind === 'speech' ? 4 : 3}
            placeholder={
              kind === 'image'
                ? 'A lighthouse on a cliff at dusk, warm light, wide shot'
                : kind === 'video'
                  ? 'Slow push-in on waves breaking against rocks, golden hour'
                  : 'Exactly what the voice should say'
            }
            className="w-full resize-none rounded-sm border border-line bg-surface-2 px-2 py-1.5 text-[12px] leading-relaxed text-ink-0 outline-none placeholder:text-ink-3 hover:border-line-strong focus:border-accent"
          />
        </label>

        {kind === 'speech' ? <SpeechOptions form={form} update={update} /> : <PictureOptions form={form} update={update} />}

        <div className="flex flex-col gap-1.5 rounded-md border border-line bg-surface-1 px-2 py-1.5 text-[11px]">
          <div className="flex items-center gap-2">
            <span className="text-ink-2">Estimated cost</span>
            <span className="font-mono text-ink-0 tabular-nums">
              {checked.estimatedCostUsd === null ? '—' : `~${usd(checked.estimatedCostUsd)}`}
            </span>
            {checked.ok && checked.seconds !== undefined && (
              <span className="text-ink-2 tabular-nums">· about {checked.seconds.toFixed(1)}s spoken</span>
            )}
            <div className="flex-1" />
            {spending && (
              <Tooltip label="Estimated spend this session, against the budget set in Preferences › AI providers">
                <span className="text-ink-2 tabular-nums">
                  {usd(spending.spentUsd)} of {usd(spending.budgetUsd)} used
                </span>
              </Tooltip>
            )}
          </div>
          {!checked.ok && checked.errors.length > 0 && (
            <p className="flex items-start gap-1.5 text-danger">
              <AlertTriangle aria-hidden="true" className="mt-px size-3.5 shrink-0" />
              <span className="text-pretty">{checked.errors.join(' ')}</span>
            </p>
          )}
          {blocker && (
            <div className={cn('flex items-start gap-1.5', blocker.reason === 'loading' ? 'text-ink-2' : 'text-warning')}>
              {blocker.reason === 'no-key' ? (
                <KeyRound aria-hidden="true" className="mt-px size-3.5 shrink-0" />
              ) : blocker.reason === 'loading' ? (
                <LoaderCircle aria-hidden="true" className="mt-px size-3.5 shrink-0 animate-spin" />
              ) : (
                <AlertTriangle aria-hidden="true" className="mt-px size-3.5 shrink-0" />
              )}
              <span className="min-w-0 flex-1 text-pretty">{blocker.text}</span>
            </div>
          )}
          {blocker?.providers && (
            <Button className="self-start" icon={<KeyRound className="size-3.5" />} onClick={openProviders}>
              Open Providers settings
            </Button>
          )}
          {problem && (
            <p role="alert" className="flex items-start gap-1.5 text-danger">
              <AlertTriangle aria-hidden="true" className="mt-px size-3.5 shrink-0" />
              <span className="text-pretty">{problem}</span>
            </p>
          )}
          {!available && <p className="text-ink-2">Generation needs the app; this window has no bridge to it.</p>}
        </div>

        <Button
          variant="primary"
          size="md"
          disabled={!canStart}
          icon={starting ? <LoaderCircle className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
          onClick={() => void start()}
        >
          {starting ? 'Starting…' : `Generate ${KIND_LABELS[kind].toLowerCase()}`}
        </Button>
        <p className="text-[10.5px] leading-relaxed text-pretty text-ink-2">
          The prompt goes to {provider ? PROVIDERS[provider].label : 'the provider'}, which bills your account. Prices are
          estimates from list prices.
        </p>
      </div>

      {recent.length > 0 && (
        <div className="border-t border-line">
          <SectionHeading>Jobs</SectionHeading>
          <ul aria-label="Generation jobs" className="flex flex-col gap-1 px-2 pb-3">
            {recent.map((job) => (
              <JobRow key={job.id} job={job} imported={imported(job)} now={now} onImport={() => void importJob(job)} />
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}

function Labelled({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div className="flex items-center gap-2">
      <span aria-hidden="true" className="w-16 shrink-0 text-[11px] text-ink-1">
        {label}
      </span>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

type Update = (patch: Partial<GenerateForm>) => void

/** The options the chosen image or video model takes, each a select of what it allows. */
function PictureOptions({ form, update }: { form: GenerateForm; update: Update }): ReactNode {
  const shown = OPTION_LABELS.filter(({ option }) => optionValues(form.kind, form.model, option) !== null)
  if (shown.length === 0) return null
  return (
    <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
      {shown.map(({ option, label }) => {
        const values = optionValues(form.kind, form.model, option) ?? []
        const value = optionValue(form, option) ?? values[0] ?? ''
        return (
          <label key={option} className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[10.5px] text-ink-2">{label}</span>
            <Select
              label={label}
              value={value}
              onChange={(next) => update({ options: { ...form.options, [option]: next } })}
              options={values.map((v) => ({ value: v, label: option === 'durationSeconds' ? `${v} s` : v }))}
            />
          </label>
        )
      })}
    </div>
  )
}

function SpeechOptions({ form, update }: { form: GenerateForm; update: Update }): ReactNode {
  const model = speechModel(form.model)
  if (!model) return null
  const voice = form.voice && model.voices.includes(form.voice) ? form.voice : model.defaultVoice
  return (
    <div className="grid grid-cols-2 gap-x-2 gap-y-1.5">
      <label className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[10.5px] text-ink-2">Voice</span>
        <Select label="Voice" value={voice} onChange={(next) => update({ voice: next })} options={model.voices.map((v) => ({ value: v, label: v }))} />
      </label>
      {model.instructions && (
        <label className="flex min-w-0 flex-col gap-0.5">
          <span className="text-[10.5px] text-ink-2">Style</span>
          <Select
            label="Style"
            value={form.style ?? 'natural'}
            onChange={(next) => update({ style: next })}
            options={STYLE_CHOICES.map((s) => ({ value: s, label: s[0]!.toUpperCase() + s.slice(1) }))}
          />
        </label>
      )}
    </div>
  )
}

function JobRow({
  job,
  imported,
  now,
  onImport
}: {
  job: GenerationJob
  imported: boolean
  now: number
  onImport: () => void
}): ReactNode {
  const running = job.status === 'queued' || job.status === 'running'
  return (
    <li className="flex flex-col gap-1 rounded-md border border-line bg-surface-2 px-2 py-1.5 text-[11px]">
      <div className="flex items-center gap-1.5">
        <span aria-hidden="true" className="shrink-0 text-ink-2">
          {KIND_ICONS[job.kind]}
        </span>
        <span className="min-w-0 flex-1 truncate text-ink-0" title={job.request.prompt}>
          {job.request.prompt}
        </span>
        {job.estimatedCostUsd !== undefined && (
          <span className="shrink-0 font-mono text-ink-2 tabular-nums">~{usd(job.estimatedCostUsd)}</span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        {running ? (
          <LoaderCircle aria-hidden="true" className="size-3 shrink-0 animate-spin text-ink-2" />
        ) : job.status === 'failed' ? (
          <AlertTriangle aria-hidden="true" className="size-3 shrink-0 text-danger" />
        ) : (
          <Check aria-hidden="true" className="size-3 shrink-0 text-ink-2" />
        )}
        <span className={cn('min-w-0 flex-1 text-pretty', job.status === 'failed' ? 'text-danger' : 'text-ink-2')}>
          {jobStatusLine(job, imported, now)}
        </span>
        {job.status === 'done' && !imported && (
          <Button icon={<Download className="size-3" />} onClick={onImport}>
            Import
          </Button>
        )}
      </div>
      {running && <ProgressBar value={job.progress ?? null} label={`Generating ${KIND_LABELS[job.kind].toLowerCase()}`} />}
    </li>
  )
}
