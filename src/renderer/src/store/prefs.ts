/**
 * Per-machine preferences in localStorage. A key read back by a later build is a compatibility
 * surface (CLAUDE.md): rename one and every existing user loses that setting on upgrade.
 */

/** A remembered preference, or null when storage is empty or throws (private mode, a probe). */
export function remembered(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null
  } catch {
    return null
  }
}

/** Remember a preference; a null clears it. It still applies this session if storage throws. */
export function remember(key: string, value: string | null): void {
  try {
    if (value === null) globalThis.localStorage?.removeItem(key)
    else globalThis.localStorage?.setItem(key, value)
  } catch {
    // Not remembered; still applied.
  }
}
