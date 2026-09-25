/**
 * `read_feedback`, `resolve_feedback` and `add_comment`.
 *
 * Review comments are batch revisions: the user leaves notes at points on the timeline, the
 * agent reads the open ones, fixes each and resolves it with what it did — one pass instead of
 * a chat back-and-forth per note. Each comment is reported with the items under it, so the
 * agent can go from "this cut is late" to the clip without a read_project round trip.
 */

import { findAsset, formatTimecode, itemEnd, type ReviewComment } from '@shared/project'
import { resolveId } from '@shared/mcp'
import { fail, project, store, timeline, type Handlers } from './helpers'
import { frameOrPlayhead } from './read'

/** The items playing at `frame` (or anywhere in `[frame, endFrame)`), with where they sit. */
function itemsUnder(comment: ReviewComment): Record<string, unknown>[] {
  const from = comment.frame
  const to = comment.endFrame ?? comment.frame + 1
  const out: Record<string, unknown>[] = []
  for (const track of timeline().tracks) {
    for (const item of track.items) {
      if (item.from >= to || itemEnd(item) <= from) continue
      const asset = findAsset(project(), item.assetId)
      out.push({
        itemId: item.id,
        trackId: track.id,
        track: track.name,
        asset: asset?.name ?? null,
        kind: asset?.kind ?? null,
        from: item.from,
        endFrame: itemEnd(item)
      })
    }
  }
  return out
}

/** One comment as every tool result reports it. */
export function describeComment(comment: ReviewComment, withItems = false): Record<string, unknown> {
  const fps = timeline().fps
  return {
    id: comment.id,
    frame: comment.frame,
    ...(comment.endFrame !== undefined ? { endFrame: comment.endFrame } : {}),
    timecode:
      formatTimecode(comment.frame, fps, true) +
      (comment.endFrame !== undefined ? `–${formatTimecode(comment.endFrame, fps, true)}` : ''),
    text: comment.text,
    author: comment.author,
    resolved: comment.resolved,
    ...(comment.resolvedNote ? { resolvedNote: comment.resolvedNote } : {}),
    ...(withItems ? { itemsUnder: itemsUnder(comment) } : {})
  }
}

function sorted(): ReviewComment[] {
  return [...(timeline().comments ?? [])].sort((a, b) => a.frame - b.frame || a.createdAt - b.createdAt)
}

/** "cm_… ("text" at frame N)", for refusals that name what would have worked. */
function listing(comments: readonly ReviewComment[]): string {
  return comments.map((c) => `${c.id} ("${c.text.length > 40 ? c.text.slice(0, 39) + '…' : c.text}" at frame ${c.frame})`).join(', ')
}

export function readFeedback(args: Record<string, unknown>): Record<string, unknown> {
  const all = args.include === 'all'
  const every = sorted()
  const shown = all ? every : every.filter((c) => !c.resolved)
  const open = every.filter((c) => !c.resolved).length
  return {
    comments: shown.map((c) => describeComment(c, true)),
    open,
    resolved: every.length - open,
    ...(shown.length === 0
      ? { note: every.length === 0 ? 'There are no review comments on this timeline.' : 'Every comment is resolved. Pass include: "all" to see them.' }
      : {})
  }
}

function noteText(value: unknown, where: string): string {
  const note = typeof value === 'string' ? value.trim() : ''
  if (!note) fail(`${where}note is empty. Say in a sentence what you changed, so the user can check it.`)
  return note
}

export function resolveFeedback(args: Record<string, unknown>): Record<string, unknown> {
  const comments = timeline().comments ?? []
  if (comments.length === 0) fail('This timeline has no review comments, so there is none to resolve.')
  const ids = comments.map((c) => c.id)
  const open = comments.filter((c) => !c.resolved)

  let planned: { given: string; note: string }[]
  if (args.resolutions !== undefined) {
    if (args.commentIds !== undefined || args.note !== undefined) {
      fail('Pass either resolutions (a note each) or commentIds with one note, not both.')
    }
    const list = args.resolutions
    if (!Array.isArray(list) || list.length === 0) fail('resolutions is empty. Pass [{ commentId, note }, …].')
    planned = list.map((entry, index) => {
      const where = `resolutions[${index}].`
      if (typeof entry !== 'object' || entry === null) fail(`resolutions[${index}] must be { commentId, note }.`)
      const e = entry as Record<string, unknown>
      if (typeof e.commentId !== 'string' || !e.commentId) fail(`${where}commentId is missing. Open comments: ${listing(open)}.`)
      return { given: e.commentId, note: noteText(e.note, where) }
    })
  } else {
    const list = args.commentIds
    if (!Array.isArray(list) || list.length === 0) {
      fail(`Pass commentIds (with a note) or resolutions. Open comments: ${open.length > 0 ? listing(open) : 'none'}.`)
    }
    const note = noteText(args.note, '')
    planned = list.map((given) => ({ given: String(given), note }))
  }

  // Every id resolved before any comment changes, so a bad third id leaves the first two open.
  const resolved = planned.map(({ given, note }) => {
    const found = resolveId(given, ids)
    if (!found.ok) {
      fail(`${found.error} ${open.length > 0 ? `Open comments: ${listing(open)}.` : 'Every comment is already resolved.'}`)
    }
    return { id: found.id, note }
  })

  store().transact(() => {
    for (const { id, note } of resolved) store().resolveComment(id, note)
  })
  const after = timeline().comments ?? []
  return {
    resolved: resolved.map(({ id }) => describeComment(after.find((c) => c.id === id)!)),
    stillOpen: after.filter((c) => !c.resolved).length
  }
}

export function addComment(args: Record<string, unknown>): Record<string, unknown> {
  const text = typeof args.text === 'string' ? args.text.trim() : ''
  if (!text) fail('text is empty. Pass the words the user should read.')
  const frame = frameOrPlayhead(args)
  let endFrame: number | undefined
  if (args.endFrame !== undefined) {
    endFrame = Math.round(Number(args.endFrame))
    if (!(endFrame > frame)) {
      fail(`endFrame (${String(args.endFrame)}) must be after frame (${frame}). Omit it for a comment on one moment.`)
    }
  }
  const id = store().addComment(frame, text, { author: 'agent', ...(endFrame !== undefined ? { endFrame } : {}) })
  if (!id) fail('The comment was not added: there is no timeline open.')
  const comment = timeline().comments?.find((c) => c.id === id)
  if (!comment) fail(`Comment ${id} was added but cannot be read back.`)
  return { comment: describeComment(comment), open: (timeline().comments ?? []).filter((c) => !c.resolved).length }
}

export const handlers: Handlers = {
  read_feedback: (args) => readFeedback(args),
  resolve_feedback: (args) => resolveFeedback(args),
  add_comment: (args) => addComment(args),
}
