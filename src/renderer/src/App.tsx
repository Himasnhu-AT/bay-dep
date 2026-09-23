import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/cn'
import { bay, call, importMessage } from '@/lib/bay'
import { useKeyboard } from '@/lib/useKeyboard'
import { registerMcpExecutor } from '@/mcp'
import { useEditor } from '@/store/editor'
import { ExportDialog } from '@/editor/ExportDialog'
import { Inspector } from '@/editor/Inspector'
import { LeftRail, SidePanel } from '@/editor/LeftRail'
import { ProjectsHome } from '@/home/ProjectsHome'
import { Button, Modal } from '@/components'
import { useDefaultLayout, usePanelRef, type PanelImperativeHandle } from 'react-resizable-panels'
import type { RefObject } from 'react'
import type { RegionId } from '@/store/editor'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { Preview } from '@/editor/Preview'
import { StatusBar } from '@/editor/StatusBar'
import { Timeline } from '@/editor/Timeline'
import { TopBar } from '@/editor/TopBar'
import { Transport } from '@/editor/Transport'

/**
 * Where a panel layout the user dragged into is remembered. `localStorage`, wrapped so that a
 * profile where storage throws (private mode, a locked-down profile) falls back to the defaults
 * instead of taking the editor down: a remembered layout is a convenience, never a requirement.
 */
const layoutStorage = {
  getItem(key: string): string | null {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  setItem(key: string, value: string): void {
    try {
      localStorage.setItem(key, value)
    } catch {
      // Not remembered this time; the layout still works.
    }
  }
}

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
  // One remembered layout per group. Keys are pinned by these ids: renaming one resets that
  // group to its defaults for everyone, which costs a drag, not data.
  const mainLayout = useDefaultLayout({ id: 'bay.layout.main', storage: layoutStorage })
  const workLayout = useDefaultLayout({ id: 'bay.layout.work', storage: layoutStorage })
  const stageLayout = useDefaultLayout({ id: 'bay.layout.stage', storage: layoutStorage })

  // -- hiding regions ----------------------------------------------------------
  //
  // The store says which regions are hidden; the panels are made to agree with it. Collapsing
  // rather than unmounting keeps the panel's last size, so showing it again puts it back where
  // it was. And the sync runs the other way too: a panel dragged shut against its edge
  // collapses, and its button must then read as "hidden" rather than disagree with the screen.
  const sideRef = usePanelRef()
  const inspectorRef = usePanelRef()
  const timelineRef = usePanelRef()
  const hiddenRegions = useEditor((state) => state.hiddenRegions)
  const setRegionHidden = useEditor((state) => state.setRegionHidden)

  // The width a region had when it was hidden, so showing it restores exactly that. The library's
  // own `expand()` restored the inspector to its minimum (236px came back as 220px) when the
  // side panel was wide, because it re-solves the whole group; an explicit resize does not.
  const sizeBeforeHide = useRef<Partial<Record<RegionId, number>>>({})
  useEffect(() => {
    const refs: [RegionId, RefObject<PanelImperativeHandle | null>][] = [
      ['side', sideRef],
      ['inspector', inspectorRef],
      ['timeline', timelineRef]
    ]
    for (const [region, ref] of refs) {
      const panel = ref.current
      if (!panel) continue
      if (hiddenRegions[region] && !panel.isCollapsed()) {
        sizeBeforeHide.current[region] = panel.getSize().inPixels
        panel.collapse()
      }
      if (!hiddenRegions[region] && panel.isCollapsed()) {
        panel.expand()
        const before = sizeBeforeHide.current[region]
        if (before) panel.resize(`${Math.round(before)}px`)
      }
    }
  }, [hiddenRegions, sideRef, inspectorRef, timelineRef])

  const followCollapse =
    (region: RegionId, ref: RefObject<PanelImperativeHandle | null>) => (): void => {
      const collapsed = ref.current?.isCollapsed()
      if (collapsed !== undefined) setRegionHidden(region, collapsed)
    }

  // -- the project the window opens with ------------------------------------

  // Launch lands on the projects screen, unless the OS asked for a particular file — a `.bay`
  // double-clicked in Finder — in which case the user already chose, and it opens directly.
  const screen = useEditor((state) => state.screen)
  const enterProject = useEditor((state) => state.enterProject)
  const showHome = useEditor((state) => state.showHome)
  useEffect(() => {
    let live = true
    void call('Opening the requested project', (api) => api.project.launchRequest()).then(
      (project) => {
        if (live && project) enterProject(project)
      }
    )
    return () => {
      live = false
    }
  }, [enterProject])

  // -- leaving a project -------------------------------------------------------
  //
  // Unsaved work is asked about, never dropped and never saved behind the user's back: going
  // home is not a request to write their file. The agent is stopped either way — its
  // conversation was about the project being left.
  const [confirmingHome, setConfirmingHome] = useState(false)
  const leaveToHome = useCallback((): void => {
    setConfirmingHome(false)
    void bay()?.agent.dispose()
    showHome()
  }, [showHome])
  const requestHome = useCallback((): void => {
    if (useEditor.getState().dirty) setConfirmingHome(true)
    else leaveToHome()
  }, [leaveToHome])

  const onSave = useCallback(async (): Promise<void> => {
    setSaving(true)
    const saved = await call('Save', (api) => api.project.save(useEditor.getState().project))
    setSaving(false)
    if (!saved) return
    markSaved()
    notify('Project saved.')
  }, [notify, markSaved])

  const onSaveAs = useCallback(async (): Promise<void> => {
    setSaving(true)
    const saved = await call('Save as', (api) => api.project.saveAs(useEditor.getState().project))
    setSaving(false)
    if (!saved) return
    markSaved()
    notify(`Saved to ${saved.filePath}`)
  }, [notify, markSaved])

  const onImport = useCallback(async (): Promise<void> => {
    const imported = await call('Import', (api) => api.media.importDialog())
    if (!imported || imported.length === 0) return
    addAssets(imported.map((entry) => entry.asset))
    const message = importMessage(imported)
    notify(message.text, message.kind)
  }, [addAssets, notify])

  /**
   * The application menu, which is the one channel that runs main -> renderer.
   *
   * It has to: the renderer owns the project, and `project.save(project)` needs a project
   * that a menu item in the main process does not have. Without this subscription every
   * item in the File menu is drawn, enabled, and does nothing at all when clicked.
   */
  useEffect(() => {
    const api = bay()
    if (!api) return
    // Not routed through `call`: this registers a listener and returns an unsubscribe,
    // so there is no promise to reject.
    return api.app.onMenuCommand((command) => {
      switch (command.type) {
        case 'save':
          void onSave()
          break
        case 'save-as':
          void onSaveAs()
          break
        case 'import':
          void onImport()
          break
        case 'export':
          setExportOpen(true)
          break
        case 'open':
          void call('Open project', (client) => client.project.open()).then((project) => {
            // Null is either a failed call, already reported, or the user cancelling the
            // picker. Neither should replace what they are working on.
            if (project) setProject(project)
          })
          break
        case 'open-path':
          void call('Open project', (client) =>
            client.project.openPath(command.path)
          ).then((project) => {
            if (project) setProject(project)
          })
          break
      }
    })
  }, [onSave, onSaveAs, onImport, setProject])

  /**
   * The agent surface. Registered here because the executor reaches the store directly and
   * needs nothing from this component — App is simply the one place that mounts once and
   * outlives every panel.
   */
  useEffect(() => registerMcpExecutor(), [])

  /**
   * The agent's events, subscribed here for the same reason.
   *
   * This lived in `AgentPanel` first, and that was wrong in a way only running it showed: the
   * panel unmounts whenever the user looks at Media or Effects, taking the only listener with
   * it, so a turn running in the background lost every event until they switched back. The
   * conversation is store state and outlives the view of it; the subscription has to outlive
   * the view too.
   */
  useEffect(() => {
    const api = bay()
    if (!api) return
    return api.agent.onEvent((event) => useEditor.getState().applyAgentEvent(event))
  }, [])

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
      const message = importMessage(imported)
      notify(message.text, message.kind)
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

  // After every hook, so switching screens never changes the order React sees them in.
  if (screen === 'home') return <ProjectsHome />

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-surface-0 text-ink-0">
      <TopBar
        onHome={requestHome}
        onExport={() => setExportOpen(true)}
        onSave={() => void onSave()}
        saving={saving}
      />

      {/* Every boundary between regions is a separator that can be dragged or moved with the
          arrow keys, and the layout is remembered. The rail is outside the groups: it is a
          fixed strip of buttons, and resizing it would only make the buttons harder to hit. */}
      <div className="flex min-h-0 flex-1">
        <LeftRail />

        <ResizablePanelGroup
          id="bay.layout.main"
          orientation="horizontal"
          defaultLayout={mainLayout.defaultLayout}
          onLayoutChanged={mainLayout.onLayoutChanged}
        >
          <ResizablePanel
            id="side"
            defaultSize="300px"
            minSize="220px"
            maxSize="55%"
            // Pixel-stable: resizing the window, or any panel beside it, goes to the preview —
            // the one region that is meant to take whatever space is left.
            groupResizeBehavior="preserve-pixel-size"
            collapsible
            collapsedSize="0px"
            panelRef={sideRef}
            onResize={followCollapse('side', sideRef)}
          >
            <SidePanel />
          </ResizablePanel>
          <ResizableHandle aria-label="Resize side panel" />

          <ResizablePanel id="work" minSize="45%">
            <ResizablePanelGroup
              id="bay.layout.work"
              orientation="vertical"
              defaultLayout={workLayout.defaultLayout}
              onLayoutChanged={workLayout.onLayoutChanged}
            >
              <ResizablePanel id="stage" minSize="220px">
                <ResizablePanelGroup
                  id="bay.layout.stage"
                  orientation="horizontal"
                  defaultLayout={stageLayout.defaultLayout}
                  onLayoutChanged={stageLayout.onLayoutChanged}
                >
                  <ResizablePanel id="viewer" minSize="320px">
                    <div className="flex h-full min-h-0 min-w-0 flex-col">
                      <Preview />
                      <Transport />
                    </div>
                  </ResizablePanel>
                  <ResizableHandle aria-label="Resize inspector" />
                  <ResizablePanel
                    id="inspector"
                    defaultSize="268px"
                    minSize="220px"
                    maxSize="45%"
                    groupResizeBehavior="preserve-pixel-size"
                    collapsible
                    collapsedSize="0px"
                    panelRef={inspectorRef}
                    onResize={followCollapse('inspector', inspectorRef)}
                  >
                    <Inspector />
                  </ResizablePanel>
                </ResizablePanelGroup>
              </ResizablePanel>
              <ResizableHandle aria-label="Resize timeline" />
              <ResizablePanel
                id="timeline"
                defaultSize="260px"
                minSize="150px"
                groupResizeBehavior="preserve-pixel-size"
                collapsible
                collapsedSize="0px"
                panelRef={timelineRef}
                onResize={followCollapse('timeline', timelineRef)}
              >
                <div className="flex h-full min-h-0 flex-col">
                  <Timeline />
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      <StatusBar />

      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />

      <Modal
        open={confirmingHome}
        title="Save changes before leaving?"
        onClose={() => setConfirmingHome(false)}
        width={380}
        footer={
          <>
            <Button variant="subtle" onClick={() => setConfirmingHome(false)}>
              Cancel
            </Button>
            <Button variant="subtle" onClick={leaveToHome}>
              Don't save
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                void (async () => {
                  await onSave()
                  // Only leave once it actually saved: a cancelled Save dialog keeps the user here.
                  if (!useEditor.getState().dirty) leaveToHome()
                })()
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <p className="text-[12px] leading-relaxed text-ink-1">
          “{useEditor.getState().project.name}” has changes that are not saved. Leave without them,
          or save first.
        </p>
      </Modal>

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
