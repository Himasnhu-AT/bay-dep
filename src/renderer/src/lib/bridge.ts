import type { BayApi } from '@shared/ipc'

/**
 * `window.bay` is injected by the preload bridge. It is typed as always present, and in a
 * shipped build it is — but the renderer also runs before the bridge exists (a dev reload
 * that beats preload, a browser-only harness), and reaching straight through the global
 * turns that into a blank window with a `TypeError` in the console.
 *
 * Everything here returns null rather than throwing, and each caller decides what "the
 * main process is not answering" looks like in its own corner of the UI.
 *
 * It is its own module, apart from `call` in `./bay`, because it needs nothing but the global:
 * the engine reaches main through it, and `engine/` must not import the store that `call`
 * notifies through (`src/shared/boundaries.test.ts`).
 */
export function bay(): BayApi | null {
  if (typeof window === 'undefined') return null
  return (window as Window & { bay?: BayApi }).bay ?? null
}
