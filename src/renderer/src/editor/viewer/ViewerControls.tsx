import type { ReactNode } from 'react'
import { Crop, Grid3x3, Maximize } from 'lucide-react'
import { IconButton, Menu, Select, useFloatingTrigger } from '@/components'
import { runCommand, shortcutOf } from '@/lib/commands'
import { useViewer, VIEWER_ZOOMS, type ViewerZoom } from '@/lib/viewer'

/**
 * The viewer's own controls in the transport: zoom, the Viewer options menu, crop, full screen.
 *
 * Everything goes through the command registry, so the menu here, the View menu in the menu bar
 * and the shortcut are one action each and cannot disagree about what "safe areas" toggles.
 *
 * The options menu always lists Crop and Full-screen as well as the guides: in a narrow transport
 * their buttons are hidden (Transport.tsx has the order things go in), and the menu is where they
 * are then. Listing them always, rather than only while hidden, keeps the menu one fixed list.
 */
export function ViewerControls(): ReactNode {
  const zoom = useViewer((state) => state.zoom)
  const setZoom = useViewer((state) => state.setZoom)
  const safeAreas = useViewer((state) => state.safeAreas)
  const grid = useViewer((state) => state.grid)
  const cropMode = useViewer((state) => state.cropMode)
  const overlays = useFloatingTrigger()
  const anyOverlay = safeAreas || grid

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      <Select<ViewerZoom>
        label="Viewer zoom"
        value={zoom}
        options={VIEWER_ZOOMS.map((option) => ({ value: option.value, label: option.label }))}
        onChange={setZoom}
        className="w-[68px]"
      />
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
      <IconButton
        label="Crop in viewer (drag edges, ⇧ both sides)"
        shortcut={shortcutOf('view.cropMode')}
        tooltipSide="top"
        active={cropMode}
        className="hidden @2xl:inline-flex"
        icon={<Crop className="size-3.5" />}
        onClick={() => runCommand('view.cropMode')}
      />
      <IconButton
        label="Full-screen preview"
        shortcut={shortcutOf('view.fullscreenPreview')}
        tooltipSide="top"
        className="hidden @2xl:inline-flex"
        icon={<Maximize className="size-3.5" />}
        onClick={() => runCommand('view.fullscreenPreview')}
      />
    </div>
  )
}
