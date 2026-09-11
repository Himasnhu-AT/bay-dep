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

  useEffect(() => {
    const api = bay()
    if (!api) return
    let live = true
    void api.app
      .mediaToolsReady()
      .then((result) => {
        if (live) setTools(result)
      })
      // A bridge that cannot answer is not the same as ffmpeg being absent, so this stays
      // null and the bar says nothing rather than accusing a working install.
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

      <div className="ml-auto flex min-w-0 items-center">
        <Toast />
      </div>
    </footer>
  )
}
