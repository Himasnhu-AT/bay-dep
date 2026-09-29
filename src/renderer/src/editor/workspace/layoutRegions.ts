/**
 * Which regions the window shows in each layout mode, and which AI drawers are open. Pure, so the
 * mapping is tested without React (`layoutRegions.test.ts`); `Workspace.tsx` and the TopBar only
 * read it. What goes *inside* a page's slots is still `pageContent.tsx`'s alone.
 */

import type { AiPanel, LayoutMode } from '@/store/editor'

export interface LayoutRegions {
  /** The programme viewer is on screen in every mode (it owns the engine; `hosted.tsx`). */
  viewer: true
  /** `dock`: the resizable panel beside the page (Resolve). `primary`: the AI layout's centre. */
  agent: 'dock' | 'primary'
  /** Resolve's page frame: library, inspector and timeline slots as `pageContent` fills them. */
  pageFrame: boolean
  /** The AI layout's own always-visible media pool. */
  mediaPool: boolean
  /** The page bar along the bottom. */
  pageBar: boolean
  /** The TopBar's Library / Inspector / Timeline / Agent toggles. */
  panelToggles: boolean
  /** The AI layout's slim toolbar (Timeline, Inspector, Pages, Export, Projects). */
  aiToolbar: boolean
  /** The AI layout's drawers. Always closed in Resolve mode, whatever the store holds. */
  drawers: { timeline: boolean; side: Exclude<AiPanel, 'timeline'> | null }
}

export function layoutRegions(mode: LayoutMode, aiPanels: Readonly<Record<AiPanel, boolean>>): LayoutRegions {
  if (mode === 'resolve') {
    return {
      viewer: true,
      agent: 'dock',
      pageFrame: true,
      mediaPool: false,
      pageBar: true,
      panelToggles: true,
      aiToolbar: false,
      drawers: { timeline: false, side: null }
    }
  }
  return {
    viewer: true,
    agent: 'primary',
    pageFrame: false,
    mediaPool: true,
    pageBar: false,
    panelToggles: false,
    aiToolbar: true,
    drawers: {
      timeline: aiPanels.timeline,
      // One right-hand drawer: the inspector wins a tie the store should never produce.
      side: aiPanels.inspector ? 'inspector' : aiPanels.pages ? 'pages' : null
    }
  }
}
