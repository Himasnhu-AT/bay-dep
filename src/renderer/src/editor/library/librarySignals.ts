/**
 * What the libraries share with each other and with whatever mounts them, without a store field.
 *
 * The project format and the editor store are not this package's to change, and none of this is
 * project state: which asset the source viewer shows, and "open the URL import" or "show the
 * subtitles" requests aimed at a surface that may not be mounted yet. A small store of its own
 * keeps the Media page's pool and its big source viewer (two components the workspace places
 * apart) looking at the same asset, and the Edit page's pool with them.
 */

import { create } from 'zustand'

interface MediaSelection {
  /** The asset the source viewer shows, or null for none. */
  assetId: string | null
  /** Bumped when a click opens an asset, so the source viewer takes focus and I/O mark the source. */
  focusToken: number
  /** Where in the source an opening asked the viewer to start (a search hit), in microseconds. */
  atUs: number
  select(assetId: string | null, open?: boolean, atUs?: number): void
}

export const useMediaSelection = create<MediaSelection>((set) => ({
  assetId: null,
  focusToken: 0,
  atUs: 0,
  select: (assetId, open = false, atUs = 0) =>
    set((state) => ({ assetId, atUs, focusToken: open && assetId ? state.focusToken + 1 : state.focusToken }))
}))

/** Opens `assetId` in the source viewer (wherever one is mounted) at `atUs`, and gives it focus. */
export function openInSource(assetId: string, atUs = 0): void {
  useMediaSelection.getState().select(assetId, true, atUs)
}

// -- requests aimed at a surface that may not be mounted yet ----------------------------------

export type LibraryRequest = 'import-url' | 'subtitles'

const REQUEST_EVENT = 'bay:library-request'
const pending = new Set<LibraryRequest>()

/**
 * Asks for `request` to be shown: the Import URL form, or the Transcript tab's Subtitles view.
 * Held until a surface that can show it takes it — the tab it lives on may mount only after the
 * switch this request came with.
 */
export function requestLibrary(request: LibraryRequest): void {
  pending.add(request)
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent(REQUEST_EVENT, { detail: request }))
}

/** True once for a pending `request`; the caller then shows it. */
export function takeLibraryRequest(request: LibraryRequest): boolean {
  return pending.delete(request)
}

/** Calls `listener` for each new request (and never for one already taken). */
export function onLibraryRequest(listener: (request: LibraryRequest) => void): () => void {
  const handle = (event: Event): void => listener((event as CustomEvent<LibraryRequest>).detail)
  window.addEventListener(REQUEST_EVENT, handle)
  return () => window.removeEventListener(REQUEST_EVENT, handle)
}
