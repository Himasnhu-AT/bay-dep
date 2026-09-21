/**
 * `write_composition` and `read_composition` — an agent authoring the clips bay has no
 * primitive for.
 *
 * The whole point of these two is the feedback loop. A composition fails in ways that produce a
 * *wrong picture* rather than an error: an unsized root collapses to nothing, a `<template>`
 * wrapper renders blank, a CDN script tag is blocked silently so the animation never starts and
 * the clip is a still frame. None of that throws, and none of it appears in any log. So writing
 * one always reports what is wrong with it, with the line, before anything gets placed — an
 * agent that has to discover these by rendering and squinting will not discover them at all.
 */

import { fatalFaults, type CompositionFault } from '@shared/composition'
import { bay } from '@/lib/bay'
import { fail } from './helpers'
import { store } from './helpers'

/** A fault as an agent should read it: what is wrong, where, and whether it stops the clip. */
function describe(fault: CompositionFault): string {
  const where = fault.line === null ? '' : ` (line ${fault.line})`
  return `${fault.fatal ? 'FATAL' : 'warning'}${where}: ${fault.message}`
}

export async function writeComposition(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const path = args.path
  const html = args.html
  if (typeof path !== 'string' || path.length === 0) {
    fail('`path` must be an absolute path ending .html.')
  }
  if (typeof html !== 'string' || html.length === 0) {
    fail('`html` must be the complete document. Pass @./file.html to read it from a file.')
  }

  const api = bay()
  if (!api) fail('bay is not answering. The main process may be starting; try again.')

  const written = await api.composition.write(path, html)
  if (!written.ok) fail(written.error)

  const { info, faults } = await api.composition.inspect(path)
  const fatal = fatalFaults(faults)

  // Written either way — an agent fixing a composition needs the broken file on disk to edit,
  // and refusing to write would make the fix a rewrite from nothing every time.
  if (fatal.length > 0) {
    return {
      path,
      written: true,
      imported: false,
      usable: false,
      problems: faults.map(describe),
      note:
        `The file is on disk but cannot be placed yet: ${fatal.length} fatal problem` +
        `${fatal.length === 1 ? '' : 's'}. Fix ${fatal.length === 1 ? 'it' : 'them'} and call ` +
        `write_composition again with the corrected document.`
    }
  }

  const shouldImport = args.import !== false
  if (!shouldImport) {
    return {
      path,
      written: true,
      imported: false,
      usable: true,
      compositionId: info?.compositionId,
      durationSeconds: info?.durationSeconds,
      ...(faults.length > 0 ? { problems: faults.map(describe) } : {})
    }
  }

  const imported = await api.media.importPaths([path])
  const asset = imported[0]?.asset
  if (!asset) fail(`${path} was written but could not be imported. This is a fault in bay.`)
  if (asset.error) fail(asset.error)

  store().addAssets([asset])

  return {
    path,
    written: true,
    imported: true,
    usable: true,
    assetId: asset.id,
    compositionId: info?.compositionId,
    durationSeconds: info?.durationSeconds,
    variables: info?.variables ?? [],
    width: asset.width,
    height: asset.height,
    // Reported even when nothing is fatal, because the non-fatal ones are the ones that hide:
    // a blocked network request renders as a still frame with nothing in any log.
    ...(faults.length > 0 ? { problems: faults.map(describe) } : {}),
    next: `Place it with place_asset { assetId: "${asset.id}" }.`
  }
}

export async function readComposition(
  args: Record<string, unknown>
): Promise<Record<string, unknown>> {
  const path = args.path
  if (typeof path !== 'string' || path.length === 0) {
    fail('`path` must be an absolute path to a .html file.')
  }

  const api = bay()
  if (!api) fail('bay is not answering. The main process may be starting; try again.')

  const includeHtml = args.includeHtml === true
  const { info, faults, html } = await api.composition.inspect(path, includeHtml)

  if (!info && fatalFaults(faults).length === 0) {
    fail(`${path} could not be read. Check the path is correct and the file exists.`)
  }

  return {
    path,
    usable: info !== null,
    ...(info
      ? {
          compositionId: info.compositionId,
          durationSeconds: info.durationSeconds,
          width: info.width,
          height: info.height,
          // What this composition can be configured with. Reported even when empty, because
          // "declares nothing" and "I did not look" are different answers and an agent
          // deciding whether to edit the HTML or set a variable needs to tell them apart.
          variables: info.variables
        }
      : {}),
    problems: faults.map(describe),
    ...(includeHtml && html !== undefined ? { html } : {})
  }
}
