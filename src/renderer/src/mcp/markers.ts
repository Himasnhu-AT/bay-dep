/**
 * `add_marker` and `remove_marker`.
 *
 * Markers are how an agent and a person leave each other notes in time: "the laugh is here",
 * "chapter 2 starts here", "check this cut". They are read back in `read_project`, so an
 * agent can place one on a first pass and act on it on the next without keeping the frame in
 * its own head.
 */

import { resolveId } from '@shared/mcp'
import { fail, store, timeline } from './helpers'
import { describeMarker, frameOrPlayhead } from './read'

/** Hex only, for the same reason text colours are: a name reads back in a different form. */
const HEX = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/

export function addMarker(args: Record<string, unknown>): Record<string, unknown> {
  const frame = frameOrPlayhead(args)
  let color: string | undefined
  if (args.color !== undefined) {
    const given = String(args.color).trim()
    if (!HEX.test(given)) {
      fail(`color must be a hex colour such as "#F5A524", but got "${given}". Omit it for the default.`)
    }
    color = given.toUpperCase()
  }
  const label = args.label === undefined ? undefined : String(args.label)
  if (label !== undefined && label.trim() === '') {
    fail('label is empty. Omit it and bay numbers the marker, or pass the words to show.')
  }

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
