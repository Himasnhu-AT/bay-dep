/**
 * What each page shows in each of its slots. **The one file to edit when a panel is replaced.**
 *
 * Every page has the same frame (`PageLayout.tsx`):
 *
 *     ┌ rail ┬ left ───────┬ viewer (always) ──────────┬ right ───────┐
 *     │      │  (Library   │  header · picture ·       │  (Inspector  │
 *     │      │   toggle)   │  transport                │   toggle)    │
 *     │      ├─────────────┴───────────────────────────┴──────────────┤
 *     │      │ aboveTimeline                                          │
 *     │      │ timeline (Timeline toggle)             │ besideTimeline│
 *     └──────┴────────────────────────────────────────────────────────┘
 *
 * The viewer and the timeline are not listed here: there is one of each for the whole window
 * (`hosted.tsx`), and a page only says whether it shows the timeline. Everything else is a plain
 * element — swap a component by changing its line. A slot left out is simply not drawn, and its
 * TopBar toggle is disabled on that page.
 *
 * Sizes and remembered-layout ids live in `PageLayout.tsx` (`PAGE_FRAMES`), not here.
 */

import type { ReactNode } from 'react'
import type { WorkspacePage } from '@/store/editor'
import { ExportPanel } from '@/editor/ExportPanel'
import { Inspector } from '@/editor/Inspector'
import { Library } from '@/editor/library/Library'
import { MediaBrowser, MediaSourceViewer } from '@/editor/library/MediaBrowser'
import { AudioStandIn, ColorStandIn } from './placeholders'

export interface PageContent {
  /** A fixed strip at the far left, outside the resizable groups. */
  rail?: ReactNode
  /** The left panel. Shown and hidden by the TopBar's Library toggle (region `side`). */
  left?: ReactNode
  /** The right panel. Shown and hidden by the Inspector toggle (region `inspector`). */
  right?: ReactNode
  /** Whether the bottom region holds the timeline (Timeline toggle, region `timeline`). */
  timeline: boolean
  /** A strip between the stage and the timeline, inside the timeline region (a clip strip). */
  aboveTimeline?: ReactNode
  /** A panel to the right of the timeline, resizable against it (a mixer, a render queue). */
  besideTimeline?: ReactNode
}

export function pageContent(page: WorkspacePage): PageContent {
  switch (page) {
    // Resolve's Media page: a big media pool with the selected clip's details, and a large
    // source monitor beside the programme viewer (they share the pool's selection).
    case 'media':
      return {
        left: <MediaBrowser />,
        right: <MediaSourceViewer />,
        timeline: false
      }

    // The default page: the library's tabs (Media Pool, Effects, Index, Transcript) replace the
    // old icon rail; the agent is the dock and export is the Deliver page.
    case 'edit':
      return {
        left: <Library />,
        right: <Inspector />,
        timeline: true
      }

    // WP5: `left: <ClipStrip />` or `aboveTimeline: <ClipStrip />`, `right: <ColorPanel />`.
    case 'color':
      return {
        right: <ColorStandIn />,
        timeline: true
      }

    // WP5: `right: <AudioPanel />`, `besideTimeline: <Mixer />`.
    case 'audio':
      return {
        right: <AudioStandIn />,
        timeline: true
      }

    // WP5: `left: <DeliverSettings />`, `right: <RenderQueue />`.
    case 'deliver':
      return {
        left: <ExportPanel />,
        timeline: true
      }
  }
}
