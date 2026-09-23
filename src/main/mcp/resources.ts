/**
 * The bodies behind the resource catalog.
 *
 * Each document is inlined into the bundle by `?raw` rather than read from disk at runtime.
 * That is deliberate: a path that resolves in a dev checkout and not inside `app.asar` is the
 * classic packaging bug, and it surfaces as an empty guide on a user's machine while every
 * developer sees it working. Inlined, a missing file fails the build instead.
 *
 * The pairing with `RESOURCES` is checked below rather than trusted. A catalog entry with no
 * body would list a document that reads as empty, and an agent would conclude bay had nothing
 * to say rather than that bay was broken — the same shape as a tool advertised with no handler.
 */

import { ALL_RESOURCES } from '@shared/resources'
import { templateUri } from '@shared/templates'
import { examplesGuide, toolReference } from '@shared/guides'
import editing from './docs/editing.md?raw'
import tplSubtitle from '../templates/subtitle.html?raw'
import tplLowerThird from '../templates/lower-third.html?raw'
import tplTitleCard from '../templates/title-card.html?raw'
import tplCallout from '../templates/callout.html?raw'
import tplStat from '../templates/stat.html?raw'
import tplProgress from '../templates/progress.html?raw'
import tplEndCard from '../templates/end-card.html?raw'
import contract from './docs/compositions/contract.md?raw'
import minimal from './docs/compositions/minimal-composition.md?raw'
import dataAttributes from './docs/compositions/data-attributes.md?raw'
import determinism from './docs/compositions/determinism-rules.md?raw'
import patterns from './docs/compositions/composition-patterns.md?raw'
import tracksAndClips from './docs/compositions/tracks-and-clips.md?raw'
import variablesAndMedia from './docs/compositions/variables-and-media.md?raw'
import subCompositions from './docs/compositions/sub-compositions.md?raw'
import editingRecipes from './docs/compositions/editing-recipes.md?raw'
import fullScreenMotion from './docs/compositions/full-screen-motion.md?raw'

const BODIES: Record<string, string> = {
  'bay://guide/editing': editing,
  // Rendered from the catalog at import, not written: see `@shared/guides`.
  'bay://guide/tools': toolReference(),
  'bay://guide/examples': examplesGuide(),
  'bay://guide/composition/contract': contract,
  'bay://guide/composition/minimal': minimal,
  'bay://guide/composition/data-attributes': dataAttributes,
  'bay://guide/composition/determinism': determinism,
  'bay://guide/composition/patterns': patterns,
  'bay://guide/composition/tracks-and-clips': tracksAndClips,
  'bay://guide/composition/variables-and-media': variablesAndMedia,
  'bay://guide/composition/sub-compositions': subCompositions,
  'bay://guide/composition/editing-recipes': editingRecipes,
  'bay://guide/composition/full-screen-motion': fullScreenMotion,
  // Keyed through `templateUri` so the address cannot drift from the catalog's id.
  [templateUri('subtitle')]: tplSubtitle,
  [templateUri('lower-third')]: tplLowerThird,
  [templateUri('title-card')]: tplTitleCard,
  [templateUri('callout')]: tplCallout,
  [templateUri('stat')]: tplStat,
  [templateUri('progress')]: tplProgress,
  [templateUri('end-card')]: tplEndCard
}

/**
 * Every catalog entry has a body, and every body is in the catalog.
 *
 * Reported rather than thrown, for the reason the tool-catalog guard next door already learned
 * the hard way: throwing at module scope over a documentation mismatch would take down the MCP
 * server — and with it every working tool — because a guide was missing. `resources/read`
 * refuses the specific uri instead, naming it as a build fault so nobody debugs their client.
 */
const missingBodies = ALL_RESOURCES.filter((resource) => !BODIES[resource.uri]).map((r) => r.uri)
const orphanBodies = Object.keys(BODIES).filter((uri) => !ALL_RESOURCES.some((r) => r.uri === uri))
if (missingBodies.length > 0 || orphanBodies.length > 0) {
  console.error(
    '[bay] resource catalog and bodies disagree.' +
      (missingBodies.length > 0 ? ` Listed with no body: ${missingBodies.join(', ')}.` : '') +
      (orphanBodies.length > 0 ? ` Body with no catalog entry: ${orphanBodies.join(', ')}.` : '')
  )
}

export function resourceBody(uri: string): string | null {
  return BODIES[uri] ?? null
}
