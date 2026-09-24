/**
 * Run some work against the live store and put everything back afterwards.
 *
 * This is what `validateOnly` on an MCP write tool stands on: the tool runs for real — the same
 * handler, the same store actions, the same refusals — and only its *answer* survives. Running
 * the real handler rather than a simulation is the point. A second, predictive implementation
 * of "what would edit_item do" would be exactly the duplicated mapping this codebase keeps
 * paying for: it would agree with the real one until the day it did not, and a dry run that
 * disagrees with the real call is a confident lie.
 *
 * What is restored is every data field of the store — the project, `past`, `future`, `dirty`,
 * the selection and the playhead among them — rather than a hand-picked list. A handler that
 * selects the items it splits, or a transaction that clears the redo stack, would otherwise
 * leave a trace the list forgot, and "nothing changed" would be true of the fields someone
 * remembered. The references are put back as they were, so `state.project === before` holds
 * afterwards and a subscriber comparing by identity sees no change in the end state.
 *
 * Two limits, both stated rather than hidden:
 *
 * - **Synchronous work only.** Anything the work does after an `await` would land after the
 *   restore, on a store the dry run had already declared untouched. So a thenable result is
 *   refused as a fault — the dry-runnable handlers are all synchronous, and one that stops
 *   being so should fail loudly here rather than leak an edit.
 * - **Subscribers see the intermediate state.** Zustand notifies synchronously on every `set`,
 *   so the engine's store subscription will sync to the dry-run timeline and back within the
 *   same task. React batches its renders, so nothing is painted in between; the engine does
 *   a little wasted work, and ends where it started.
 */

import { useEditor, type EditorState } from './editor'

/** The data half of the store — everything that is not an action. */
function snapshot(): Partial<EditorState> {
  const state = useEditor.getState() as unknown as Record<string, unknown>
  const data: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(state)) {
    if (typeof value !== 'function') data[key] = value
  }
  return data as Partial<EditorState>
}

function isThenable(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { then?: unknown }).then === 'function'
  )
}

export class AsyncDryRunError extends Error {
  constructor() {
    super(
      'A dry run was asked of work that is asynchronous, and its later steps would have landed ' +
        'after the project was restored. This is a fault in bay, not in the call: the tool is ' +
        'marked dry-runnable and should not be. Call it without validateOnly.'
    )
    this.name = 'AsyncDryRunError'
  }
}

/**
 * Runs `work`, returns what it returned (or rethrows what it threw), and leaves the store as it
 * found it either way.
 */
export function dryRun<T>(work: () => T): T {
  const before = snapshot()
  try {
    const result = work()
    if (isThenable(result)) {
      // Swallow its eventual rejection: the call has already been answered with this error,
      // and an unhandled rejection would only add noise to a console nobody is reading.
      ;(result as unknown as Promise<unknown>).then(undefined, () => {})
      throw new AsyncDryRunError()
    }
    return result
  } finally {
    useEditor.setState(before)
  }
}
