import type { ReactNode } from 'react'
import { AudioLines, Film, House, Images, Palette, Rocket, Settings2 } from 'lucide-react'
import { IconButton, Tooltip } from '@/components'
import { cn } from '@/lib/cn'
import { runCommand, shortcutOf, type CommandId } from '@/lib/commands'
import { useEditor, WORKSPACE_PAGES, type WorkspacePage } from '@/store/editor'

const PAGES: Record<WorkspacePage, { label: string; icon: ReactNode; command: CommandId; detail: string }> = {
  media: {
    label: 'Media',
    icon: <Images className="size-[18px]" />,
    command: 'workspace.media',
    detail: 'Import, browse and preview footage'
  },
  edit: {
    label: 'Edit',
    icon: <Film className="size-[18px]" />,
    command: 'workspace.edit',
    detail: 'Cut the timeline'
  },
  color: {
    label: 'Color',
    icon: <Palette className="size-[18px]" />,
    command: 'workspace.color',
    detail: 'Grade and adjust clips'
  },
  audio: {
    label: 'Audio',
    icon: <AudioLines className="size-[18px]" />,
    command: 'workspace.audio',
    detail: 'Levels, meters and the mix'
  },
  deliver: {
    label: 'Deliver',
    icon: <Rocket className="size-[18px]" />,
    command: 'workspace.deliver',
    detail: 'Export the finished video'
  }
}

/**
 * The page bar along the bottom of the window, as in DaVinci Resolve: one button per page in
 * workflow order, icon above label, the current page in the accent. The pages are layouts over
 * the same project — switching never saves, loads or loses anything. At the right, the two
 * things Resolve keeps there: Projects (home) and Project Settings.
 */
export function PageBar({ onHome }: { onHome(): void }): ReactNode {
  const page = useEditor((state) => state.page)
  const setPage = useEditor((state) => state.setPage)

  return (
    <nav
      aria-label="Pages"
      className="relative flex h-11 shrink-0 items-center border-t border-line bg-chrome px-3"
    >
      <div className="absolute inset-y-0 left-1/2 flex -translate-x-1/2 items-stretch gap-1">
        {WORKSPACE_PAGES.map((id) => {
          const spec = PAGES[id]
          const active = page === id
          return (
            <Tooltip key={id} side="top" label={`${spec.label} page`} shortcut={shortcutOf(spec.command)} detail={spec.detail}>
              <button
                type="button"
                aria-current={active ? 'page' : undefined}
                aria-label={`${spec.label} page`}
                onClick={() => setPage(id)}
                className={cn(
                  't-fast relative flex w-16 flex-col items-center justify-center gap-0.5 rounded-sm text-[10px] font-medium',
                  active ? 'text-accent' : 'text-ink-2 hover:bg-surface-3 hover:text-ink-0'
                )}
              >
                {active && (
                  <span aria-hidden="true" className="absolute inset-x-3 top-0 h-0.5 rounded-b-full bg-accent" />
                )}
                {spec.icon}
                <span className="leading-none">{spec.label}</span>
              </button>
            </Tooltip>
          )
        })}
      </div>

      <div className="ml-auto flex items-center gap-0.5">
        <IconButton
          label="All projects"
          tooltipSide="top"
          icon={<House className="size-4" />}
          onClick={onHome}
        />
        <IconButton
          label="Project Settings"
          tooltipSide="top"
          icon={<Settings2 className="size-4" />}
          onClick={() => runCommand('file.projectSettings')}
        />
      </div>
    </nav>
  )
}
