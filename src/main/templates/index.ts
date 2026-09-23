/**
 * The shipped templates' documents, inlined by `?raw` and keyed by resource uri.
 *
 * Two consumers read them: the MCP resource catalog (`mcp/resources.ts`), which serves them to
 * an agent as `bay://template/...`, and placing a template (`html/templates.ts`), which sizes one
 * and writes it to disk. They lived inside the resource bodies, which made `html/` import
 * `mcp/` while `mcp/` imported `html/` — a cycle over data neither side owned. The documents
 * belong next to the files they are.
 *
 * Keyed through `templateUri` so the address cannot drift from the catalog's id.
 */

import { templateUri } from '@shared/templates'
import tplSubtitle from './subtitle.html?raw'
import tplLowerThird from './lower-third.html?raw'
import tplTitleCard from './title-card.html?raw'
import tplCallout from './callout.html?raw'
import tplStat from './stat.html?raw'
import tplProgress from './progress.html?raw'
import tplEndCard from './end-card.html?raw'

export const TEMPLATE_BODIES: Readonly<Record<string, string>> = {
  [templateUri('subtitle')]: tplSubtitle,
  [templateUri('lower-third')]: tplLowerThird,
  [templateUri('title-card')]: tplTitleCard,
  [templateUri('callout')]: tplCallout,
  [templateUri('stat')]: tplStat,
  [templateUri('progress')]: tplProgress,
  [templateUri('end-card')]: tplEndCard
}
