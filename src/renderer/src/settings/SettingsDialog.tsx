import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, Download, LoaderCircle, Trash2, X } from 'lucide-react'
import {
  WHISPER_MODELS,
  defaultWhisperModel,
  formatBytes,
  whisperFileName,
  type InstalledWhisperModel,
  type WhisperDownload,
  type WhisperStatus
} from '@shared/whisper'
import { Button, IconButton, Modal, SegmentedControl } from '@/components'
import { bay } from '@/lib/bay'
import { cn } from '@/lib/cn'
import { bayTheme, type ThemePreference } from '@/lib/theme'
import { useEditor } from '@/store/editor'

/**
 * Settings: what bay can do on this Mac, and how the agent behaves.
 *
 * Mostly transcription, because that is the capability with moving parts the user can fix from
 * here — the engine (installed through Homebrew) and the models (downloaded from Hugging Face,
 * verified, kept in bay's own folder). The rest are the switches that used to be scattered: ask
 * before editing, theme, debug mode.
 */
export function SettingsDialog(): ReactNode {
  const open = useEditor((state) => state.settingsOpen)
  const setOpen = useEditor((state) => state.setSettingsOpen)
  return (
    <Modal open={open} title="Settings" onClose={() => setOpen(false)} width={600}>
      {open && <SettingsBody />}
    </Modal>
  )
}

function SettingsBody(): ReactNode {
  const agentApproval = useEditor((state) => state.agentApproval)
  const setAgentApproval = useEditor((state) => state.setAgentApproval)
  const debugMode = useEditor((state) => state.debugMode)
  const toggleDebugMode = useEditor((state) => state.toggleDebugMode)
  const [theme, setTheme] = useState<ThemePreference>(() => bayTheme()?.get() ?? 'dark')

  return (
    <div className="flex flex-col divide-y divide-line">
      <TranscriptionSection />

      <Section title="Agent">
        <SwitchRow
          label="Ask before editing"
          description="Off: the agent edits directly, and every turn that changes the project shows what changed with a Revert button. On: it proposes each change and waits for you to approve it."
          checked={agentApproval}
          onChange={setAgentApproval}
        />
      </Section>

      <Section title="Appearance">
        <Row label="Theme">
          <SegmentedControl
            label="Theme"
            value={theme}
            options={[
              { value: 'dark', label: 'Dark' },
              { value: 'light', label: 'Light' },
              { value: 'system', label: 'System' }
            ]}
            disabled={!bayTheme()}
            onChange={(next) => {
              bayTheme()?.set(next)
              setTheme(next)
            }}
          />
        </Row>
      </Section>

      <Section title="Advanced">
        <SwitchRow
          label="Debug mode"
          description="Shows tools for reporting problems, such as exporting the agent's transcript. Also View → Toggle Debug Mode (⌥⌘D)."
          checked={debugMode}
          onChange={() => toggleDebugMode()}
        />
      </Section>
    </div>
  )
}

// -- transcription ----------------------------------------------------------------

function TranscriptionSection(): ReactNode {
  const autoDownload = useEditor((state) => state.autoDownloadModels)
  const setAutoDownload = useEditor((state) => state.setAutoDownloadModels)
  const chosen = useEditor((state) => state.whisperModel)
  const setChosen = useEditor((state) => state.setWhisperModel)
  const download = useEditor((state) => state.whisperDownload)
  const notify = useEditor((state) => state.notify)

  const [status, setStatus] = useState<WhisperStatus | null>(null)
  const [installing, setInstalling] = useState(false)
  const waitingOnInstall = useRef(false)
  const [installError, setInstallError] = useState<string | null>(null)

  const refresh = useCallback(async (): Promise<void> => {
    const api = bay()
    if (!api) return
    const next = await api.whisper.status(useEditor.getState().whisperModel).catch(() => null)
    if (!next) return
    setStatus(next)
    // A window reloaded mid-download (or after one failed) has no events yet to say so.
    if (next.download && !useEditor.getState().whisperDownload) useEditor.getState().setWhisperDownload(next.download)
    // Reopened while an install runs: wait on the same one (main joins it) so this dialog learns
    // when it ends, rather than offering the button again.
    if (next.installing && !waitingOnInstall.current) void install()
  }, [])

  // Asked again whenever a download settles or the choice changes, so the list is what is on
  // disk now rather than what was there when the dialog opened.
  const settled = download?.state === 'downloading' || download?.state === 'verifying' ? null : download?.state
  useEffect(() => {
    void refresh()
  }, [refresh, settled, chosen])

  const api = bay()
  const running = download && (download.state === 'downloading' || download.state === 'verifying') ? download : null

  const startDownload = async (modelId: string): Promise<void> => {
    const result = await api?.whisper.download(modelId)
    if (result && !result.ok && !/cancelled/.test(result.error)) notify(result.error, 'error')
  }

  const remove = async (model: InstalledWhisperModel): Promise<void> => {
    const result = await api?.whisper.deleteModel(model.file)
    if (result && !result.ok) notify(result.error ?? 'That model could not be deleted.', 'error')
    if (chosen === model.file) setChosen(null)
    await refresh()
  }

  async function install(): Promise<void> {
    waitingOnInstall.current = true
    setInstalling(true)
    setInstallError(null)
    const result = await bay()?.whisper.installEngine()
    waitingOnInstall.current = false
    setInstalling(false)
    if (result && !result.ok) setInstallError(result.error)
    await refresh()
  }

  const installedByFile = new Map<string, InstalledWhisperModel>()
  // bay's own copy first: it is the one Delete acts on.
  for (const model of [...(status?.installed ?? [])].sort((a, b) => Number(b.own) - Number(a.own))) {
    if (!installedByFile.has(model.file)) installedByFile.set(model.file, model)
  }
  const catalogFiles = new Set(WHISPER_MODELS.map((model) => whisperFileName(model.id)))
  const others = [...installedByFile.values()].filter((model) => !catalogFiles.has(model.file))

  return (
    <Section
      title="Transcription"
      description="Captions and transcript-driven cuts are transcribed on this Mac with whisper.cpp. Your audio never leaves it."
    >
      {/* The engine */}
      <Row label="whisper.cpp" hint={status?.engine ?? undefined}>
        {status === null ? (
          <span className="text-[12px] text-ink-2">Checking…</span>
        ) : status.engine ? (
          <Badge tone="ok">Installed</Badge>
        ) : status.brew ? (
          <Button
            variant="primary"
            icon={installing ? <LoaderCircle className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
            disabled={installing}
            onClick={() => void install()}
          >
            {installing ? 'Installing… (a few minutes)' : 'Install with Homebrew'}
          </Button>
        ) : (
          <span className="max-w-[260px] text-right text-[12px] text-ink-1">
            Not installed. Install Homebrew from brew.sh, then run <code>brew install whisper-cpp</code>.
          </span>
        )}
      </Row>
      {installError && <p className="-mt-1 text-[12px] text-pretty text-danger">{installError}</p>}

      <SwitchRow
        label="Download models when needed"
        description={`When a transcription finds no model, bay downloads ${defaultWhisperModel('en').label} (${formatBytes(defaultWhisperModel('en').bytes)}) from Hugging Face and checks it before use. Nothing else is sent anywhere.`}
        checked={autoDownload}
        onChange={setAutoDownload}
      />

      {/* The models */}
      <div className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between">
          <h4 className="text-[12px] font-medium text-ink-0">Models</h4>
          <span className="text-[11px] text-ink-2">
            {chosen ? 'Using the one you chose' : 'bay picks the best one you have'}
          </span>
        </div>
        <ul className="flex flex-col overflow-hidden rounded-md border border-line">
          {WHISPER_MODELS.map((spec) => {
            const file = whisperFileName(spec.id)
            const installed = installedByFile.get(file) ?? null
            return (
              <ModelRow
                key={spec.id}
                label={spec.label}
                note={spec.note}
                bytes={installed?.bytes || spec.bytes}
                installed={installed}
                active={status?.activeForEnglish === file}
                chosen={chosen === file}
                download={download?.modelId === spec.id ? download : null}
                busy={running !== null}
                onDownload={() => void startDownload(spec.id)}
                onCancel={() => void api?.whisper.cancelDownload()}
                onUse={() => setChosen(chosen === file ? null : file)}
                onDelete={installed?.own ? () => void remove(installed) : null}
              />
            )
          })}
          {others.map((model) => (
            <ModelRow
              key={model.path}
              label={model.file}
              note="Found on this Mac"
              bytes={model.bytes}
              installed={model}
              active={status?.activeForEnglish === model.file}
              chosen={chosen === model.file}
              download={null}
              busy={running !== null}
              onDownload={() => undefined}
              onCancel={() => undefined}
              onUse={() => setChosen(chosen === model.file ? null : model.file)}
              onDelete={model.own ? () => void remove(model) : null}
            />
          ))}
        </ul>
        {status && (
          <p className="text-[11px] text-pretty text-ink-2">
            Downloads go to <span className="text-ink-1 select-text">{status.modelDir}</span>. Models other apps
            downloaded are used too, and are theirs to delete.
          </p>
        )}
      </div>
    </Section>
  )
}

interface ModelRowProps {
  label: string
  note: string
  bytes: number
  installed: InstalledWhisperModel | null
  /** What an English transcription would use right now. */
  active: boolean
  chosen: boolean
  download: WhisperDownload | null
  /** Another download is running; only one at a time. */
  busy: boolean
  onDownload(): void
  onCancel(): void
  onUse(): void
  onDelete: (() => void) | null
}

function ModelRow(props: ModelRowProps): ReactNode {
  const { label, note, bytes, installed, active, chosen, download } = props
  const inFlight = download && (download.state === 'downloading' || download.state === 'verifying')
  const fraction = download && download.totalBytes > 0 ? Math.min(1, download.receivedBytes / download.totalBytes) : 0
  const from = installed && !installed.own ? appOf(installed.path) : null

  return (
    <li className="flex min-h-12 items-center gap-3 border-b border-line px-3 py-2 last:border-b-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-[12px] font-medium text-ink-0">{label}</span>
          {active && <Badge tone="ok">{chosen ? 'In use' : 'In use · automatic'}</Badge>}
        </div>
        {inFlight ? (
          <div className="mt-1 flex items-center gap-2">
            <div
              role="progressbar"
              aria-label={`Downloading ${label}`}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(fraction * 100)}
              className="h-1 flex-1 overflow-hidden rounded-full bg-surface-3"
            >
              <div className="h-full rounded-full bg-accent transition-[width] duration-200" style={{ width: `${fraction * 100}%` }} />
            </div>
            <span className="shrink-0 text-[11px] text-ink-2 tabular-nums">
              {download.state === 'verifying'
                ? 'Checking…'
                : `${formatBytes(download.receivedBytes)} of ${formatBytes(download.totalBytes)}`}
            </span>
          </div>
        ) : download?.state === 'failed' ? (
          <p className="mt-0.5 text-[11px] text-pretty text-danger">{download.error ?? 'The download failed.'}</p>
        ) : (
          <p className="mt-0.5 truncate text-[11px] text-ink-2">
            {note} · {formatBytes(bytes)}
            {from ? ` · from ${from}` : ''}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {inFlight ? (
          <Button variant="ghost" icon={<X className="size-3.5" />} onClick={props.onCancel}>
            Cancel
          </Button>
        ) : installed ? (
          <>
            {/* Bordered like Download beside it: as a ghost button "Use" read as a label in a
                list of outlined buttons, and nothing about it said it could be pressed. */}
            <Button
              variant="subtle"
              className={chosen ? 'border-accent/60 text-accent' : undefined}
              icon={chosen ? <Check className="size-3.5" /> : undefined}
              onClick={props.onUse}
              title={chosen ? 'Stop choosing this one; let bay pick' : 'Use this model for transcription'}
            >
              {chosen ? 'Chosen' : 'Use'}
            </Button>
            {props.onDelete && (
              <IconButton label={`Delete ${label}`} icon={<Trash2 className="size-3.5" />} onClick={props.onDelete} />
            )}
          </>
        ) : (
          <Button
            icon={<Download className="size-3.5" />}
            disabled={props.busy}
            title={props.busy ? 'Another model is downloading' : undefined}
            onClick={props.onDownload}
          >
            Download
          </Button>
        )}
      </div>
    </li>
  )
}

/** "cue" for `~/Library/Application Support/cue/whisper-models/x.bin`; the folder otherwise. */
function appOf(path: string): string {
  const match = /Application Support\/([^/]+)\/whisper-models\//.exec(path)
  if (match?.[1]) return match[1]
  const parts = path.split('/')
  return parts.slice(-2, -1)[0] ?? path
}

// -- layout pieces ----------------------------------------------------------------

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }): ReactNode {
  return (
    <section className="flex flex-col gap-3 px-4 py-4">
      <div>
        <h3 className="text-[13px] font-semibold text-ink-0">{title}</h3>
        {description && <p className="mt-0.5 text-[12px] text-pretty text-ink-2">{description}</p>}
      </div>
      {children}
    </section>
  )
}

function Row({ label, hint, children }: { label: string; hint?: string | undefined; children: ReactNode }): ReactNode {
  return (
    <div className="flex items-center gap-4">
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-medium text-ink-0">{label}</div>
        {hint && <div className="truncate text-[11px] text-ink-2">{hint}</div>}
      </div>
      {children}
    </div>
  )
}

function SwitchRow(props: { label: string; description: string; checked: boolean; onChange(on: boolean): void }): ReactNode {
  return (
    <label className="flex cursor-pointer items-start gap-4">
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-medium text-ink-0">{props.label}</div>
        <p className="mt-0.5 text-[11px] text-pretty text-ink-2">{props.description}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={props.checked}
        aria-label={props.label}
        onClick={() => props.onChange(!props.checked)}
        className={cn(
          't-fast relative mt-0.5 h-5 w-9 shrink-0 rounded-full border',
          props.checked ? 'border-accent bg-accent' : 'border-line-strong bg-surface-3'
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            't-fast absolute top-0.5 size-3.5 rounded-full bg-white shadow-sm transition-[left]',
            props.checked ? 'left-[18px]' : 'left-0.5'
          )}
        />
      </button>
    </label>
  )
}

function Badge({ tone, children }: { tone: 'ok'; children: ReactNode }): ReactNode {
  return (
    <span
      className={cn(
        'shrink-0 rounded-sm px-1.5 py-px text-[10px] font-medium',
        tone === 'ok' && 'bg-success/15 text-success'
      )}
    >
      {children}
    </span>
  )
}
