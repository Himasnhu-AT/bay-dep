import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import {
  ArrowDownAZ,
  Clock,
  Film,
  FolderOpen,
  LayoutGrid,
  List,
  MoreVertical,
  Plus,
  Search,
  Settings,
  X
} from 'lucide-react'
import type { Project } from '@shared/project'
import type { RecentProject } from '@shared/ipc'
import { IconButton, Toast } from '@/components'
import { call } from '@/lib/bay'
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
export function relativeTime(then: number, now: number): string {
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
  const enterProject = useEditor((state) => state.enterProject)
  const notify = useEditor((state) => state.notify)

  const [recents, setRecents] = useState<RecentProject[] | null>(null)
  const [query, setQuery] = useState('')
  const [view, setView] = useState<View>(() => remembered(VIEW_KEY, ['grid', 'list'], 'grid'))
  const [sort, setSort] = useState<Sort>(() => remembered(SORT_KEY, ['recent', 'name'], 'recent'))
  const [busy, setBusy] = useState(false)

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

  return (
    <div className="flex h-full w-full flex-col bg-surface-0 text-ink-0">
      {/* The window's drag strip — traffic lights live here and the window must stay movable. */}
      <div className="drag-region h-11 shrink-0" />

      <div className="flex min-h-0 flex-1 justify-center px-8 pb-8">
        <section className="flex min-h-0 w-full max-w-[1200px] flex-col overflow-hidden rounded-xl border border-line bg-surface-1">
          <header className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-3">
            <label className="flex h-8 w-72 items-center gap-2 rounded-md border border-line-strong bg-surface-2 px-2.5 focus-within:border-line-hover">
              <Search aria-hidden="true" className="size-3.5 text-ink-2" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setQuery('')
                }}
                placeholder="Search projects…"
                aria-label="Search projects"
                className="w-full bg-transparent text-[12px] text-ink-0 outline-none placeholder:text-ink-2"
              />
              {/* A filter that stays applied with no visible way out reads as "my projects are
                  gone" — so a non-empty search always shows how to clear it. */}
              {query && (
                <button
                  type="button"
                  aria-label="Clear search"
                  onClick={() => setQuery('')}
                  className="t-fast grid size-5 shrink-0 place-items-center rounded-sm text-ink-2 hover:bg-surface-3 hover:text-ink-0"
                >
                  <X aria-hidden="true" className="size-3" />
                </button>
              )}
            </label>
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
              shortcut="⌘,"
              icon={<Settings className="size-3.5" />}
              onClick={() => useEditor.getState().setSettingsOpen(true)}
            />
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {view === 'grid' ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-x-4 gap-y-5">
                <CreateTile busy={busy} onCreate={() => void open(() => call('Create project', (api) => api.project.create()))} />
                {shown.map((recent) => (
                  <ProjectCard
                    key={recent.filePath}
                    recent={recent}
                    when={relativeTime(recent.updatedAt, now)}
                    onOpen={() => void openRecent(recent)}
                    onChanged={() => void load()}
                    notify={notify}
                  />
                ))}
              </div>
            ) : (
              <div className="flex flex-col">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void open(() => call('Create project', (api) => api.project.create()))}
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
                    onChanged={() => void load()}
                    notify={notify}
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
        <Toast />
      </div>
    </div>
  )
}

function CreateTile({ busy, onCreate }: { busy: boolean; onCreate: () => void }): ReactNode {
  return (
    <button type="button" disabled={busy} onClick={onCreate} className="group flex flex-col text-left">
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
  onChanged: () => void
  notify: (text: string, kind?: 'info' | 'error') => void
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

function ProjectCard({ recent, when, onOpen, onChanged, notify }: ItemProps): ReactNode {
  return (
    <div className="group relative flex flex-col">
      <button type="button" onClick={onOpen} title={recent.filePath} className="flex flex-col text-left">
        <span className="t-fast block aspect-video overflow-hidden rounded-lg border border-line bg-surface-2 group-hover:border-line-hover">
          <Poster recent={recent} className="h-full w-full" />
        </span>
        <span className="mt-2 truncate px-0.5 pr-7 text-[13px] text-ink-0">{recent.name}</span>
        <span className="px-0.5 text-[11px] text-ink-2">{when}</span>
      </button>
      <div className="absolute right-0 bottom-3">
        <ProjectMenu recent={recent} onChanged={onChanged} notify={notify} />
      </div>
    </div>
  )
}

function ProjectRow({ recent, when, onOpen, onChanged, notify }: ItemProps): ReactNode {
  return (
    <div className="group t-fast flex items-center gap-3 rounded-md px-2 py-1.5 hover:bg-surface-3">
      <button type="button" onClick={onOpen} title={recent.filePath} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <span className="block h-9 w-16 shrink-0 overflow-hidden rounded-sm border border-line">
          <Poster recent={recent} className="h-full w-full" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] text-ink-0">{recent.name}</span>
          <span className="block truncate text-[11px] text-ink-2">{recent.filePath}</span>
        </span>
        <span className="shrink-0 text-[11px] text-ink-2">{when}</span>
      </button>
      <ProjectMenu recent={recent} onChanged={onChanged} notify={notify} />
    </div>
  )
}

/**
 * Remove from the list, or show the file. Deliberately no "delete": a project is a file the user
 * owns, and deleting it from a thumbnail menu is one mis-click from losing an edit.
 */
function ProjectMenu({
  recent,
  onChanged,
  notify
}: Pick<ItemProps, 'recent' | 'onChanged' | 'notify'>): ReactNode {
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent): void => {
      if (!root.current?.contains(event.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])

  return (
    <div ref={root} className="relative">
      <IconButton
        label={`More for ${recent.name}`}
        icon={<MoreVertical className="size-3.5" />}
        onClick={() => setOpen((value) => !value)}
      />
      {open && (
        <div
          role="menu"
          className="absolute right-0 bottom-full z-20 mb-1 w-44 overflow-hidden rounded-md border border-line-strong bg-surface-2 py-1 shadow-pop"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              void call('Show in Finder', (api) => api.project.reveal(recent.filePath))
            }}
            className="block w-full px-3 py-1.5 text-left text-[12px] text-ink-1 hover:bg-surface-3 hover:text-ink-0"
          >
            Show in Finder
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              void call('Remove from list', (api) => api.project.forget(recent.filePath)).then(() => {
                notify(`Removed ${recent.name} from the list. The file is still on disk.`)
                onChanged()
              })
            }}
            className="block w-full px-3 py-1.5 text-left text-[12px] text-ink-1 hover:bg-surface-3 hover:text-ink-0"
          >
            Remove from list
          </button>
        </div>
      )}
    </div>
  )
}
