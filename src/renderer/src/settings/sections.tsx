import { useEffect, useState, type ReactNode } from 'react'
import { BayMark, Badge, Button, Kbd, NumberField, SegmentedControl, Switch } from '@/components'
import { runCommand, shortcutOf } from '@/lib/commands'
import { bayTheme, type ThemePreference } from '@/lib/theme'
import { useViewer } from '@/lib/viewer'
import { selectTimeline, useEditor } from '@/store/editor'
import {
  STILL_SECONDS,
  TRANSITION_SECONDS,
  transitionLengthFrames,
  stillDurationFrames,
  useEditingPrefs
} from '@/store/editing-prefs'
import { AboutUpdates, useUpdate } from '@/update/UpdateBanner'
import type { CanvasFit } from '@shared/project'
import { AGENT_PROVIDERS, type AgentProviderStatus } from '@shared/agent'
import { PROVIDER_LABELS, useAgentProvider } from '@/lib/agentProvider'
import { bay } from '@/lib/bay'
import { ShortcutsSheet } from '@/editor/ShortcutsDialog'
import { StorageRepairButton, useStorageStatus } from '@/editor/StorageRepair'
import { Group, Note, Row, Section, SwitchRow } from './parts'

/**
 * Asks main once on mount and keeps the answer. `null` while asking, and also when the bridge
 * cannot answer — the page then says it could not ask, which is not the same as "missing".
 */
function useAsked<T>(ask: () => Promise<T> | undefined): { answer: T | null; asked: boolean } {
  const [state, setState] = useState<{ answer: T | null; asked: boolean }>({ answer: null, asked: false })
  useEffect(() => {
    let live = true
    const pending = ask()
    if (!pending) {
      setState({ answer: null, asked: true })
      return
    }
    pending
      .then((answer) => {
        if (live) setState({ answer, asked: true })
      })
      .catch(() => {
        if (live) setState({ answer: null, asked: true })
      })
    return () => {
      live = false
    }
    // Asked once per mount; the page remounts each time it is shown.
  }, [])
  return state
}

function Checking(): ReactNode {
  return <span className="text-[12px] text-ink-2">Checking…</span>
}

function Unknown(): ReactNode {
  return <span className="text-[12px] text-ink-2">Could not ask</span>
}

// ── System ──────────────────────────────────────────────────────────────────────────────────

export function MediaToolsSection(): ReactNode {
  const { answer: tools, asked } = useAsked(() => bay()?.app.mediaToolsReady())
  const state = (path: string | null | undefined): ReactNode =>
    !asked ? <Checking /> : tools === null ? <Unknown /> : path ? <Badge tone="success">Found</Badge> : <Badge tone="danger">Missing</Badge>
  return (
    <Section
      title="Media tools"
      description="bay reads, previews and exports media with its own copy of ffmpeg. Without it, import, waveforms, posters and export stop working."
    >
      <Group title="ffmpeg">
        <Row label="ffmpeg" hint={tools?.ffmpeg ?? (asked && tools ? 'Not found.' : undefined)}>
          {state(tools?.ffmpeg)}
        </Row>
        <Row label="ffprobe" hint={tools?.ffprobe ?? (asked && tools ? 'Not found.' : undefined)}>
          {state(tools?.ffprobe)}
        </Row>
      </Group>
      {tools && !tools.ready && (
        <Note tone="danger">
          A usable pair was not found. A build from source needs <code>script/build-ffmpeg.sh</code> run once; a
          released bay carries its own.
        </Note>
      )}
    </Section>
  )
}

export function StorageSection(): ReactNode {
  const live = useStorageStatus()
  const { answer: first, asked } = useAsked(() => bay()?.app.storageReady())
  // The live status once it has answered (it follows a repair); the first ask until then.
  const storage = live ?? first
  return (
    <Section
      title="Storage"
      description="Where bay keeps what it knows about your projects on this Mac. Projects themselves are .bay files wherever you save them."
    >
      <Group>
        <Row
          label="Project database"
          hint={
            storage?.error ??
            'Recent projects and reopening the last project read it. Without it the recents list stays empty.'
          }
        >
          {!asked ? (
            <Checking />
          ) : storage === null ? (
            <Unknown />
          ) : storage.ready ? (
            <Badge tone="success">Ready</Badge>
          ) : (
            <span className="flex items-center gap-2">
              <Badge tone="danger">Unavailable</Badge>
              <StorageRepairButton />
            </span>
          )}
        </Row>
      </Group>
    </Section>
  )
}

export function UpdatesSection(): ReactNode {
  return (
    <Section title="Updates">
      <Group>
        <div className="px-3 py-2.5">
          <AboutUpdates />
        </div>
      </Group>
    </Section>
  )
}

export function AboutSection(): ReactNode {
  const status = useUpdate()
  return (
    <Section title="About">
      <div className="flex items-center gap-3 px-0.5">
        <BayMark variant="tile" size={48} />
        <div>
          <div className="text-[14px] font-semibold text-ink-0">bay</div>
          <div className="text-[12px] text-ink-2 tabular-nums">{status ? `Version ${status.current}` : 'Version unknown'}</div>
          <div className="text-[12px] text-ink-2">A video editor you can also drive with an agent.</div>
        </div>
      </div>
      <Group title="Privacy">
        <p className="px-3 py-2.5 text-[12px] text-pretty text-ink-1">
          Your projects, media and audio stay on this Mac. bay goes online only to check your sign-in, to
          download a transcription or visual-search model when you ask for one, to look for updates, to download
          a video from a web page with your own yt-dlp when you (or the agent, with your OK) ask for one, and —
          with a key you set in AI providers — to send a generation prompt or a voiceover script (and any
          reference picture it names) to that provider.
        </p>
      </Group>
    </Section>
  )
}

// ── User ────────────────────────────────────────────────────────────────────────────────────

export function InterfaceSection(): ReactNode {
  const debugMode = useEditor((state) => state.debugMode)
  const toggleDebugMode = useEditor((state) => state.toggleDebugMode)
  const [theme, setTheme] = useState<ThemePreference>(() => bayTheme()?.get() ?? 'dark')
  const debugKey = shortcutOf('view.toggleDebug')

  return (
    <Section title="Interface" description="How bay looks on this Mac.">
      <Group title="Appearance">
        <Row label="Theme" hint="System follows macOS, switching when it does.">
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
      </Group>
      <Group title="Troubleshooting">
        <label className="flex min-h-11 cursor-pointer items-center gap-4 px-3 py-2">
          <div className="min-w-0 flex-1">
            <div className="text-[12px] font-medium text-ink-0">Debug mode</div>
            <p className="mt-0.5 text-[11px] text-pretty text-ink-2">
              Shows tools for reporting problems, such as exporting the agent’s transcript, and the rate, canvas and
              media count in the status bar.
            </p>
          </div>
          {debugKey && <Kbd shortcut={debugKey} className="text-[11px] text-ink-2" />}
          <Switch label="Debug mode" checked={debugMode} onChange={() => toggleDebugMode()} />
        </label>
      </Group>
    </Section>
  )
}

/** "= 150 frames at 30 fps" for the open timeline; nothing on the projects screen. */
function framesHint(frames: number | null, fps: number | null): string | undefined {
  if (frames === null || fps === null) return undefined
  return `${frames} frame${frames === 1 ? '' : 's'} at ${Math.round(fps * 1000) / 1000} fps.`
}

const FIT_HINTS: Record<CanvasFit, string> = {
  auto: 'Fills the canvas, unless that would crop away too much; then shown whole.',
  contain: 'Shown whole, with bars where the shapes differ.',
  cover: 'Fills the canvas; the edges that do not fit are cropped.'
}

export function EditingSection(): ReactNode {
  const stillSeconds = useEditingPrefs((state) => state.stillSeconds)
  const transitionSeconds = useEditingPrefs((state) => state.transitionSeconds)
  const setStillSeconds = useEditingPrefs((state) => state.setStillSeconds)
  const setTransitionSeconds = useEditingPrefs((state) => state.setTransitionSeconds)
  const newClipFit = useEditingPrefs((state) => state.newClipFit)
  const setNewClipFit = useEditingPrefs((state) => state.setNewClipFit)
  const separateClipAudio = useEditingPrefs((state) => state.separateClipAudio)
  const setSeparateClipAudio = useEditingPrefs((state) => state.setSeparateClipAudio)
  const fps = useEditor((state) => selectTimeline(state)?.fps ?? null)

  return (
    <Section title="Editing" description="Defaults for what you add next. Clips already on the timeline keep their length and framing.">
      <Group title="Lengths">
        <Row
          label="Image & title length"
          hint={`How long a still image or a title runs when you place it. ${framesHint(fps === null ? null : stillDurationFrames(fps, stillSeconds), fps) ?? ''}`.trim()}
        >
          <NumberField
            label="Length"
            ariaLabel="Image and title length, in seconds"
            value={stillSeconds}
            step={0.5}
            min={STILL_SECONDS.min}
            max={STILL_SECONDS.max}
            precision={1}
            suffix="s"
            onCommit={setStillSeconds}
            className="w-28"
          />
        </Row>
        <Row
          label="Transition length"
          hint={`What a new transition asks for; a cut without enough footage either side gets less. ${framesHint(fps === null ? null : transitionLengthFrames(fps, transitionSeconds), fps) ?? ''}`.trim()}
        >
          <NumberField
            label="Length"
            ariaLabel="Transition length, in seconds"
            value={transitionSeconds}
            step={0.1}
            min={TRANSITION_SECONDS.min}
            max={TRANSITION_SECONDS.max}
            precision={2}
            suffix="s"
            onCommit={setTransitionSeconds}
            className="w-28"
          />
        </Row>
      </Group>
      <Group title="Framing">
        <Row label="New clips" hint={`A video or image shaped differently from the canvas: ${FIT_HINTS[newClipFit].toLowerCase()}`}>
          <SegmentedControl<CanvasFit>
            label="Framing for new clips"
            value={newClipFit}
            options={[
              { value: 'auto', label: 'Auto' },
              { value: 'contain', label: 'Fit' },
              { value: 'cover', label: 'Fill' }
            ]}
            onChange={setNewClipFit}
          />
        </Row>
      </Group>
      <Group title="Sound">
        <SwitchRow
          label="Put a video's sound on its own track"
          description="A placed video with sound arrives as two linked clips: the picture on a video track and its sound on an audio track (A1), as in Resolve. Linked, they move, trim and delete together; right-click › Audio › Unlink to edit them apart. Off: the sound stays inside the picture clip."
          checked={separateClipAudio}
          onChange={setSeparateClipAudio}
        />
      </Group>
    </Section>
  )
}

export function PlaybackSection(): ReactNode {
  const followPlayhead = useEditingPrefs((state) => state.followPlayhead)
  const setFollowPlayhead = useEditingPrefs((state) => state.setFollowPlayhead)
  return (
    <Section title="Playback">
      <Group title="Timeline">
        <SwitchRow
          label="Timeline follows the playhead"
          description="While playing, the timeline scrolls to keep the playhead in view. Off: it stays where you left it."
          checked={followPlayhead}
          onChange={setFollowPlayhead}
        />
      </Group>
    </Section>
  )
}

export function ViewerSection(): ReactNode {
  const safeAreas = useViewer((state) => state.safeAreas)
  const grid = useViewer((state) => state.grid)
  const toggleSafeAreas = useViewer((state) => state.toggleSafeAreas)
  const toggleGrid = useViewer((state) => state.toggleGrid)
  const safeKey = shortcutOf('view.safeAreas')
  const gridKey = shortcutOf('view.grid')
  return (
    <Section
      title="Viewer"
      description="Guides drawn over the picture while you edit. They are never exported, and bay remembers them between launches."
    >
      <Group title="Guides">
        <GuideRow
          label="Safe areas"
          description="Title-safe and action-safe frames, for text that must not reach the edge of a screen."
          shortcut={safeKey}
          checked={safeAreas}
          onChange={toggleSafeAreas}
        />
        <GuideRow
          label="Grid"
          description="A rule-of-thirds grid, for placing subjects and titles."
          shortcut={gridKey}
          checked={grid}
          onChange={toggleGrid}
        />
      </Group>
    </Section>
  )
}

function GuideRow(props: { label: string; description: string; shortcut: string | undefined; checked: boolean; onChange(): void }): ReactNode {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-4 px-3 py-2">
      <div className="min-w-0 flex-1">
        <div className="text-[12px] font-medium text-ink-0">{props.label}</div>
        <p className="mt-0.5 text-[11px] text-pretty text-ink-2">{props.description}</p>
      </div>
      {props.shortcut && <Kbd shortcut={props.shortcut} className="text-[11px] text-ink-2" />}
      <Switch label={`Show ${props.label.toLowerCase()}`} checked={props.checked} onChange={() => props.onChange()} />
    </label>
  )
}

export function KeyboardSection(): ReactNode {
  const shortcut = shortcutOf('help.shortcuts')
  return (
    <Section title="Keyboard" description="Every key bay answers to, grouped by menu. Search by a command, a menu or a key.">
      <div className="-mt-1 flex items-center gap-2 px-0.5 text-[11px] text-ink-2">
        <span>Also a window of its own:</span>
        <Button
          variant="subtle"
          onClick={() => {
            // The sheet is its own dialog; Preferences closes so the two do not stack.
            useEditor.getState().setSettingsOpen(false)
            runCommand('help.shortcuts')
          }}
        >
          Open sheet
        </Button>
        {shortcut && <Kbd shortcut={shortcut} className="text-[11px] text-ink-2" />}
      </div>
      <ShortcutsSheet className="overflow-hidden rounded-md border border-line bg-surface-0/40" />
    </Section>
  )
}

/** What the provider row says under its label: where the CLI is, or what is missing. */
function providerHint(status: AgentProviderStatus | undefined): string {
  if (!status) return 'Looking for it on this Mac…'
  if (status.problem) return status.problem
  return `Using ${status.path}. Switching starts a new conversation.`
}

export function AgentSection(): ReactNode {
  const agentApproval = useEditor((state) => state.agentApproval)
  const setAgentApproval = useEditor((state) => state.setAgentApproval)
  const provider = useAgentProvider((state) => state.provider)
  const setProvider = useAgentProvider((state) => state.setProvider)
  const { answer: statuses } = useAsked(() => bay()?.agent.providers())
  const { answer: firstSocket, asked: socketAsked } = useAsked(() => bay()?.app.mcpReady())
  // The switch answers with the new status; until it is used, the first ask stands.
  const [changed, setChanged] = useState<typeof firstSocket>(null)
  const socket = changed ?? firstSocket
  const [switching, setSwitching] = useState(false)
  const setClients = (on: boolean): void => {
    const api = bay()
    if (!api) return
    setSwitching(true)
    void api.app
      .setMcpClients(on)
      .then(setChanged)
      .finally(() => setSwitching(false))
  }
  const status = statuses?.find((entry) => entry.provider === provider)
  return (
    <Section title="Agent" description="The agent in the side dock, and how terminal agents reach bay.">
      <Group title="In-app agent">
        <Row label="Model" hint={providerHint(status)}>
          <SegmentedControl
            label="Agent model"
            value={provider}
            // Never disabled: the hint says what the chosen one still needs, and the choice is
            // remembered for when it has it.
            options={AGENT_PROVIDERS.map((value) => ({ value, label: PROVIDER_LABELS[value] }))}
            onChange={setProvider}
          />
        </Row>
        <SwitchRow
          label="Ask before editing"
          description="Off: the agent edits directly, and every turn that changes the project shows what changed with a Revert button. On: it proposes each change and waits for you to approve it."
          checked={agentApproval}
          onChange={setAgentApproval}
        />
      </Group>
      <Group title="Terminal agents">
        <SwitchRow
          label="Allow MCP clients"
          description="Off by default. On: a terminal agent or another app can drive bay through its MCP socket. Their edits are their own — never counted as the in-app agent's, and not held to its approvals. The in-app agent does not need this."
          checked={socket?.enabled ?? false}
          disabled={!socketAsked || switching}
          onChange={setClients}
        />
        <Row
          label="MCP socket"
          hint={
            socket?.error ??
            (socket?.socketPath
              ? `${socket.socketPath} · ${socket.connectionsSeen === 0 ? 'no client has connected yet' : `${socket.connectionsSeen} connection${socket.connectionsSeen === 1 ? '' : 's'} this session`}`
              : undefined)
          }
        >
          {!socketAsked ? (
            <Checking />
          ) : socket === null ? (
            <Unknown />
          ) : !socket.enabled ? (
            <Badge tone="neutral">Off</Badge>
          ) : socket.ready ? (
            <Badge tone="success">Listening</Badge>
          ) : (
            <Badge tone="danger">Not listening</Badge>
          )}
        </Row>
      </Group>
    </Section>
  )
}
