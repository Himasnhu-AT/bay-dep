import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  Bot,
  Check,
  LoaderCircle,
  PanelBottom,
  PanelLeft,
  PanelRight,
  Redo2,
  Save,
  Settings,
  Undo2,
  Upload
} from 'lucide-react'
import { Badge, BayMark, Button, IconButton, SegmentedControl, Tooltip, ToolButton } from '@/components'
import { HOST_LABEL, hostOf } from '@shared/host'
import { cn } from '@/lib/cn'
import { runCommand, shortcutOf } from '@/lib/commands'
import { useElementSize } from '@/lib/useElementSize'
import { useEditor, type LayoutMode, type RegionId } from '@/store/editor'
import { HistoryMenu } from './HistoryMenu'

export interface TopBarProps {
  /** Export the timeline now (the quick export dialog). */
  onExport(): void
  saving: boolean
  /** Which regions the current page has; a toggle for one it lacks is greyed, not hidden. */
  regions: Record<RegionId, boolean>
  /** Whether the Library / Inspector / Timeline / Agent toggles apply (Resolve mode). */
  panelToggles: boolean
}

const LAYOUT_OPTIONS: { value: LayoutMode; label: string }[] = [
  { value: 'resolve', label: 'Resolve' },
  { value: 'ai', label: 'AI' }
]

/**
 * Resolve's pages or the agent-first layout. A radio group, so it reads as one choice; the
 * command (and its shortcut) is in the tooltip.
 */
function LayoutSwitch(): ReactNode {
  const mode = useEditor((state) => state.layoutMode)
  const setLayoutMode = useEditor((state) => state.setLayoutMode)
  return (
    <Tooltip label="Layout" detail="Resolve's pages, or the agent with the viewer and media pool" shortcut={shortcutOf('workspace.toggleLayoutMode')}>
      <span className="no-drag inline-flex">
        <SegmentedControl<LayoutMode> label="Layout" value={mode} options={LAYOUT_OPTIONS} onChange={setLayoutMode} className="h-6" />
      </span>
    </Tooltip>
  )
}

/**
 * The window's title bar, laid out like Resolve's interface toolbar: the mark, then the panel
 * toggles with their names, the project name centred with its save state, and the actions that
 * apply everywhere at the right.
 *
 * It is the drag region, so every interactive child has to opt out with `.no-drag` — a button
 * inside a drag region is not a button, it is a handle. The 80px of left padding is the macOS
 * traffic lights, drawn by the system at a fixed offset; nothing may sit under them.
 *
 * When the window narrows, the "bay" wordmark goes first (the mark stays), then the toggle labels
 * (the icons stay, each keeping its name as its tooltip and accessible name). Measured with a
 * short project name: labelled toggles and the wordmark need 370px of the left column, 337px
 * without the wordmark, and a 1024px window gives the column 349px.
 */

/** A panel toggle's "on" state: a neutral fill. The accent is for state that needs noticing. */
const REGION_ON = 'aria-pressed:bg-surface-3 aria-pressed:text-ink-0 aria-pressed:hover:bg-surface-4'

function ProjectName(): ReactNode {
  const name = useEditor((state) => state.project.name)
  const renameProject = useEditor((state) => state.renameProject)
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

  return editing ? (
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
    <Tooltip label="Rename project">
      <button
        type="button"
        onClick={() => {
          setDraft(name)
          setEditing(true)
        }}
        className="no-drag t-fast min-w-0 truncate rounded-sm px-2 py-1 text-[13px] font-medium text-ink-0 hover:bg-surface-3"
      >
        {name}
      </button>
    </Tooltip>
  )
}

/**
 * Save as a button that shows its own state: "Save" while there is something to save, "Saved"
 * (greyed, with a tick) when there is not. It was a status line before, and ⌘S was the only
 * way to act on it.
 */
function SaveButton({ saving }: { saving: boolean }): ReactNode {
  const dirty = useEditor((state) => state.dirty)
  const label = saving ? 'Saving…' : dirty ? 'Save' : 'Saved'
  return (
    <Tooltip
      label={saving ? 'Saving' : dirty ? 'Save changes' : 'Everything is saved'}
      detail={dirty && !saving ? 'This project has changes that are not saved yet.' : undefined}
      shortcut={shortcutOf('file.save')}
    >
      <button
        type="button"
        aria-label={saving ? 'Saving' : dirty ? 'Save — unsaved changes' : 'Saved'}
        disabled={saving}
        onClick={() => runCommand('file.save')}
        className={cn(
          'no-drag t-press inline-flex h-6 w-[76px] shrink-0 items-center justify-center gap-1 rounded-sm border text-[11px] font-medium',
          dirty
            ? 'border-accent/50 bg-accent/12 text-ink-0 hover:bg-accent/20'
            : 'border-line bg-transparent text-ink-2 hover:bg-surface-3 hover:text-ink-1'
        )}
      >
        {saving ? (
          <LoaderCircle aria-hidden="true" className="size-3 animate-spin" />
        ) : dirty ? (
          <Save aria-hidden="true" className="size-3" />
        ) : (
          <Check aria-hidden="true" className="size-3" />
        )}
        <span>{label}</span>
      </button>
    </Tooltip>
  )
}

/** Widths of the bar's content box (the window less the 92px of padding) that each keeps. */
const WORDMARK_FROM = 980
const LABELS_FROM = 930

export function TopBar({ onExport, saving, regions, panelToggles }: TopBarProps): ReactNode {
  const canUndo = useEditor((state) => state.past.length > 0)
  const canRedo = useEditor((state) => state.future.length > 0)
  const undo = useEditor((state) => state.undo)
  const redo = useEditor((state) => state.redo)
  const hidden = useEditor((state) => state.hiddenRegions)
  const toggleRegion = useEditor((state) => state.toggleRegion)
  const agentDocked = useEditor((state) => state.agentDocked)
  const setAgentDocked = useEditor((state) => state.setAgentDocked)
  // Says where this project is edited, beside its name, when that is not here.
  const inResolve = useEditor((state) => hostOf(state.project)) === 'resolve'

  const barRef = useRef<HTMLElement>(null)
  const { width } = useElementSize(barRef)
  // 0 before the first measurement: show labels, which is right for any window bay opens at.
  const labels = width === 0 || width >= LABELS_FROM
  const wordmark = width === 0 || width >= WORDMARK_FROM

  const region = (id: RegionId, name: string, icon: ReactNode, command: 'workspace.toggleLibrary' | 'workspace.toggleInspector' | 'workspace.toggleTimeline'): ReactNode => (
    <ToolButton
      label={name}
      showLabel={labels}
      shortcut={shortcutOf(command)}
      icon={icon}
      active={regions[id] && !hidden[id]}
      disabled={!regions[id]}
      className={REGION_ON}
      onClick={() => toggleRegion(id)}
    />
  )

  return (
    // Three columns, the middle one centred on the window: the project name is the window's
    // title, and a title that drifts as the controls either side change width looks broken.
    <header
      ref={barRef}
      className="drag-region grid h-11 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 border-b border-line bg-chrome pr-3 pl-[80px]"
    >
      <div className="flex min-w-0 items-center gap-2">
        <div className="flex shrink-0 items-center gap-1.5 select-none">
          <BayMark size={18} />
          {wordmark && <span className="text-[14px] font-semibold tracking-tight text-ink-0">bay</span>}
        </div>
        <span aria-hidden="true" className="h-4 w-px shrink-0 bg-line-strong" />
        {panelToggles && (
        <div role="group" aria-label="Panels" className="no-drag flex min-w-0 items-center gap-0.5">
          {region('side', 'Library', <PanelLeft className="size-4" />, 'workspace.toggleLibrary')}
          {region('inspector', 'Inspector', <PanelRight className="size-4" />, 'workspace.toggleInspector')}
          {region('timeline', 'Timeline', <PanelBottom className="size-4" />, 'workspace.toggleTimeline')}
          <ToolButton
            label="Agent"
            showLabel={labels}
            shortcut={shortcutOf('workspace.toggleAgent')}
            icon={<Bot className="size-4" />}
            active={agentDocked}
            className={REGION_ON}
            onClick={() => setAgentDocked(!agentDocked)}
          />
        </div>
        )}
      </div>

      <div className="flex min-w-0 max-w-[36vw] items-center gap-2">
        <ProjectName />
        {inResolve && (
          <Badge tone="accent" className="no-drag">
            <span data-project-host="resolve">{HOST_LABEL.resolve}</span>
          </Badge>
        )}
        <SaveButton saving={saving} />
      </div>

      <div className="no-drag flex min-w-0 items-center justify-end gap-0.5">
        {/* The layout switch chooses between bay's two layouts of its own timeline (one of them
            named after Resolve's pages); a project edited in Resolve has neither. */}
        {!inResolve && (
          <>
            <LayoutSwitch />
            <span aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-line-strong" />
          </>
        )}
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
        <HistoryMenu />
        <span aria-hidden="true" className="mx-1 h-4 w-px shrink-0 bg-line-strong" />
        {/* Named "Settings", as its dialog is; Resolve calls the same thing Preferences. */}
        <ToolButton
          label="Settings"
          showLabel={labels}
          shortcut={shortcutOf('app.settings')}
          icon={<Settings className="size-4" />}
          onClick={() => useEditor.getState().setSettingsOpen(true)}
        />
        <Tooltip label="Export" detail="Render the timeline to a file" shortcut={shortcutOf('file.export')}>
          <Button
            variant="primary"
            size="sm"
            icon={<Upload className="size-3.5" />}
            onClick={onExport}
            className="no-drag ml-1.5"
          >
            Export
          </Button>
        </Tooltip>
      </div>
    </header>
  )
}
