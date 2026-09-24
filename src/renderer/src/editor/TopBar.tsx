import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  House,
  Monitor,
  Moon,
  PanelBottom,
  PanelLeft,
  PanelRight,
  Redo2,
  Settings,
  Sun,
  Undo2,
  Upload
} from 'lucide-react'
import { Button, IconButton, Tooltip } from '@/components'
import { cn } from '@/lib/cn'
import { shortcutOf } from '@/lib/commands'
import { bayTheme, NEXT_THEME, type ThemePreference } from '@/lib/theme'
import { useEditor } from '@/store/editor'

export interface TopBarProps {
  /** Back to the projects screen. The caller handles unsaved work. */
  onHome(): void
  onExport(): void
  onSave(): void
  saving: boolean
}

/**
 * The window's title bar. It is the drag region, so every interactive child has to opt
 * out with `.no-drag` — a button inside a drag region is not a button, it is a handle.
 *
 * The 80px of left padding is the macOS traffic lights. They are drawn by the system at a
 * fixed offset and nothing may sit under them.
 */
const THEME_ICON: Record<ThemePreference, ReactNode> = {
  dark: <Moon className="size-4" />,
  light: <Sun className="size-4" />,
  system: <Monitor className="size-4" />
}

/** Names the current state and what a click does, since the icon alone shows only the first. */
const THEME_LABEL: Record<ThemePreference, string> = {
  dark: 'Theme: dark — switch to light',
  light: 'Theme: light — switch to system',
  system: 'Theme: system — switch to dark'
}

/** A region toggle's "on" state: a neutral fill, overriding IconButton's accent `active`. */
const REGION_ON = 'aria-pressed:bg-surface-3 aria-pressed:text-ink-0 aria-pressed:hover:bg-surface-4'

export function TopBar({ onHome, onExport, onSave, saving }: TopBarProps): ReactNode {
  const name = useEditor((state) => state.project.name)
  const dirty = useEditor((state) => state.dirty)
  const canUndo = useEditor((state) => state.past.length > 0)
  const canRedo = useEditor((state) => state.future.length > 0)
  const renameProject = useEditor((state) => state.renameProject)
  const undo = useEditor((state) => state.undo)
  const redo = useEditor((state) => state.redo)
  const hidden = useEditor((state) => state.hiddenRegions)
  const toggleRegion = useEditor((state) => state.toggleRegion)

  const [theme, setTheme] = useState<ThemePreference>(() => bayTheme()?.get() ?? 'dark')
  const cycleTheme = (): void => {
    const next = NEXT_THEME[theme]
    bayTheme()?.set(next)
    setTheme(next)
  }

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(name)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editing) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [editing])

  const commit = (): void => {
    const trimmed = draft.trim()
    // An empty project name would leave the title bar blank and the export dialog with no
    // default filename, so a blank commit reverts rather than being accepted.
    if (trimmed && trimmed !== name) renameProject(trimmed)
    else setDraft(name)
    setEditing(false)
  }

  return (
    // The project name is centred on the window, not on the space left over: it is the title of
    // the window, and a title that drifts as the controls either side change width looks broken.
    <header className="drag-region relative flex h-11 shrink-0 items-center gap-3 border-b border-line bg-surface-1 pr-3 pl-[80px]">
      <IconButton
        label="All projects"
        icon={<House className="size-4" />}
        onClick={onHome}
        className="no-drag"
      />
      <span className="shrink-0 text-[13px] font-semibold tracking-tight text-ink-0 select-none">
        bay
      </span>
      <span aria-hidden="true" className="h-3 w-px shrink-0 bg-line-strong" />

      <div className="no-drag flex items-center gap-0.5">
        <IconButton
          label="Undo"
          shortcut={shortcutOf('edit.undo')}
          icon={<Undo2 className="size-4" />}
          disabled={!canUndo}
          onClick={undo}
        />
        <IconButton
          label="Redo"
          shortcut={shortcutOf('edit.redo')}
          icon={<Redo2 className="size-4" />}
          disabled={!canRedo}
          onClick={redo}
        />
      </div>

      <div className="flex-1" />
      <div className="pointer-events-none absolute inset-x-0 flex justify-center">
        <div className="pointer-events-auto">
          {editing ? (
            <input
              ref={inputRef}
              value={draft}
              aria-label="Project name"
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commit}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commit()
                if (event.key === 'Escape') {
                  setDraft(name)
                  setEditing(false)
                }
              }}
              className="no-drag h-7 w-56 rounded-sm border border-accent/70 bg-surface-2 px-2 text-[12px] text-ink-0 outline-none"
            />
          ) : (
            <button
              type="button"
              onClick={() => {
                setDraft(name)
                setEditing(true)
              }}
              title="Rename project"
              className="no-drag t-fast max-w-[40ch] truncate rounded-sm px-2 py-1 text-[13px] font-medium text-ink-0 hover:bg-surface-3"
            >
              {name}
            </button>
          )}
        </div>
      </div>


      {/* Lit while the region is showing, like a toggle in any editor's View menu — but lit
          neutrally. In the accent, all three were orange in the normal layout and outshouted
          Export, the one primary action in the bar; the accent is for state that needs noticing. */}
      <div className="no-drag flex items-center gap-0.5">
        <IconButton
          label={hidden.side ? 'Show side panel' : 'Hide side panel'}
          icon={<PanelLeft className="size-4" />}
          active={!hidden.side}
          className={REGION_ON}
          onClick={() => toggleRegion('side')}
        />
        <IconButton
          label={hidden.timeline ? 'Show timeline' : 'Hide timeline'}
          icon={<PanelBottom className="size-4" />}
          active={!hidden.timeline}
          className={REGION_ON}
          onClick={() => toggleRegion('timeline')}
        />
        <IconButton
          label={hidden.inspector ? 'Show inspector' : 'Hide inspector'}
          icon={<PanelRight className="size-4" />}
          active={!hidden.inspector}
          className={REGION_ON}
          onClick={() => toggleRegion('inspector')}
        />
      </div>
      <span aria-hidden="true" className="h-3 w-px shrink-0 bg-line-strong" />

      <IconButton
        label={THEME_LABEL[theme]}
        icon={THEME_ICON[theme]}
        onClick={cycleTheme}
        disabled={!bayTheme()}
      />
      <IconButton
        label="Settings"
        shortcut={shortcutOf('app.settings')}
        icon={<Settings className="size-4" />}
        onClick={() => useEditor.getState().setSettingsOpen(true)}
        className="no-drag"
      />

      {/* The save state is also the Save button; the tooltip is what says so. */}
      <Tooltip label="Save" shortcut={shortcutOf('file.save')}>
        <button
          type="button"
          onClick={onSave}
          disabled={saving}
          className={cn(
            'no-drag t-press rounded-sm px-2 py-1 text-[11px] tabular-nums active:scale-[0.96]',
            dirty ? 'text-ink-1 hover:bg-surface-3 hover:text-ink-0' : 'text-ink-2 hover:bg-surface-3'
          )}
        >
          {saving ? 'Saving…' : dirty ? 'Unsaved changes' : 'Saved'}
        </button>
      </Tooltip>

      <Tooltip label="Export" shortcut={shortcutOf('file.export')}>
        <Button
          variant="primary"
          size="sm"
          icon={<Upload className="size-3.5" />}
          onClick={onExport}
          className="no-drag"
        >
          Export
        </Button>
      </Tooltip>
    </header>
  )
}
