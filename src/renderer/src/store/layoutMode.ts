/**
 * The layout mode's persisted form and the rules for the AI layout's on-demand panels. Pure, so
 * the store, the workspace and the tests share one reading of both.
 *
 * `bay.workspace.layoutMode` is read back by later builds, so its key and its two values are a
 * compatibility surface (CLAUDE.md): `layout-mode.test.ts` spells them out as literals.
 */

import type { AiPanel, LayoutMode } from './types'

export const LAYOUT_MODE_KEY = 'bay.workspace.layoutMode'

/**
 * The mode for anyone who has never chosen one. **To make AI the default, change this line.**
 * It applies to every machine with no stored choice — new users, and existing users who never
 * touched the switch (the key is written only when someone switches). To move only new users,
 * a launch would first have to write `'resolve'` for profiles that already have other `bay.*`
 * keys; nothing does that today.
 */
export const DEFAULT_LAYOUT_MODE: LayoutMode = 'resolve'

/** The stored value as a mode: anything but the two literal spellings is the default. */
export function layoutModeFrom(stored: string | null | undefined): LayoutMode {
  return stored === 'ai' || stored === 'resolve' ? stored : DEFAULT_LAYOUT_MODE
}

export const NO_AI_PANELS: Readonly<Record<AiPanel, boolean>> = { timeline: false, inspector: false, pages: false }

/** The panels after opening or closing one: `inspector` and `pages` share one drawer. */
export function withAiPanel(
  current: Readonly<Record<AiPanel, boolean>>,
  panel: AiPanel,
  open: boolean
): Record<AiPanel, boolean> {
  const next = { ...current, [panel]: open }
  if (open && panel === 'inspector') next.pages = false
  if (open && panel === 'pages') next.inspector = false
  return next
}
