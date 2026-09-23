/**
 * `add_marker` and `remove_marker`.
 *
 * Markers are how an agent and a person leave each other notes in time: "the laugh is here",
 * "chapter 2 starts here", "check this cut". They are read back in `read_project`, so an
 * agent can place one on a first pass and act on it on the next without keeping the frame in
 * its own head.
 */

import { resolveId } from '@shared/mcp'
import { fail, store, timeline, type Handlers } from './helpers'
import { describeMarker, frameOrPlayhead } from './read'

/** Hex only, for the same reason text colours are: a name reads back in a different form. */
const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

function markerColor(value: unknown, where: string): string | undefined {
  if (value === undefined) return undefined
  const given = String(value).trim()
  if (!HEX.test(given)) {
    fail(`${where}color must be a hex colour such as "#F5A524", but got "${given}". Omit it for the default.`)
  }
  return given.toUpperCase()
}

function markerLabel(value: unknown, where: string): string | undefined {
  const label = value === undefined ? undefined : String(value)
  if (label !== undefined && label.trim() === '') {
    fail(`${where}label is empty. Omit it and bay numbers the marker, or pass the words to show.`)
  }
  return label
}

/**
 * The `markers` form: every entry checked before any is placed, so a bad fifth entry refuses the
 * call rather than leaving four markers behind, and all of them land as one undo step.
 */
function addMarkers(list: unknown, args: Record<string, unknown>): Record<string, unknown> {
  if (args.frame !== undefined || args.label !== undefined || args.color !== undefined) {
    fail('Pass either markers (a list) or frame/label/color (one marker), not both.')
  }
  if (!Array.isArray(list) || list.length === 0) fail('markers is empty. Pass [{ frame, label?, color? }, …].')
  const planned = list.map((entry, index) => {
    const where = `markers[${index}].`
    if (typeof entry !== 'object' || entry === null) fail(`${where.slice(0, -1)} must be { frame, label?, color? }.`)
    const e = entry as Record<string, unknown>
    const frame = Number(e.frame)
    if (e.frame === undefined || !Number.isFinite(frame) || frame < 0) {
      fail(`${where}frame must be a frame number (0 or more), but got ${JSON.stringify(e.frame)}.`)
    }
    return { frame: Math.round(frame), label: markerLabel(e.label, where), color: markerColor(e.color, where) }
  })
  if (!timeline()) fail('The markers were not added: there is no timeline open.')
  const ids: string[] = []
  store().transact(() => {
    for (const m of planned) {
      const id = store().addMarker(m.frame, m.label, m.color)
      if (id) ids.push(id)
    }
  })
  const placed = (timeline().markers ?? []).filter((m) => ids.includes(m.id))
  return { markers: placed.map(describeMarker), added: placed.length, markerCount: timeline().markers?.length ?? 0 }
}

export function addMarker(args: Record<string, unknown>): Record<string, unknown> {
  if (args.markers !== undefined) return addMarkers(args.markers, args)
  const frame = frameOrPlayhead(args)
  const color = markerColor(args.color, '')
  const label = markerLabel(args.label, '')

  const id = store().addMarker(frame, label, color)
  if (!id) fail('The marker was not added: there is no timeline open.')
  const marker = timeline().markers?.find((m) => m.id === id)
  if (!marker) fail(`Marker ${id} was added but cannot be read back.`)
  return { marker: describeMarker(marker), markerCount: timeline().markers?.length ?? 0 }
}

export function removeMarker(args: Record<string, unknown>): Record<string, unknown> {
  const markers = timeline().markers ?? []
  if (markers.length === 0) fail('This timeline has no markers, so there is none to remove.')
  const resolved = resolveId(String(args.markerId), markers.map((m) => m.id))
  if (!resolved.ok) {
    // The markers are a short list and naming them saves the read_project round trip.
    fail(
      `${resolved.error} Markers on this timeline: ` +
        markers.map((m) => `${m.id} ("${m.label}" at frame ${m.frame})`).join(', ') + '.'
    )
  }
  const target = markers.find((m) => m.id === resolved.id)
  if (!target) fail(`No marker ${resolved.id}.`)
  store().removeMarker(target.id)
  return { removed: describeMarker(target), markerCount: timeline().markers?.length ?? 0 }
}

export const handlers: Handlers = {
  add_marker: (args) => addMarker(args),
  remove_marker: (args) => removeMarker(args),
}
