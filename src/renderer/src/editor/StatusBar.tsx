import { useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle, LoaderCircle } from 'lucide-react'
import { formatFps, formatTimecode } from '@shared/project'
import { summariseAgentSurface, type AgentSurfaceStatus } from '@shared/mcp'
import { downloadSentence } from '@shared/whisper'
import { Toast, Tooltip } from '@/components'
import { bay } from '@/lib/bay'
import { catalogMismatch } from '@/mcp'
import { selectDuration, selectFps, selectTimeline, useEditor } from '@/store/editor'

function Stat({ label, value }: { label: string; value: ReactNode }): ReactNode {
  return (
    <span className="flex items-baseline gap-1">
      <span className="text-ink-2">{label}</span>
      <span className="text-ink-1 tabular-nums">{value}</span>
    </span>
  )
}

export function StatusBar(): ReactNode {
  const toast = useEditor((state) => state.toast)
  const dismissToast = useEditor((state) => state.dismissToast)
  const timeline = useEditor(selectTimeline)
  const duration = useEditor(selectDuration)
  const fps = useEditor(selectFps)
  const selectionCount = useEditor((state) => state.selection.length)
  const assetCount = useEditor((state) => state.project.assets.length)
  const debugMode = useEditor((state) => state.debugMode)
  const download = useEditor((state) => state.whisperDownload)
  const downloading = download?.state === 'downloading' || download?.state === 'verifying'
  const [tools, setTools] = useState<{ ready: boolean } | null>(null)
  const [storage, setStorage] = useState<{ ready: boolean; error: string | null } | null>(null)
  const [agent, setAgent] = useState<AgentSurfaceStatus | null>(null)

  useEffect(() => {
    const api = bay()
    if (!api) return
    let live = true
    // Both of these stay null when the bridge cannot answer, and the bar then says
    // nothing. A subsystem that failed and one we could not ask about are different
    // things, and only the first is worth accusing on screen.
    void api.app
      .mediaToolsReady()
      .then((result) => {
        if (live) setTools(result)
      })
      .catch(() => undefined)
    // Recents and reopen-last-project degrade silently without the database: an empty
    // recents list looks identical whether storage is broken or you simply have no
    // projects yet. This is the only thing that tells them apart.
    void api.app
      .storageReady()
      .then((result) => {
        if (live) setStorage(result)
      })
      .catch(() => undefined)
    // Asked once at mount and then again, because `connectionsSeen` is the half that changes:
    // a client usually connects seconds after launch, and a bar that only ever said "no agent
    // has connected yet" would be the idle-looks-like-broken failure this status exists to
    // prevent, one level along. Ten seconds is slow enough to cost nothing and fast enough
    // that the line is right by the time anyone reads it.
    const askAgent = (): void => {
      void api.app
        .mcpReady()
        .then((result) => {
          if (live) setAgent(result)
        })
        .catch(() => undefined)
    }
    askAgent()
    const poll = setInterval(askAgent, 10_000)
    return () => {
      live = false
      clearInterval(poll)
    }
  }, [])

  return (
    <footer className="flex h-6 shrink-0 items-center gap-3 border-t border-line bg-surface-1 px-3 text-[11px]">
      {/* `formatFps`, not `fps`: the stored rate is a quotient, so this read
          `fps 29.97002997002997` the moment a project could be NTSC. */}
      <Stat label="fps" value={formatFps(fps)} />
      <Stat label="duration" value={formatTimecode(duration, fps, true)} />
      <Stat
        label="canvas"
        value={timeline ? `${timeline.width}×${timeline.height}` : '—'}
      />
      <Stat label="media" value={assetCount} />
      <Stat label="selected" value={selectionCount} />

      {/* A model download a transcription started on its own would otherwise be a tool call that
          sat for two minutes with no explanation. */}
      {download && downloading && (
        <button
          type="button"
          onClick={() => useEditor.getState().setSettingsOpen(true)}
          className="t-fast flex items-center gap-1 rounded-sm px-1 text-ink-1 tabular-nums hover:bg-surface-3 hover:text-ink-0"
        >
          <LoaderCircle aria-hidden="true" className="size-3 animate-spin" />
          {downloadSentence(download)}
        </button>
      )}

      {debugMode && (
        <Tooltip side="top" label="Debug mode is on" shortcut="View → Toggle Debug Mode (⌥⌘D)">
          <span className="rounded-sm bg-warning/15 px-1 text-[10px] font-semibold tracking-[0.08em] text-warning uppercase">
            Debug
          </span>
        </Tooltip>
      )}

      {tools && !tools.ready && (
        <Tooltip
          side="top"
          label="ffmpeg and ffprobe were not found"
          shortcut="import, waveforms and export need them"
        >
          <span className="flex items-center gap-1 text-danger">
            <AlertTriangle aria-hidden="true" className="size-3" />
            Media tools missing
          </span>
        </Tooltip>
      )}

      {storage && !storage.ready && (
        <Tooltip
          side="top"
          label={storage.error ?? 'The project database did not open'}
          shortcut="recent projects will stay empty"
        >
          <span className="flex items-center gap-1 text-danger">
            <AlertTriangle aria-hidden="true" className="size-3" />
            Storage unavailable
          </span>
        </Tooltip>
      )}

      {/* Not a `Stat`: the failing case is an accusation and the healthy case is a count, and
          a row that reads "agent 0" would say nothing about which of the two it is. The
          sentence comes from `@shared/mcp` so main and the bar cannot word it differently. */}
      {agent && !agent.ready && (
        <Tooltip
          side="top"
          label={summariseAgentSurface(agent)}
          shortcut="editing, playback and export are unaffected"
        >
          <span className="flex items-center gap-1 text-danger">
            <AlertTriangle aria-hidden="true" className="size-3" />
            Agent control unavailable
          </span>
        </Tooltip>
      )}

      {agent?.ready && (
        <Tooltip side="top" label={summariseAgentSurface(agent)} shortcut="MCP over a unix socket">
          <span className="text-ink-2">
            agent{' '}
            <span className="text-ink-1 tabular-nums">
              {agent.connectionsSeen === 0 ? 'idle' : agent.connectionsSeen}
            </span>
          </span>
        </Tooltip>
      )}

      {catalogMismatch && (
        <Tooltip
          side="top"
          label={
            catalogMismatch.missing.length > 0
              ? `Listed but not implemented: ${catalogMismatch.missing.join(', ')}`
              : `Implemented but not listed: ${catalogMismatch.extra.join(', ')}`
          }
          shortcut="an agent will be refused these tools by name"
        >
          <span className="flex items-center gap-1 text-danger">
            <AlertTriangle aria-hidden="true" className="size-3" />
            Agent tools incomplete
          </span>
        </Tooltip>
      )}

      <div className="ml-auto flex min-w-0 items-center">
        <Toast toast={toast} onDismiss={dismissToast} />
      </div>
    </footer>
  )
}
