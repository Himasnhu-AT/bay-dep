import { useCallback, useEffect, useMemo, useState, type MouseEvent, type ReactNode } from 'react'
import {
  ArrowDownAZ,
  Clock,
  Film,
  FolderOpen,
  LayoutGrid,
  List,
  MoreVertical,
  Plus,
  Settings
} from 'lucide-react'
import type { Project } from '@shared/project'
import type { RecentProject } from '@shared/ipc'
import {
  Button,
  ContextMenu,
  IconButton,
  Menu,
  Modal,
  SearchField,
  TextField,
  Toast,
  useFloatingTrigger,
  type MenuEntry
} from '@/components'
import { call } from '@/lib/bay'
import { formatShortcut, runCommand, shortcutOf } from '@/lib/commands'
import { cn } from '@/lib/cn'
import { useEditor } from '@/store/editor'

/**
 * The projects screen: what bay shows at launch, and what the Home button goes back to.
 *
 * Every project the user has opened or created, newest first, with a search, a grid or list
 * view, and a "Create new project" tile that never asks a question — the project is written into
 * the projects folder under a free name and opened. A `.bay` from anywhere else is one "Open…"
 * away. Choosing a project hands it to the editor; nothing here edits a project.
 */

type View = 'grid' | 'list'
type Sort = 'recent' | 'name'

const VIEW_KEY = 'bay.home.view'
const SORT_KEY = 'bay.home.sort'

function remembered<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = localStorage.getItem(key)
    return allowed.includes(value as T) ? (value as T) : fallback
  } catch {
    return fallback
  }
}

function remember(key: string, value: string): void {
  try {
    localStorage.setItem(key, value)
  } catch {
    // A preference that is not remembered still applies for this session.
  }
}

/** "just now", "5 min ago", "3 h ago", "2 d ago", then a date. */
function relativeTime(then: number, now: number): string {
  const seconds = Math.max(0, Math.round((now - then) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} h ago`
  const days = Math.round(hours / 24)
  if (days < 30) return `${days} d ago`
  return new Date(then).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  })
}

export function ProjectsHome(): ReactNode {
  const toast = useEditor((state) => state.toast)
  const dismissToast = useEditor((state) => state.dismissToast)
  const enterProject = useEditor((state) => state.enterProject)
  const notify = useEditor((state) => state.notify)

  const [recents, setRecents] = useState<RecentProject[] | null>(null)
  const [query, setQuery] = useState('')
  const [view, setView] = useState<View>(() => remembered(VIEW_KEY, ['grid', 'list'], 'grid'))
  const [sort, setSort] = useState<Sort>(() => remembered(SORT_KEY, ['recent', 'name'], 'recent'))
  const [busy, setBusy] = useState(false)
  const [renaming, setRenaming] = useState<RecentProject | null>(null)
  const [trashing, setTrashing] = useState<RecentProject | null>(null)
  const [menuAt, setMenuAt] = useState<{ x: number; y: number; recent: RecentProject } | null>(null)

  const load = useCallback(async (): Promise<void> => {
    const list = await call('Listing projects', (api) => api.project.recent())
    setRecents(list ?? [])
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const open = async (work: () => Promise<Project | null>): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      const project = await work()
      if (project) enterProject(project)
    } finally {
      setBusy(false)
    }
  }

  const openRecent = (recent: RecentProject): Promise<void> =>
    open(async () => {
      const project = await call(`Opening ${recent.name}`, (api) =>
        api.project.openPath(recent.filePath)
      )
      // A project that would not open is probably gone or damaged; refresh so the list stops
      // offering it if main pruned it, rather than leaving a tile that fails every time.
      if (!project) void load()
      return project
    })

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const filtered = (recents ?? []).filter(
      (recent) => !needle || recent.name.toLowerCase().includes(needle)
    )
    return sort === 'name'
      ? [...filtered].sort((a, b) => a.name.localeCompare(b.name))
      : [...filtered].sort((a, b) => b.updatedAt - a.updatedAt)
  }, [recents, query, sort])

  const now = Date.now()

  /**
   * One list of actions for a project, drawn by its ⋯ button and by a right-click on it, so the
   * two can never offer different things. Renaming and trashing ask first (a name to type, and a
   * file leaving the list); the rest act at once.
   */
  const actionsFor = (recent: RecentProject): MenuEntry[] => [
    { label: 'Rename…', onSelect: () => setRenaming(recent) },
    {
      label: 'Duplicate',
      onSelect: () =>
        void call(`Duplicating ${recent.name}`, (api) => api.project.duplicate(recent.filePath)).then(
          (copy) => {
            if (!copy) return
            notify(`Duplicated as “${copy.name}”.`)
            void load()
          }
        )
    },
    {
      label: 'Show in Finder',
      onSelect: () => void call('Show in Finder', (api) => api.project.reveal(recent.filePath))
    },
    {
      label: 'Remove from list',
      onSelect: () =>
        void call('Remove from list', (api) => api.project.forget(recent.filePath)).then(() => {
          notify(`Removed ${recent.name} from the list. The file is still on disk.`)
          void load()
        })
    },
    { kind: 'separator' },
    { label: 'Move to Trash…', danger: true, onSelect: () => setTrashing(recent) }
  ]

  const onContextMenu =
    (recent: RecentProject) =>
    (event: MouseEvent): void => {
      event.preventDefault()
      setMenuAt({ x: event.clientX, y: event.clientY, recent })
    }

  // The same command as File › New Project and ⌘N, so all three create a project one way.
  const createProject = (): void => {
    if (!busy) runCommand('file.newProject')
  }
  const createHint = `Create new project (${formatShortcut(shortcutOf('file.newProject') ?? '')})`

  return (
    <div className="flex h-full w-full flex-col bg-surface-0 text-ink-0">
      {/* The window's drag strip — traffic lights live here and the window must stay movable. */}
      <div className="drag-region h-11 shrink-0" />

      <div className="flex min-h-0 flex-1 justify-center px-8 pb-8">
        <section className="flex min-h-0 w-full max-w-[1200px] flex-col overflow-hidden rounded-xl border border-line bg-surface-1">
          <header className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3">
            <h1 className="mr-2 text-[13px] font-semibold text-ink-0">bay</h1>
            <SearchField
              label="Search projects"
              placeholder="Search projects…"
              value={query}
              onValueChange={setQuery}
              className="h-8 w-72"
            />
            <div className="flex-1" />
            <button
              type="button"
              onClick={() => void open(() => call('Open project', (api) => api.project.open()))}
              className="t-fast flex h-8 items-center gap-1.5 rounded-md px-2.5 text-[12px] text-ink-1 hover:bg-surface-3 hover:text-ink-0"
            >
              <FolderOpen aria-hidden="true" className="size-3.5" />
              Open…
            </button>
            <div className="flex items-center rounded-md border border-line bg-surface-2 p-0.5">
              <IconButton
                label="Grid"
                icon={<LayoutGrid className="size-3.5" />}
                active={view === 'grid'}
                onClick={() => {
                  setView('grid')
                  remember(VIEW_KEY, 'grid')
                }}
              />
              <IconButton
                label="List"
                icon={<List className="size-3.5" />}
                active={view === 'list'}
                onClick={() => {
                  setView('list')
                  remember(VIEW_KEY, 'list')
                }}
              />
            </div>
            <IconButton
              label={sort === 'recent' ? 'Sorted by last edited — sort by name' : 'Sorted by name — sort by last edited'}
              icon={sort === 'recent' ? <Clock className="size-3.5" /> : <ArrowDownAZ className="size-3.5" />}
              onClick={() => {
                const next: Sort = sort === 'recent' ? 'name' : 'recent'
                setSort(next)
                remember(SORT_KEY, next)
              }}
            />
            <IconButton
              label="Settings"
              shortcut={shortcutOf('app.settings')}
              icon={<Settings className="size-3.5" />}
              onClick={() => useEditor.getState().setSettingsOpen(true)}
            />
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {view === 'grid' ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-x-4 gap-y-5">
                <CreateTile busy={busy} hint={createHint} onCreate={createProject} />
                {shown.map((recent) => (
                  <ProjectCard
                    key={recent.filePath}
                    recent={recent}
                    when={relativeTime(recent.updatedAt, now)}
                    onOpen={() => void openRecent(recent)}
                    actions={actionsFor(recent)}
                    onContextMenu={onContextMenu(recent)}
                  />
                ))}
              </div>
            ) : (
              <div className="flex flex-col">
                <button
                  type="button"
                  disabled={busy}
                  onClick={createProject}
                  title={createHint}
                  className="t-fast flex items-center gap-3 rounded-md px-2 py-2 text-left hover:bg-surface-3"
                >
                  <span className="grid h-9 w-16 place-items-center rounded-sm border border-line-strong bg-surface-2">
                    <Plus aria-hidden="true" className="size-4 text-ink-1" />
                  </span>
                  <span className="text-[13px] font-medium">Create new project</span>
                </button>
                {shown.map((recent) => (
                  <ProjectRow
                    key={recent.filePath}
                    recent={recent}
                    when={relativeTime(recent.updatedAt, now)}
                    onOpen={() => void openRecent(recent)}
                    actions={actionsFor(recent)}
                    onContextMenu={onContextMenu(recent)}
                  />
                ))}
              </div>
            )}

            {recents !== null && recents.length === 0 && (
              <p className="mt-6 text-center text-[12px] text-ink-2">
                Projects you create or open show up here.
              </p>
            )}
            {recents !== null && recents.length > 0 && shown.length === 0 && (
              <p className="mt-6 text-center text-[12px] text-ink-2">
                No project matches “{query.trim()}”.
              </p>
            )}
          </div>
        </section>
      </div>
      <div className="fixed right-4 bottom-4">
        <Toast toast={toast} onDismiss={dismissToast} />
      </div>

      <ContextMenu
        at={menuAt ? { x: menuAt.x, y: menuAt.y } : null}
        onClose={() => setMenuAt(null)}
        label={menuAt ? `${menuAt.recent.name} actions` : 'Project actions'}
        items={menuAt ? actionsFor(menuAt.recent) : []}
      />
      <RenameDialog
        recent={renaming}
        onClose={() => setRenaming(null)}
        onRenamed={(renamed) => {
          setRenaming(null)
          notify(`Renamed to “${renamed.name}”.`)
          void load()
        }}
      />
      <TrashDialog
        recent={trashing}
        onClose={() => setTrashing(null)}
        onTrashed={(gone) => {
          setTrashing(null)
          notify(`Moved “${gone.name}” to the Trash.`)
          void load()
        }}
      />
    </div>
  )
}

function RenameDialog({
  recent,
  onClose,
  onRenamed
}: {
  recent: RecentProject | null
  onClose: () => void
  onRenamed: (renamed: RecentProject) => void
}): ReactNode {
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  // A fresh draft each time the dialog opens on a project.
  useEffect(() => {
    if (recent) setName(recent.name)
  }, [recent])

  const trimmed = name.trim()
  const submit = async (): Promise<void> => {
    if (!recent || trimmed === '' || saving) return
    if (trimmed === recent.name) {
      onClose()
      return
    }
    setSaving(true)
    const renamed = await call(`Renaming ${recent.name}`, (api) =>
      api.project.rename(recent.filePath, trimmed)
    )
    setSaving(false)
    if (renamed) onRenamed(renamed)
  }

  return (
    <Modal
      open={recent !== null}
      title="Rename project"
      onClose={onClose}
      width={380}
      footer={
        <>
          <Button variant="subtle" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={trimmed === '' || saving} onClick={() => void submit()}>
            {saving ? 'Renaming…' : 'Rename'}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-1.5 px-4 py-3"
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <TextField
          label="Project name"
          value={name}
          autoFocus
          invalid={trimmed === ''}
          onChange={(event) => setName(event.target.value)}
          onFocus={(event) => event.currentTarget.select()}
        />
        <p className="text-[11px] leading-relaxed text-pretty text-ink-2">
          {trimmed === ''
            ? 'A project needs a name.'
            : 'The file is renamed to match, unless another project in its folder already has that name.'}
        </p>
      </form>
    </Modal>
  )
}

function TrashDialog({
  recent,
  onClose,
  onTrashed
}: {
  recent: RecentProject | null
  onClose: () => void
  onTrashed: (gone: RecentProject) => void
}): ReactNode {
  const [working, setWorking] = useState(false)
  const confirm = async (): Promise<void> => {
    if (!recent || working) return
    setWorking(true)
    // `trash` resolves to undefined; `call` returns null only when it failed (and said why).
    const done = await call(`Moving ${recent.name} to the Trash`, (api) =>
      api.project.trash(recent.filePath)
    )
    setWorking(false)
    if (done !== null) onTrashed(recent)
  }
  return (
    <Modal
      open={recent !== null}
      title={recent ? `Move “${recent.name}” to the Trash?` : 'Move to the Trash?'}
      onClose={onClose}
      width={400}
      footer={
        <>
          <Button variant="subtle" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" disabled={working} onClick={() => void confirm()}>
            {working ? 'Moving…' : 'Move to Trash'}
          </Button>
        </>
      }
    >
      <p className="px-4 py-3 text-[12px] leading-relaxed text-pretty text-ink-1">
        The project file goes to the Trash and leaves this list; its media files are not touched.
        You can restore it from the Trash in Finder.
      </p>
    </Modal>
  )
}

function CreateTile({
  busy,
  hint,
  onCreate
}: {
  busy: boolean
  hint: string
  onCreate: () => void
}): ReactNode {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onCreate}
      title={hint}
      className="group flex flex-col text-left"
    >
      <span className="t-fast grid aspect-video place-items-center rounded-lg border border-line-strong bg-surface-2 group-hover:border-line-hover group-hover:bg-surface-3">
        <Plus aria-hidden="true" className="size-6 text-ink-1 group-hover:text-ink-0" />
      </span>
      <span className="mt-2 px-0.5 text-[13px] font-semibold text-ink-0">Create new project</span>
    </button>
  )
}

interface ItemProps {
  recent: RecentProject
  when: string
  onOpen: () => void
  actions: MenuEntry[]
  onContextMenu: (event: MouseEvent) => void
}

function Poster({ recent, className }: { recent: RecentProject; className?: string }): ReactNode {
  return recent.poster ? (
    // 16:9 intrinsic size so the grid never shifts as posters decode; a 1px outline at low
    // opacity so a dark poster does not dissolve into the dark card around it.
    <img
      src={recent.poster}
      alt=""
      width={480}
      height={270}
      draggable={false}
      className={cn('object-cover outline outline-1 -outline-offset-1 outline-white/10 [:root[data-theme=light]_&]:outline-black/10', className)}
    />
  ) : (
    <span className={cn('grid place-items-center bg-surface-2', className)}>
      <Film aria-hidden="true" className="size-5 text-ink-3" />
    </span>
  )
}

function ProjectCard({ recent, when, onOpen, actions, onContextMenu }: ItemProps): ReactNode {
  return (
    <div className="group relative flex flex-col" onContextMenu={onContextMenu}>
      <button type="button" onClick={onOpen} title={recent.filePath} className="flex flex-col text-left">
        <span className="t-fast block aspect-video overflow-hidden rounded-lg border border-line bg-surface-2 group-hover:border-line-hover">
          <Poster recent={recent} className="h-full w-full" />
        </span>
        <span className="mt-2 truncate px-0.5 pr-7 text-[13px] text-ink-0">{recent.name}</span>
        <span className="px-0.5 text-[11px] text-ink-2">{when}</span>
      </button>
      <div className="absolute right-0 bottom-3">
        <ProjectMenu recent={recent} actions={actions} />
      </div>
    </div>
  )
}

function ProjectRow({ recent, when, onOpen, actions, onContextMenu }: ItemProps): ReactNode {
  return (
    <div
      className="group t-fast flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-surface-3"
      onContextMenu={onContextMenu}
    >
      <button type="button" onClick={onOpen} title={recent.filePath} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <span className="block h-9 w-16 shrink-0 overflow-hidden rounded-sm border border-line">
          <Poster recent={recent} className="h-full w-full" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] text-ink-0">{recent.name}</span>
          <span className="block truncate text-[11px] text-ink-2">
            {recent.folder ?? folderOf(recent.filePath)}
          </span>
        </span>
        <span className="shrink-0 text-[11px] text-ink-2">{when}</span>
      </button>
      <ProjectMenu recent={recent} actions={actions} />
    </div>
  )
}

/** The parent folder's name, for a row whose folder main did not describe. */
function folderOf(filePath: string): string {
  const parts = filePath.split(/[\\/]/).filter(Boolean)
  return parts.length >= 2 ? parts[parts.length - 2]! : filePath
}

/**
 * The ⋯ menu. Its rows are `actionsFor` in `ProjectsHome`, the same list a right-click opens.
 * Deleting is "Move to Trash…": the file is someone's work, so it goes where Finder can bring it
 * back, and only after a confirmation that names it — a thumbnail menu is one mis-click away.
 */
function ProjectMenu({ recent, actions }: Pick<ItemProps, 'recent' | 'actions'>): ReactNode {
  const menu = useFloatingTrigger()
  return (
    <>
      <IconButton
        {...menu.triggerProps}
        label={`More for ${recent.name}`}
        icon={<MoreVertical className="size-3.5" />}
      />
      <Menu
        {...menu.surfaceProps}
        label={`${recent.name} actions`}
        side="top"
        align="end"
        items={actions}
      />
    </>
  )
}
