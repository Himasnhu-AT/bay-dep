/**
 * The React side of the theme. The logic itself — the storage key, how `system` resolves,
 * following the OS live — lives in `public/theme.js`, because it has to run before first
 * paint and so cannot be part of the bundle. This file only types the handle it leaves on
 * `window` and names the order the top-bar control cycles through.
 */
export type ThemePreference = 'dark' | 'light' | 'system'

interface BayTheme {
  get(): ThemePreference
  set(preference: ThemePreference): void
}

/** Returns null when the pre-paint script did not run — say, a harness that skips index.html. */
export function bayTheme(): BayTheme | null {
  return (window as Window & { bayTheme?: BayTheme }).bayTheme ?? null
}

export const NEXT_THEME: Record<ThemePreference, ThemePreference> = {
  dark: 'light',
  light: 'system',
  system: 'dark'
}
