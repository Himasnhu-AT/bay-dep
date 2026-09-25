import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { completeBrfImports } from '@/lib/brfImport'
import { placeCaptions } from '@/lib/mediaActions'
import { cn } from '@/lib/cn'
import { bay, call, importMessage } from '@/lib/bay'
import { useCommands } from '@/lib/commands'
import { registerMcpExecutor } from '@/mcp'
import { useEditor } from '@/store/editor'
import { ExportDialog } from '@/editor/ExportDialog'
import { ShortcutsDialog } from '@/editor/ShortcutsDialog'
import { ProjectsHome } from '@/home/ProjectsHome'
import { Workspace } from '@/editor/workspace/Workspace'
import { SettingsDialog } from '@/settings/SettingsDialog'
import { ProjectSettingsDialog } from '@/settings/ProjectSettingsDialog'
import { Button, Modal } from '@/components'
import type { Project } from '@shared/project'
import { IMPORT_FILES_EVENT } from '@/lib/agentAttachments'


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
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dropping, setDropping] = useState(false)
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
  //
  // Every way out of a project goes through `guardLeave`: Home, File › New Project, File ›
  // Open… and a document handed over by Finder. Each of them replaces the project and clears
  // its undo history, and nothing autosaves, so an unguarded one is a keystroke that loses work.
  const [leaving, setLeaving] = useState<{ to: string; go: () => void } | null>(null)
  const guardLeave = useCallback((to: string, go: () => void): void => {
    const { dirty, screen } = useEditor.getState()
    if (dirty && screen === 'editor') setLeaving({ to, go })
    else go()
  }, [])
  const leave = useCallback((): void => {
    const go = leaving?.go
    setLeaving(null)
    go?.()
  }, [leaving])
  const leaveToHome = useCallback((): void => {
    void bay()?.agent.dispose()
    showHome()
  }, [showHome])
  const requestHome = useCallback((): void => {
    guardLeave('going to your projects', leaveToHome)
  }, [guardLeave, leaveToHome])

  /**
   * Opening another project from the menu is leaving this one, exactly as going home is: the
   * agent's conversation, its session and its change cards were all about the project being
   * left. (The store also expires the cards on any change of project id — this is the part only
   * a user-initiated switch should do: stopping the agent.)
   */
  const switchProject = useCallback(
    (project: Project): void => {
      void bay()?.agent.dispose()
      const state = useEditor.getState()
      state.endAgentSession()
      state.clearAgentLog()
      state.clearAgentPins()
      setProject(project)
    },
    [setProject]
  )

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
    useEditor.getState().markSavedAs(saved.filePath, saved.name)
    notify(`Saved as “${saved.name}” — ${saved.filePath}`)
  }, [notify])

  const onImport = useCallback(async (): Promise<void> => {
    const picked = await call('Import', (api) => api.media.importDialog())
    if (!picked || picked.length === 0) return
    const imported = await completeBrfImports(picked)
    addAssets(imported.map((entry) => entry.asset))
    const message = importMessage(imported)
    notify(message.text, message.kind)
  }, [addAssets, notify])

  const onOpen = useCallback((): void => {
    guardLeave('opening another project', () => {
      void call('Open project', (client) => client.project.open()).then((project) => {
        // Null is either a failed call, already reported, or the user cancelling the picker.
        // Neither should replace what they are working on.
        if (project) switchProject(project)
      })
    })
  }, [guardLeave, switchProject])

  /**
   * A new project is opened the way a chosen one is: straight in from the projects screen, and
   * through `switchProject` from the editor, which ends the agent's session about the old one.
   */
  const onNewProject = useCallback((): void => {
    // Asked before creating, not after: `create` writes the new `.bay` at once.
    guardLeave('starting a new project', () => {
      void call('Create project', (client) => client.project.create()).then((project) => {
        if (!project) return
        if (useEditor.getState().screen === 'home') enterProject(project)
        else switchProject(project)
      })
    })
  }, [guardLeave, enterProject, switchProject])

  /**
   * macOS handing bay a document while it runs. Every *menu item* arrives as a registry
   * command and is run by `useCommands` below; this is the one menu-channel message that is
   * not a command, because it carries a path.
   */
  useEffect(() => {
    const api = bay()
    if (!api) return
    // Not routed through `call`: this registers a listener and returns an unsubscribe,
    // so there is no promise to reject.
    return api.app.onMenuCommand((command) => {
      if (command.type !== 'open-path') return
      void call('Open project', (client) => client.project.openPath(command.path)).then(
        (project) => {
          if (project) guardLeave(`opening “${project.name}”`, () => switchProject(project))
        }
      )
    })
  }, [guardLeave, switchProject])

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

  /**
   * Whisper model downloads, for the same reason: one may start from a transcription while
   * Settings is closed, and the status bar and Settings both show it.
   */
  useEffect(() => {
    const api = bay()
    if (!api) return
    return api.whisper.onDownload((download) => useEditor.getState().setWhisperDownload(download))
  }, [])

  // Every shortcut and every menu item (`@/lib/commands`). The host is what only this component
  // can do: IPC round trips and its own dialogs.
  useCommands({
    save: () => void onSave(),
    saveAs: () => void onSaveAs(),
    open: onOpen,
    newProject: onNewProject,
    importMedia: () => void onImport(),
    openExport: () => setExportOpen(true),
    openShortcuts: () => setShortcutsOpen(true),
    escape: () => setExportOpen(false)
  })

  // -- files dropped on the window ------------------------------------------

  const importPaths = useCallback(
    async (dropped: string[]): Promise<void> => {
      // Caption files are not media: their cues go onto the timeline through `add_captions`.
      const isCaptions = (path: string): boolean => /\.(srt|vtt)$/i.test(path)
      for (const path of dropped.filter(isCaptions)) {
        const file = await call('Import captions', (api) => api.media.readCaptions(path))
        if (file) placeCaptions(file)
      }
      const paths = dropped.filter((path) => !isCaptions(path))
      if (paths.length === 0) return
      // Going through `importPaths` is not optional: it is what adds these paths to the
      // `bay://` allowlist, and a path that skips it reads back as a 403 on playback.
      const arrived = await call('Import', (api) => api.media.importPaths(paths))
      if (!arrived) return
      const imported = await completeBrfImports(arrived)
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
      // Taken by a drop target of its own (the agent panel's attachments): no import overlay.
      if (event.defaultPrevented) {
        setDropping(false)
        return
      }
      if (!event.dataTransfer?.types.includes('Files')) return
      event.preventDefault()
      event.dataTransfer.dropEffect = 'copy'
      setDropping(true)
    }
    const onDragLeave = (event: DragEvent): void => {
      if (event.relatedTarget === null) setDropping(false)
    }
    const onDrop = (event: DragEvent): void => {
      if (event.defaultPrevented) {
        setDropping(false)
        return
      }
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

    // The files of a drop on the agent panel that it does not attach (audio, captions, a TIFF…):
    // imported exactly as if they had been dropped anywhere else.
    const onImportFiles = (event: Event): void => {
      const files = (event as CustomEvent<File[]>).detail ?? []
      const paths = files.map(pathForFile).filter((path): path is string => path !== null)
      if (paths.length > 0) void importPaths(paths)
    }

    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    window.addEventListener(IMPORT_FILES_EVENT, onImportFiles)
    return () => {
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener(IMPORT_FILES_EVENT, onImportFiles)
    }
  }, [importPaths, notify])

  // After every hook, so switching screens never changes the order React sees them in.
  if (screen === 'home') {
    return (
      <>
        <ProjectsHome />
        <SettingsDialog />
        <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      </>
    )
  }

  return (
    <div className="flex h-full w-full flex-col overflow-hidden bg-surface-0 text-ink-0">
      <Workspace onHome={requestHome} onExport={() => setExportOpen(true)} saving={saving} />

      <ExportDialog open={exportOpen} onClose={() => setExportOpen(false)} />
      <ProjectSettingsDialog />
      <SettingsDialog />
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />

      <Modal
        open={leaving !== null}
        title="Save changes before leaving?"
        onClose={() => setLeaving(null)}
        width={380}
        footer={
          // macOS order: the destructive choice apart on the left, Cancel beside the default.
          // "Don't save" throws work away, so it reads as the one that does.
          <>
            <Button variant="danger" onClick={leave} className="mr-auto">
              Don't save
            </Button>
            <Button variant="subtle" onClick={() => setLeaving(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                void (async () => {
                  await onSave()
                  // Only leave once it actually saved: a cancelled Save dialog keeps the user here.
                  if (!useEditor.getState().dirty) leave()
                })()
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <p className="px-4 py-3 text-[12px] leading-relaxed text-pretty text-ink-1">
          “{useEditor.getState().project.name}” has changes that are not saved. Save them before
          {' '}{leaving?.to ?? 'leaving'}, or leave without them.
        </p>
      </Modal>

      {/* A drop target you cannot see is a drop target you do not use. */}
      <div
        aria-hidden="true"
        className={cn(
          't-fast pointer-events-none fixed inset-0 z-(--z-overlay) border-2 border-accent bg-accent/5',
          dropping ? 'opacity-100' : 'opacity-0'
        )}
      />
    </div>
  )
}
