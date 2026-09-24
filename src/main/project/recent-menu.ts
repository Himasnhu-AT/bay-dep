/**
 * Which recents File › Open Recent lists. No Electron here, so it is tested directly; the store
 * reads and writes the hidden list, `menu.ts` lays the entries out.
 *
 * **Clear Menu hides, it does not forget.** The recents index is also the projects screen's list
 * and the gate for renaming and binning a project (`refuseUnlisted`). A menu command called
 * "Clear Menu" that emptied the projects screen would be a destructive surprise, so clearing
 * records the paths it cleared, and the menu leaves them out until the project is opened, saved
 * or created again, when it is back, as a Mac app's recents are.
 */

import type { RecentProject } from '@shared/ipc'

/**
 * The app-database key holding the cleared paths, as a JSON array. A persisted key, read by
 * later builds: `recent-menu.test.ts` pins the literal.
 */
export const RECENT_MENU_HIDDEN_KEY = 'recentMenuHidden'

/** As many as a Mac app's Open Recent shows by default. */
export const RECENT_MENU_LIMIT = 10

/** The stored hidden list. Anything that is not an array of strings reads as nothing hidden. */
export function parseHidden(raw: string | null): string[] {
  if (!raw) return []
  try {
    const value: unknown = JSON.parse(raw)
    return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []
  } catch {
    return []
  }
}

/** The recents the menu shows: newest first as given, cleared ones left out, at most the limit. */
export function menuRecents(rows: readonly RecentProject[], hidden: readonly string[]): RecentProject[] {
  const cleared = new Set(hidden)
  return rows.filter((row) => !cleared.has(row.filePath)).slice(0, RECENT_MENU_LIMIT)
}

/** The hidden list once `filePath` is opened or saved again, or null when it was not hidden. */
export function unhide(hidden: readonly string[], filePath: string): string[] | null {
  return hidden.includes(filePath) ? hidden.filter((entry) => entry !== filePath) : null
}
