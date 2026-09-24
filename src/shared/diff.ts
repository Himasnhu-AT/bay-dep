/**
 * What changed between two states of a project, in the words an editor would use.
 *
 * The agent edits without asking; this is how the user sees what it did and decides whether to
 * keep it. Like a commit's diff: every agent turn that changes the project gets one, and the
 * state before it is kept so the turn can be reverted exactly (see the store's
 * `revertAgentChange`). Compared by id, never by position — a clip that moved is the same clip,
 * not one removed and another added.
 */

import { findAsset, formatTimecode, type Item, type Project, type Timeline } from './project'
import { formatPan as panLabel } from './inspector'

export interface ChangeLine {
  kind: 'added' | 'removed' | 'changed'
  text: string
}

const MAX_LINES = 14

function activeTimeline(project: Project): Timeline | undefined {
  return project.timelines.find((t) => t.id === project.activeTimelineId) ?? project.timelines[0]
}

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null)

export function describeChanges(before: Project, after: Project): ChangeLine[] {
  const out: ChangeLine[] = []
  const was = activeTimeline(before)
  const now = activeTimeline(after)
  const fps = now?.fps ?? was?.fps ?? 30
  const tc = (frame: number): string => formatTimecode(frame, fps, true)
  const assetName = (project: Project, item: Item): string => {
    const asset = findAsset(project, item.assetId)
    if (!asset) return 'a clip'
    return asset.kind === 'text' ? `“${asset.text ?? asset.name}”` : `“${asset.name}”`
  }

  if (before.name !== after.name) out.push({ kind: 'changed', text: `Renamed the project to “${after.name}”` })

  // Assets: imported or removed.
  const oldAssets = new Map(before.assets.map((a) => [a.id, a]))
  const newAssets = new Map(after.assets.map((a) => [a.id, a]))
  for (const [id, asset] of newAssets) {
    const old = oldAssets.get(id)
    // A text asset is how a title or caption stores its words — bookkeeping, not an import. Its
    // placement is reported as the clip it becomes; listing it twice made a 4-caption turn read
    // as nine changes.
    if (!old && asset.kind === 'text') continue
    if (!old) out.push({ kind: 'added', text: `Imported “${asset.name}”` })
    else if (old.name !== asset.name || old.text !== asset.text) {
      out.push({ kind: 'changed', text: `Changed the text of “${old.text ?? old.name}” to “${asset.text ?? asset.name}”` })
    } else if (!same(old.compositionVariables, asset.compositionVariables) || old.durationUs !== asset.durationUs) {
      // A composition re-read after its file was rewritten: new knobs, or a new length.
      out.push({ kind: 'changed', text: `Updated “${asset.name}”` })
    }
  }
  for (const [id, asset] of oldAssets) {
    if (!newAssets.has(id) && asset.kind !== 'text') out.push({ kind: 'removed', text: `Removed “${asset.name}” from the media` })
  }

  if (was && now) {
    if (was.width !== now.width || was.height !== now.height) {
      out.push({ kind: 'changed', text: `Canvas ${was.width}×${was.height} → ${now.width}×${now.height}` })
    }
    if (was.fps !== now.fps) out.push({ kind: 'changed', text: `Frame rate ${was.fps} → ${now.fps}` })
    if (was.background !== now.background) out.push({ kind: 'changed', text: `Background ${was.background} → ${now.background}` })

    const oldTracks = new Map(was.tracks.map((t) => [t.id, t]))
    const newTracks = new Map(now.tracks.map((t) => [t.id, t]))
    for (const [id, track] of newTracks) if (!oldTracks.has(id)) out.push({ kind: 'added', text: `Added track ${track.name}` })
    for (const [id, track] of oldTracks) if (!newTracks.has(id)) out.push({ kind: 'removed', text: `Removed track ${track.name}` })
    for (const [id, track] of newTracks) {
      const old = oldTracks.get(id)
      if (!old) continue
      if (old.name !== track.name) out.push({ kind: 'changed', text: `Renamed track ${old.name} to ${track.name}` })
      const flag = (on: boolean, yes: string, no: string): void => {
        out.push({ kind: 'changed', text: `${on ? yes : no} track ${track.name}` })
      }
      if (old.muted !== track.muted) flag(track.muted, 'Muted', 'Unmuted')
      if (old.hidden !== track.hidden) flag(track.hidden, 'Hid', 'Showed')
      if (old.locked !== track.locked) flag(track.locked, 'Locked', 'Unlocked')
      if ((old.solo === true) !== (track.solo === true)) flag(track.solo === true, 'Soloed', 'Unsoloed')
    }

    // By track id: renaming a track is not moving every clip on it.
    const items = (timeline: Timeline): Map<string, { item: Item; track: string; trackId: string }> =>
      new Map(timeline.tracks.flatMap((t) => t.items.map((item) => [item.id, { item, track: t.name, trackId: t.id }] as const)))
    const oldItems = items(was)
    const newItems = items(now)
    for (const [id, { item, track, trackId }] of newItems) {
      const old = oldItems.get(id)
      const name = assetName(after, item)
      const span = `${tc(item.from)}–${tc(item.from + item.durationInFrames)}`
      if (!old) {
        out.push({ kind: 'added', text: `Added ${name} on ${track}, ${span}` })
        continue
      }
      const o = old.item
      if (old.trackId !== trackId) out.push({ kind: 'changed', text: `Moved ${name} from ${old.track} to ${track}` })
      if (o.from !== item.from && o.durationInFrames === item.durationInFrames) {
        out.push({ kind: 'changed', text: `Moved ${name} ${tc(o.from)} → ${tc(item.from)}` })
      } else if (o.from !== item.from || o.durationInFrames !== item.durationInFrames) {
        out.push({ kind: 'changed', text: `Trimmed ${name} to ${span}` })
      }
      if (o.sourceStartUs !== item.sourceStartUs && o.from === item.from) {
        out.push({ kind: 'changed', text: `Slipped ${name} to start ${(item.sourceStartUs / 1e6).toFixed(2)}s into its source` })
      }
      if (o.fadeInFrames !== item.fadeInFrames) out.push({ kind: 'changed', text: `Fade in on ${name}: ${o.fadeInFrames} → ${item.fadeInFrames} frames` })
      if (o.fadeOutFrames !== item.fadeOutFrames) out.push({ kind: 'changed', text: `Fade out on ${name}: ${o.fadeOutFrames} → ${item.fadeOutFrames} frames` })
      if (o.volume !== item.volume) out.push({ kind: 'changed', text: `Volume of ${name}: ${Math.round(o.volume * 100)}% → ${Math.round(item.volume * 100)}%` })
      if ((o.pan ?? 0) !== (item.pan ?? 0)) out.push({ kind: 'changed', text: `Pan of ${name}: ${panLabel(o.pan)} → ${panLabel(item.pan)}` })
      if (o.speed !== item.speed) out.push({ kind: 'changed', text: `Speed of ${name}: ${o.speed}× → ${item.speed}×` })
      if (!same(o.layout, item.layout)) out.push({ kind: 'changed', text: `Repositioned ${name}` })
      if (!same(o.crop, item.crop)) out.push({ kind: 'changed', text: `Cropped ${name}` })
      if (!same(o.adjustments, item.adjustments)) out.push({ kind: 'changed', text: `Adjusted the look of ${name}` })
      if (!same(o.blendMode, item.blendMode)) out.push({ kind: 'changed', text: `Blend mode of ${name}: ${o.blendMode ?? 'normal'} → ${item.blendMode ?? 'normal'}` })
      if (!same(o.text, item.text)) out.push({ kind: 'changed', text: `Restyled the text of ${name}` })
      if (!same(o.variables, item.variables)) out.push({ kind: 'changed', text: `Changed the content of ${name}` })
      // A head trim shifts keys to keep them on their footage; that is the trim, already said above.
      if (!same(o.keyframes, item.keyframes) && o.from === item.from) {
        const keyed = Object.keys(item.keyframes ?? {})
        out.push({
          kind: 'changed',
          text: keyed.length > 0 ? `Animated ${keyed.join(', ')} on ${name}` : `Removed the animation from ${name}`
        })
      }
    }
    for (const [id, { item, track }] of oldItems) {
      if (!newItems.has(id)) {
        out.push({ kind: 'removed', text: `Removed ${assetName(before, item)} from ${track}, ${tc(item.from)}–${tc(item.from + item.durationInFrames)}` })
      }
    }

    const oldTransitions = new Map((was.transitions ?? []).map((t) => [t.id, t]))
    const newTransitions = new Map((now.transitions ?? []).map((t) => [t.id, t]))
    for (const [id, t] of newTransitions) {
      const old = oldTransitions.get(id)
      if (!old) out.push({ kind: 'added', text: `Added a ${t.kind} (${t.durationInFrames} frames)` })
      else if (!same(old, t)) out.push({ kind: 'changed', text: `Changed a transition to ${t.kind} (${t.durationInFrames} frames)` })
    }
    for (const [id, t] of oldTransitions) if (!newTransitions.has(id)) out.push({ kind: 'removed', text: `Removed a ${t.kind}` })

    const oldMarkers = new Map((was.markers ?? []).map((m) => [m.id, m]))
    const newMarkers = new Map((now.markers ?? []).map((m) => [m.id, m]))
    for (const [id, m] of newMarkers) {
      const old = oldMarkers.get(id)
      if (!old) out.push({ kind: 'added', text: `Added marker “${m.label}” at ${tc(m.frame)}` })
      else if (old.frame !== m.frame) out.push({ kind: 'changed', text: `Moved marker “${m.label}” ${tc(old.frame)} → ${tc(m.frame)}` })
      else if (old.label !== m.label || old.color !== m.color) out.push({ kind: 'changed', text: `Changed marker “${old.label}”${old.label !== m.label ? ` to “${m.label}”` : ''}` })
    }
    for (const [id, m] of oldMarkers) if (!newMarkers.has(id)) out.push({ kind: 'removed', text: `Removed marker “${m.label}”` })

    const oldComments = new Map((was.comments ?? []).map((c) => [c.id, c]))
    const newComments = new Map((now.comments ?? []).map((c) => [c.id, c]))
    for (const [id, c] of newComments) {
      const old = oldComments.get(id)
      if (!old) out.push({ kind: 'added', text: `Added a comment at ${tc(c.frame)}: “${c.text}”` })
      else if (!old.resolved && c.resolved) out.push({ kind: 'changed', text: `Resolved the comment “${c.text}”${c.resolvedNote ? ` — ${c.resolvedNote}` : ''}` })
      else if (!same(old, c)) out.push({ kind: 'changed', text: `Changed the comment “${old.text}”` })
    }
    for (const [id, c] of oldComments) if (!newComments.has(id)) out.push({ kind: 'removed', text: `Removed the comment “${c.text}”` })
  }

  if (out.length > MAX_LINES) {
    const rest = out.length - (MAX_LINES - 1)
    return [...out.slice(0, MAX_LINES - 1), { kind: 'changed', text: `…and ${rest} more changes` }]
  }
  return out
}
