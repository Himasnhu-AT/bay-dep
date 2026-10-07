/**
 * `check_film` — the film oracle on one composition.
 *
 * Main samples (`composition.film`: what the page declares, its tracks at every frame, a small
 * picture twelve times a second); `@shared/film-oracle` judges. This adapter decides which
 * composition, with which clip's variables, and says what to do with the answer. It reads the
 * project and changes nothing in it.
 */

import { cssVariables, resolveVariables } from '@shared/composition'
import { checkFilm, FILM_CONTRACT } from '@shared/film-oracle'
import { findAsset } from '@shared/project'
import { importedFonts } from '@/engine/importedFonts'
import { bay } from '@/lib/bay'
import { fail, project, resolveAsset, resolveItem, timeline, type Handlers } from './helpers'

export async function checkFilmTool(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const itemId = typeof args['itemId'] === 'string' ? args['itemId'] : null
  const assetId = typeof args['assetId'] === 'string' ? args['assetId'] : null
  if (!itemId && !assetId) {
    fail(
      'check_film needs assetId (a composition in the media pool) or itemId (a composition clip on the timeline). ' +
        'browse_assets lists compositions as kind "html"; write_composition returns the assetId of the one it wrote.'
    )
  }
  const found = itemId ? resolveItem(itemId) : null
  const asset = found ? findAsset(project(), found.item.assetId) : resolveAsset(assetId!)
  if (!asset) fail('That clip has no asset, so there is no composition to check.')
  if (asset.kind !== 'html' || !asset.path) {
    const compositions = project().assets.filter((a) => a.kind === 'html')
    fail(
      `"${asset.name}" is a ${asset.kind} asset, not an HTML composition, and check_film measures only compositions: ` +
        'it reads window.__film from the page. ' +
        (compositions.length > 0
          ? `Compositions in this project: ${compositions.map((a) => `${a.name} (${a.id})`).join(', ')}.`
          : 'This project has no composition yet — write_composition makes one.')
    )
  }
  if (asset.error) fail(`"${asset.name}" cannot be rendered: ${asset.error} Fix it with write_composition first.`)

  const api = bay()
  if (!api) fail('This window has no bridge to the app, so it cannot open a composition. Try again in a moment.')

  const declared = { variables: asset.compositionVariables ?? [] }
  const variables = resolveVariables(declared, found?.item.variables)
  const result = await api.composition.film({
    assetId: asset.id,
    path: asset.path,
    fps: timeline().fps,
    pictures: args['pictures'] !== false,
    variables,
    cssVariables: cssVariables(declared, variables),
    fonts: importedFonts.compositionFonts()
  })

  if (!result.ok) {
    if (result.reason === 'failed') fail(`check_film could not sample "${asset.name}": ${result.problems.join(' ')}`)
    // Not an error: the composition was read and this is what it is missing. `measured: false`
    // so nothing downstream mistakes a refusal for a film that passed.
    return {
      asset: asset.name,
      path: asset.path,
      measured: false,
      problems: result.problems,
      contract: FILM_CONTRACT,
      next:
        'Nothing was measured. Add or fix window.__film in the composition (write_composition), then call check_film again. ' +
        'x, y are the top-left corner of each box in screen pixels of the composition — after any camera — and an id keeps ' +
        'its name for as long as it is the same thing to the viewer.'
    }
  }

  const report = checkFilm(result.meta, result.samples)
  const sound = report.events
    ? ` \`events\` is the film's own __film.events(): pass it to score_sfx as events, with durationSeconds ${result.samples.durationSeconds}.`
    : ''
  return {
    asset: asset.name,
    path: asset.path,
    measured: true,
    ...report,
    elapsedSeconds: Math.round(result.elapsedMs / 100) / 10,
    next:
      (report.verdict === 'fail'
        ? 'Fix the findings in the composition (write_composition) and call check_film again; they are in the order to fix them. Do not place or export a film that fails.'
        : report.verdict === 'warn'
          ? 'Nothing fails. Each warning says what would make it better or what was not measured; fix those, or say why they stand. Then look at it with frame_grid.'
          : 'Every leg passes. That is not the same as having looked: read `blind`, then check the picture with frame_grid.') + sound
  }
}

export const handlers: Handlers = {
  check_film: (args) => checkFilmTool(args)
}
