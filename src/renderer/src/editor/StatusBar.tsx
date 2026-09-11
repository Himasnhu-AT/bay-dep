import { useEffect, useState, type ReactNode } from 'react'
import { AlertTriangle } from 'lucide-react'
import { formatTimecode } from '@shared/project'
import { Toast, Tooltip } from '@/components'
import { bay } from '@/lib/bay'
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
  const timeline = useEditor(selectTimeline)
  const duration = useEditor(selectDuration)
  const fps = useEditor(selectFps)
  const selectionCount = useEditor((state) => state.selection.length)
  const assetCount = useEditor((state) => state.project.assets.length)
  const [tools, setTools] = useState<{ ready: boolean } | null>(null)
  const [storage, setStorage] = useState<{ ready: boolean; error: string | null } | null>(null)

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
    return () => {
      live = false
    }
  }, [])

  return (
    <footer className="flex h-6 shrink-0 items-center gap-3 border-t border-line bg-surface-1 px-3 text-[11px]">
      <Stat label="fps" value={fps} />
      <Stat label="duration" value={formatTimecode(duration, fps, true)} />
      <Stat
        label="canvas"
        value={timeline ? `${timeline.width}×${timeline.height}` : '—'}
      />
      <Stat label="media" value={assetCount} />
      <Stat label="selected" value={selectionCount} />

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

      <div className="ml-auto flex min-w-0 items-center">
        <Toast />
      </div>
    </footer>
  )
}
