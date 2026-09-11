import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { bay, call } from '@/lib/bay'
import { useDrag } from '@/lib/useDrag'
import { useKeyboard } from '@/lib/useKeyboard'
import { useEditor } from '@/store/editor'
import { ExportDialog } from '@/editor/ExportDialog'
import { Inspector } from '@/editor/Inspector'
import { LeftRail } from '@/editor/LeftRail'
import { Preview } from '@/editor/Preview'
import { StatusBar } from '@/editor/StatusBar'
import { Timeline } from '@/editor/Timeline'
import { TopBar } from '@/editor/TopBar'
import { Transport } from '@/editor/Transport'

const MIN_TIMELINE_HEIGHT = 150
const MIN_STAGE_HEIGHT = 220

/**
 * Electron 32 removed `File.path`, so a file out of a `DataTransfer` no longer names
 * itself. `webUtils.getPathForFile` is the replacement, and it needs the real `File`
 * object — which cannot cross an IPC boundary — so the bridge resolves it inside preload
 * and returns synchronously.
 *
 * It returns `''` rather than throwing for a File the browser has no path for: a
 * synthesised File, a directory entry, a clipboard paste. That empty string becoming null
 * here is what routes those to the "use Import instead" message, and it is the only
 * fallback there is — guessing a path from a file's name would import the wrong file.
 *
 * The `File` is passed straight through from the `DataTransfer` on purpose. It is one of
 * the few complex objects `contextBridge` hands over intact rather than proxying, and
 * destructuring or cloning it first would break that.
 */
function pathForFile(file: File): string | null {
  return bay()?.media.pathForFile(file) || null
}

export function App(): ReactNode {
  const setProject = useEditor((state) => state.setProject)
  const addAssets = useEditor((state) => state.addAssets)
  const notify = useEditor((state) => state.notify)
  const markSaved = useEditor((state) => state.markSaved)

  const [exportOpen, setExportOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dropping, setDropping] = useState(false)
  const [timelineHeight, setTimelineHeight] = useState(260)
  const splitRef = useRef<HTMLDivElement>(null)
  const dragStartHeight = useRef(260)

  // -- the project the window opens with ------------------------------------

  useEffect(() => {
    let live = true
    void call('Opening the last project', (api) => api.project.initial()).then((project) => {
      if (live && project) setProject(project)
    })
    return () => {
      live = false
    }
  }, [setProject])

  const onSave = useCallback(async (): Promise<void> => {
    setSaving(true)
    const saved = await call('Save', (api) => api.project.save(useEditor.getState().project))
    setSaving(false)
    if (!saved) return
    markSaved()
    notify('Project saved.')
  }, [notify, markSaved])

  useKeyboard({
    onSave: () => void onSave(),
    onExport: () => setExportOpen(true),
    onEscape: () => setExportOpen(false)
  })

  // -- files dropped on the window ------------------------------------------

  const importPaths = useCallback(
    async (paths: string[]): Promise<void> => {
      if (paths.length === 0) return
      // Going through `importPaths` is not optional: it is what adds these paths to the
      // `bay://` allowlist, and a path that skips it reads back as a 403 on playback.
      const imported = await call('Import', (api) => api.media.importPaths(paths))
      if (!imported) return
      addAssets(imported.map((entry) => entry.asset))
      const fresh = imported.filter((entry) => !entry.reused).length
      notify(
        fresh === imported.length
          ? `Imported ${fresh} file${fresh === 1 ? '' : 's'}.`
          : `Imported ${fresh}, reused ${imported.length - fresh} already in the project.`
      )
    },
    [addAssets, notify]
  )

  useEffect(() => {
    // These live on the window rather than on a React element because the default action
    // for a dropped file in a renderer is to *navigate to it*, which unloads the app. It
    // has to be prevented everywhere, including over gaps between panels.
    const onDragOver = (event: DragEvent): void => {
      if (!event.dataTransfer?.types.includes('Files')) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
      setDropping(true)
    }
    const onDragLeave = (event: DragEvent): void => {
      if (event.relatedTarget === null) setDropping(false)
    }
    const onDrop = (event: DragEvent): void => {
      if (!event.dataTransfer?.types.includes('Files')) return
      event.preventDefault()
      setDropping(false)
      const files = Array.from(event.dataTransfer.files)
      const paths = files.map(pathForFile).filter((path): path is string => path !== null)
      if (paths.length === 0) {
        notify('Those files could not be read from the drop. Use Import instead.', 'error')
        return
      }
      void importPaths(paths)
    }

    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [importPaths, notify])

  // -- the stage / timeline splitter ----------------------------------------

  const onSplitPointerDown = useDrag({
    onStart: () => {
      dragStartHeight.current = timelineHeight
      document.body.style.cursor = 'ns-resize'
    },
    onMove: (state) => {
      const available = splitRef.current?.parentElement?.clientHeight ?? 600
      const next = dragStartHeight.current - state.dy
      setTimelineHeight(
        Math.max(MIN_TIMELINE_HEIGHT, Math.min(next, available - MIN_STAGE_HEIGHT))
      )
    },
    onEnd: () => {
      document.body.style.cursor = ''
    },
    onClick: () => {
      document.body.style.cursor = ''
    }
  })

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-surface-0 text-ink-0">
      <TopBar onExport={() => setExportOpen(true)} onSave={() => void onSave()} saving={saving} />

      <div className="flex min-h-0 flex-1">
        <LeftRail />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex min-h-0 flex-1">
            <div className="flex min-h-0 min-w-0 flex-1 flex-col">
              <Preview />
              <Transport />
            </div>
            <div className="w-[268px] shrink-0 border-l border-line">
              <Inspector />
            </div>
          </div>

          {/* A separator that only responds to a pointer is unreachable for anyone
              driving the app from the keyboard, and it is the one control here that
              decides how much of the window the timeline gets. */}
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Resize timeline"
            aria-valuenow={Math.round(timelineHeight)}
            tabIndex={0}
            ref={splitRef}
            onPointerDown={onSplitPointerDown}
            onKeyDown={(event) => {
              const step = event.shiftKey ? 48 : 12
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setTimelineHeight((height) => height + step)
              } else if (event.key === 'ArrowDown') {
                event.preventDefault()
                setTimelineHeight((height) => Math.max(MIN_TIMELINE_HEIGHT, height - step))
              }
            }}
            className="t-fast h-1 shrink-0 cursor-ns-resize bg-transparent hover:bg-accent/60 focus-visible:bg-accent"
          />

          <div className="flex min-h-0 flex-col" style={{ height: timelineHeight }}>
            <Timeline />
          </div>
        </div>
      </div>

      <StatusBar />

      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />

      {/* A drop target you cannot see is a drop target you do not use. */}
      <div
        aria-hidden="true"
        className={cn(
          't-fast pointer-events-none fixed inset-0 z-40 border-2 border-accent bg-accent/5',
          dropping ? 'opacity-100' : 'opacity-0'
        )}
      />
    </div>
  )
}
