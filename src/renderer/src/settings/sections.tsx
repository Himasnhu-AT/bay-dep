import { useEffect, useState, type ReactNode } from 'react'
import { Button, Kbd, NumberField, SegmentedControl } from '@/components'
import { runCommand, shortcutOf } from '@/lib/commands'
import { bayTheme, type ThemePreference } from '@/lib/theme'
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
import { Row, Section, SwitchRow } from './parts'

export function GeneralSection(): ReactNode {
  const debugMode = useEditor((state) => state.debugMode)
  const toggleDebugMode = useEditor((state) => state.toggleDebugMode)
  const [theme, setTheme] = useState<ThemePreference>(() => bayTheme()?.get() ?? 'dark')
  const shortcut = shortcutOf('help.shortcuts')

  return (
    <Section title="General">
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
      <Row label="Keyboard shortcuts" hint="Every key bay answers to, by menu.">
        {shortcut && <Kbd shortcut={shortcut} />}
        <Button
          variant="subtle"
          onClick={() => {
            // The sheet is its own dialog; Settings closes so the two do not stack.
            useEditor.getState().setSettingsOpen(false)
            runCommand('help.shortcuts')
          }}
        >
          Show
        </Button>
      </Row>
      <SwitchRow
        label="Debug mode"
        description="Shows tools for reporting problems, such as exporting the agent's transcript. Also View → Toggle Debug Mode (⌥⌘D)."
        checked={debugMode}
        onChange={() => toggleDebugMode()}
      />
    </Section>
  )
}

/** "= 150 frames at 30 fps" for the open timeline; nothing on the projects screen. */
function framesHint(frames: number | null, fps: number | null): string | undefined {
  if (frames === null || fps === null) return undefined
  return `${frames} frame${frames === 1 ? '' : 's'} at ${Math.round(fps * 1000) / 1000} fps`
}

export function EditingSection(): ReactNode {
  const stillSeconds = useEditingPrefs((state) => state.stillSeconds)
  const transitionSeconds = useEditingPrefs((state) => state.transitionSeconds)
  const setStillSeconds = useEditingPrefs((state) => state.setStillSeconds)
  const setTransitionSeconds = useEditingPrefs((state) => state.setTransitionSeconds)
  const newClipFit = useEditingPrefs((state) => state.newClipFit)
  const setNewClipFit = useEditingPrefs((state) => state.setNewClipFit)
  const fps = useEditor((state) => selectTimeline(state)?.fps ?? null)

  return (
    <Section title="Editing" description="Defaults for new clips and transitions. Clips already on the timeline keep their length.">
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
      <Row
        label="New clips"
        hint={
          {
            auto: 'A video or image shaped differently from the canvas fills it, unless that would crop away too much; then it is shown whole.',
            contain: 'A video or image shaped differently from the canvas is shown whole, with bars where the shapes differ.',
            cover: 'A video or image shaped differently from the canvas fills it; the edges that do not fit are cropped.'
          }[newClipFit]
        }
      >
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
    </Section>
  )
}

export function PlaybackSection(): ReactNode {
  const followPlayhead = useEditingPrefs((state) => state.followPlayhead)
  const setFollowPlayhead = useEditingPrefs((state) => state.setFollowPlayhead)
  return (
    <Section title="Playback">
      <SwitchRow
        label="Timeline follows the playhead"
        description="While playing, the timeline scrolls to keep the playhead in view. Off: it stays where you left it."
        checked={followPlayhead}
        onChange={setFollowPlayhead}
      />
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
  const [statuses, setStatuses] = useState<AgentProviderStatus[] | null>(null)
  useEffect(() => {
    let live = true
    void bay()
      ?.agent.providers()
      .then((found) => {
        if (live) setStatuses(found)
      })
    return () => {
      live = false
    }
  }, [])
  const status = statuses?.find((entry) => entry.provider === provider)
  return (
    <Section title="Agent">
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
    </Section>
  )
}

export function UpdatesSection(): ReactNode {
  return (
    <Section title="Updates">
      <AboutUpdates />
    </Section>
  )
}

export function AboutSection(): ReactNode {
  const status = useUpdate()
  return (
    <Section title="About">
      <Row label={status ? `bay ${status.current}` : 'bay'} hint="A video editor you can also drive with an agent.">
        {null}
      </Row>
      <p className="text-[11px] text-pretty text-ink-2">
        Your projects, media and audio stay on this Mac. bay goes online only to check your sign-in, to
        download a transcription model when you ask for one, to look for updates, to download a video from
        a web page with your own yt-dlp when you (or the agent, with your OK) ask for one, and — with a key
        you set in Providers — to send a generation prompt or a voiceover script (and any reference picture
        it names) to that provider.
      </p>
    </Section>
  )
}
