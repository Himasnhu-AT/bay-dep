import type { ReactNode } from 'react'
import { Crop, Grid3x3, Maximize } from 'lucide-react'
import { IconButton, Menu, useFloatingTrigger } from '@/components'
import { runCommand, shortcutOf } from '@/lib/commands'
import { useViewer } from '@/lib/viewer'

/**
 * The viewer's own controls in the transport: the Viewer options menu, crop, full screen. The
 * viewer's zoom is in its header strip (`workspace/ViewerRegion`), as in Resolve.
 *
 * Everything goes through the command registry, so the menu here, the View menu in the menu bar
 * and the shortcut are one action each and cannot disagree about what "safe areas" toggles.
 *
 * The options menu always lists Crop and Full-screen as well as the guides: in a narrow transport
 * their buttons are hidden (`roomy` false; Transport.tsx has the order things go in), and the menu
 * is where they are then. Listing them always keeps the menu one fixed list.
 */
export function ViewerControls({ roomy = true }: { roomy?: boolean }): ReactNode {
  const safeAreas = useViewer((state) => state.safeAreas)
  const grid = useViewer((state) => state.grid)
  const cropMode = useViewer((state) => state.cropMode)
  const overlays = useFloatingTrigger()
  const anyOverlay = safeAreas || grid

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <IconButton
        {...overlays.triggerProps}
        label="Viewer options"
        tooltipSide="top"
        active={anyOverlay}
        icon={<Grid3x3 className="size-3.5" />}
      />
      <Menu
        {...overlays.surfaceProps}
        label="Viewer options"
        side="top"
        items={[
          {
            label: 'Safe Areas',
            checked: safeAreas,
            shortcut: shortcutOf('view.safeAreas'),
            onSelect: () => runCommand('view.safeAreas')
          },
          { label: 'Thirds Grid', checked: grid, onSelect: () => runCommand('view.grid') },
          { kind: 'separator' },
          {
            label: 'Crop in Viewer',
            checked: cropMode,
            shortcut: shortcutOf('view.cropMode'),
            onSelect: () => runCommand('view.cropMode')
          },
          {
            label: 'Full-Screen Preview',
            shortcut: shortcutOf('view.fullscreenPreview'),
            onSelect: () => runCommand('view.fullscreenPreview')
          }
        ]}
      />
      {roomy && (
        <>
          <IconButton
            label="Crop in viewer (drag edges, ⇧ both sides)"
            shortcut={shortcutOf('view.cropMode')}
            tooltipSide="top"
            active={cropMode}
            icon={<Crop className="size-3.5" />}
            onClick={() => runCommand('view.cropMode')}
          />
          <IconButton
            label="Full-screen preview"
            shortcut={shortcutOf('view.fullscreenPreview')}
            tooltipSide="top"
            icon={<Maximize className="size-3.5" />}
            onClick={() => runCommand('view.fullscreenPreview')}
          />
        </>
      )}
    </div>
  )
}
