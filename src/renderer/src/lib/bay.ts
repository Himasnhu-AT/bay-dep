import type { BayApi, ImportedAsset } from '@shared/ipc'
import { useEditor } from '@/store/editor'

/**
 * `window.bay` is injected by the preload bridge. It is typed as always present, and in a
 * shipped build it is — but the renderer also runs before the bridge exists (a dev reload
 * that beats preload, a browser-only harness), and reaching straight through the global
 * turns that into a blank window with a `TypeError` in the console.
 *
 * Everything here returns null rather than throwing, and each caller decides what "the
 * main process is not answering" looks like in its own corner of the UI.
 */
export function bay(): BayApi | null {
  if (typeof window === 'undefined') return null
  return (window as Window & { bay?: BayApi }).bay ?? null
}

/**
 * Runs one call against the bridge and turns any failure into something the user can see.
 *
 * An unhandled rejection inside a React event handler is invisible — no red screen, no
 * console anyone will read, just a control that silently did nothing. Every `window.bay`
 * call in the UI goes through here, with two deliberate exceptions that fail quietly on
 * purpose: the poster/filmstrip/waveform loaders in `useMediaCache` (a missing thumbnail
 * is not worth a toast) and the ffmpeg probe in `StatusBar` (a bridge that cannot answer
 * is not the same as ffmpeg being absent, and saying so would accuse a working install).
 *
 * Returns null on failure. Note that some calls return null on success too —
 * `chooseOutputPath` does when the user cancels — which is fine everywhere it is used:
 * both mean "do not proceed", and only the failure also says why.
 */
export async function call<T>(
  describe: string,
  work: (api: BayApi) => Promise<T>
): Promise<T | null> {
  const notify = useEditor.getState().notify
  const api = bay()
  if (!api) {
    notify(`${describe} is unavailable: this window has no bridge to the app.`, 'error')
    return null
  }
  try {
    return await work(api)
  } catch (error) {
    notify(
      error instanceof Error && error.message
        ? `${describe} failed: ${error.message}`
        : `${describe} failed.`,
      'error'
    )
    return null
  }
}

/** Microseconds as `m:ss`, for media durations that are not on a timeline. */
export function formatSourceDuration(micros: number): string {
  if (!Number.isFinite(micros) || micros <= 0) return '—'
  const totalSeconds = Math.round(micros / 1_000_000)
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const pad = (n: number): string => String(n).padStart(2, '0')
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`
}

/**
 * What to tell the user after an import.
 *
 * Three call sites had their own copy of this and not one of them looked at `asset.error`,
 * so a file ffprobe could not read was announced as "Imported 1 file." The card does say
 * "Could not be read" and refuses to be placed — but the toast is the thing that claims the
 * outcome, and it was claiming the wrong one. Measured by dropping 40KB of `/dev/urandom`
 * named `.mp4`.
 *
 * A partial failure returns `error`, deliberately: a red toast that needs a moment's
 * attention is the right weight for "some of what you dropped is unusable".
 */
export function importMessage(imported: ImportedAsset[]): {
  text: string
  kind: 'info' | 'error'
} {
  const unreadable = imported.filter((entry) => entry.asset.error).length
  const reused = imported.filter((entry) => entry.reused && !entry.asset.error).length
  const added = imported.length - unreadable - reused
  const files = (n: number): string => `${n} file${n === 1 ? '' : 's'}`

  if (unreadable === imported.length) {
    return { text: `Could not read ${files(unreadable)}.`, kind: 'error' }
  }

  // "Imported 0, reused 1" is accurate and reads like a bug report. When nothing new
  // arrived, lead with what did happen instead.
  const parts: string[] = []
  if (added > 0) parts.push(`Imported ${added === imported.length ? files(added) : String(added)}`)
  // Re-importing a file the project already has is a no-op, and silently doing nothing
  // looks like a failed import. Say which it was.
  if (reused > 0) parts.push(`${parts.length === 0 ? 'Reused' : 'reused'} ${reused} already in the project`)
  if (unreadable > 0) {
    parts.push(parts.length === 0 ? `${files(unreadable)} could not be read` : `${unreadable} could not be read`)
  }
  return { text: parts.join(', ') + '.', kind: unreadable > 0 ? 'error' : 'info' }
}
