import type { ReactNode } from 'react'
import { Grid3x3, Maximize } from 'lucide-react'
import { IconButton, Menu, Select, useFloatingTrigger } from '@/components'
import { runCommand, shortcutOf } from '@/lib/commands'
import { useViewer, VIEWER_ZOOMS, type ViewerZoom } from '@/lib/viewer'

/**
 * The viewer's own controls in the transport: zoom, the overlays menu, full screen.
 *
 * The overlays go through the command registry, so the menu here, the View menu in the menu bar
 * and the shortcut are one action each and cannot disagree about what "safe areas" toggles.
 */
export function ViewerControls(): ReactNode {
  const zoom = useViewer((state) => state.zoom)
  const setZoom = useViewer((state) => state.setZoom)
  const safeAreas = useViewer((state) => state.safeAreas)
  const grid = useViewer((state) => state.grid)
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
        label="Viewer overlays"
        tooltipSide="top"
        active={anyOverlay}
        icon={<Grid3x3 className="size-3.5" />}
      />
      <Menu
        {...overlays.surfaceProps}
        label="Viewer overlays"
        side="top"
        items={[
          {
            label: 'Safe Areas',
            checked: safeAreas,
            shortcut: shortcutOf('view.safeAreas'),
            onSelect: () => runCommand('view.safeAreas')
          },
          { label: 'Thirds Grid', checked: grid, onSelect: () => runCommand('view.grid') }
        ]}
      />
      <IconButton
        label="Full-screen preview"
        shortcut={shortcutOf('view.fullscreenPreview')}
        tooltipSide="top"
        icon={<Maximize className="size-3.5" />}
        onClick={() => runCommand('view.fullscreenPreview')}
      />
    </div>
  )
}
