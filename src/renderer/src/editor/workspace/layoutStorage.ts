import type { LayoutStorage } from 'react-resizable-panels'

/**
 * Where a panel layout the user dragged into is remembered. `localStorage`, wrapped so that a
 * profile where storage throws (private mode, a locked-down profile) falls back to the defaults
 * instead of taking the editor down: a remembered layout is a convenience, never a requirement.
 */
export const layoutStorage: LayoutStorage = {
  getItem(key: string): string | null {
    try {
      return localStorage.getItem(key)
    } catch {
      return null
    }
  },
  setItem(key: string, value: string): void {
    try {
      localStorage.setItem(key, value)
    } catch {
      // Not remembered this time; the layout still works.
    }
  }
}
