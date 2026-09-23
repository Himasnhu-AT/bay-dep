/**
 * `read_script` and `apply_script` — the timeline as a document.
 *
 * Everything with judgement in it lives in `@shared/script`, where it runs under the test suite:
 * the format, the parse, the diff and the application. This file's job is the part that needs
 * the store — which timeline is active, and running the diff's operations through one `edit()`
 * inside one `transact`, so the whole script is a single undo step however many clips it moved.
 *
 * Both return plain strings rather than objects. The protocol passes a string through as text,
 * and a script wrapped in JSON arrives with every line break escaped — a document the agent
 * would have to decode before it could read, let alone edit.
 */

import { planScript, renderScript, summariseScript } from '@shared/script'
import { fail, project, store, timeline } from './helpers'

export function readScript(): string {
  return renderScript(project(), timeline().id)
}

export function applyScript(args: Record<string, unknown>): string {
  const text = String(args.script ?? '')
  const outcome = planScript(project(), timeline().id, text)
  if ('error' in outcome) fail(outcome.error)
  const { diff } = outcome
  if (diff.operations.length === 0) {
    return (
      'Nothing changed: the script matches the timeline as it stands, so no undo step was ' +
      'recorded. Edit lines before applying.\n\n' +
      renderScript(project(), timeline().id)
    )
  }

  const tl = timeline()
  store().transact(() => store().applyScript(tl.id, diff.operations))

  const lines = summariseScript(diff)
  return (
    `Applied ${diff.operations.length} change${diff.operations.length === 1 ? '' : 's'} as one ` +
    `undo step:\n` +
    lines.map((line) => `- ${line}`).join('\n') +
    '\n\nThe timeline now reads:\n\n' +
    renderScript(project(), tl.id)
  )
}
