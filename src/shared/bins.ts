/**
 * Bins: folders in the Media Pool.
 *
 * A bin is a name; an asset says which bin it is in. Both fields are optional and additive
 * (`Project.bins`, `Asset.binId`): a project that never made a bin has neither key and saves
 * exactly as it did, and an older build loads a file that has them, carries them through and
 * writes them back. One level — a bin holds assets, not bins.
 *
 * A bin is only where an asset is *listed*. Nothing about the timeline, a clip or a file reads
 * it, so no edit here can change a picture or a sound, and removing a bin removes no media: its
 * assets go back to the top of the pool.
 *
 * An asset naming a bin that does not exist — a file edited by hand, or written by something
 * else — is listed at the top of the pool, and the stray id is cleared the next time bins are
 * edited. It is never an error: a project must not fail to open over where a clip is filed.
 */

import type { Asset, Bin, Project } from './project'

export const BIN_NAME_LIMIT = 80

/** The project's bins in the order they were made. */
export const binsOf = (project: Pick<Project, 'bins'>): readonly Bin[] => project.bins ?? []

/** The bin an asset is listed in, or null for the top of the pool. */
export function binOf(project: Pick<Project, 'bins'>, asset: Pick<Asset, 'binId'>): Bin | null {
  if (!asset.binId) return null
  return binsOf(project).find((bin) => bin.id === asset.binId) ?? null
}

/** A bin by its id, or failing that by its name (case-insensitively) — how a person or an agent names one. */
export function findBin(project: Pick<Project, 'bins'>, idOrName: string): Bin | undefined {
  const bins = binsOf(project)
  const wanted = idOrName.trim().toLowerCase()
  return bins.find((bin) => bin.id === idOrName) ?? bins.find((bin) => bin.name.toLowerCase() === wanted)
}

const listed = (project: Pick<Project, 'bins'>): string => {
  const bins = binsOf(project)
  return bins.length === 0 ? 'This project has no bins yet.' : `The bins are: ${bins.map((bin) => `“${bin.name}” (${bin.id})`).join(', ')}.`
}

function checkName(project: Pick<Project, 'bins'>, given: string, exceptId?: string): { name: string } | { error: string } {
  const name = given.trim()
  if (name === '') return { error: 'A bin needs a name.' }
  if (name.length > BIN_NAME_LIMIT) return { error: `That name is ${name.length} characters; a bin's name can be up to ${BIN_NAME_LIMIT}.` }
  const taken = binsOf(project).find((bin) => bin.id !== exceptId && bin.name.toLowerCase() === name.toLowerCase())
  if (taken) return { error: `There is already a bin called “${taken.name}” (${taken.id}). Use it, or choose another name.` }
  return { name }
}

/** Drop bin ids that name nothing, and the empty `bins` key, so an untouched pool saves as it loaded. */
function tidy(project: Project): void {
  const ids = new Set(binsOf(project).map((bin) => bin.id))
  for (const asset of project.assets) {
    if (asset.binId !== undefined && !ids.has(asset.binId)) delete asset.binId
  }
  if (project.bins && project.bins.length === 0) delete project.bins
}

/** Make a bin. Mutates `project`; a refusal changes nothing. */
export function createBin(project: Project, name: string, id: string): { bin: Bin } | { error: string } {
  const checked = checkName(project, name)
  if ('error' in checked) return checked
  const bin: Bin = { id, name: checked.name }
  project.bins = [...binsOf(project), bin]
  return { bin }
}

export function renameBin(project: Project, binId: string, name: string): { bin: Bin; was: string } | { error: string } {
  const bin = binsOf(project).find((candidate) => candidate.id === binId)
  if (!bin) return { error: `No bin has the id "${binId}". ${listed(project)}` }
  const checked = checkName(project, name, bin.id)
  if ('error' in checked) return checked
  if (checked.name === bin.name) return { error: `The bin is already called “${bin.name}”. Nothing was changed.` }
  const was = bin.name
  bin.name = checked.name
  return { bin, was }
}

/** Remove a bin. What was in it is not removed: it is listed at the top of the pool again. */
export function removeBin(project: Project, binId: string): { removed: Bin; released: string[] } | { error: string } {
  const bin = binsOf(project).find((candidate) => candidate.id === binId)
  if (!bin) return { error: `No bin has the id "${binId}". ${listed(project)}` }
  const released = project.assets.filter((asset) => asset.binId === bin.id).map((asset) => asset.id)
  project.bins = binsOf(project).filter((candidate) => candidate.id !== bin.id)
  tidy(project)
  return { removed: bin, released }
}

/**
 * File assets in a bin, or (`binId` null) at the top of the pool. All or none: an unknown asset
 * or bin refuses the whole move. Reports which actually moved — the rest were already there.
 */
export function moveAssetsToBin(
  project: Project,
  assetIds: readonly string[],
  binId: string | null
): { moved: string[]; alreadyThere: string[]; bin: Bin | null } | { error: string } {
  if (assetIds.length === 0) return { error: 'Name at least one asset to move.' }
  const bin = binId === null ? null : binsOf(project).find((candidate) => candidate.id === binId)
  if (bin === undefined) return { error: `No bin has the id "${binId}". ${listed(project)}` }
  const unknown = assetIds.filter((id) => !project.assets.some((asset) => asset.id === id))
  if (unknown.length > 0) return { error: `No asset has the id ${unknown.map((id) => `"${id}"`).join(', ')}. Nothing was moved.` }
  const moved: string[] = []
  const alreadyThere: string[] = []
  for (const asset of project.assets) {
    if (!assetIds.includes(asset.id)) continue
    const at = binOf(project, asset)?.id ?? null
    if (at === (bin?.id ?? null)) {
      alreadyThere.push(asset.id)
      continue
    }
    if (bin) asset.binId = bin.id
    else delete asset.binId
    moved.push(asset.id)
  }
  if (moved.length > 0) tidy(project)
  return { moved, alreadyThere, bin }
}

export interface BinGroup<T> {
  /** Null is the top of the pool: assets in no bin. */
  bin: Bin | null
  assets: T[]
}

/**
 * `assets` (already filtered and sorted by the caller) grouped for listing: one group per bin in
 * the order the bins were made, then the top of the pool. Every bin is a group even when nothing
 * in it survived a filter — an empty bin is still somewhere to drop things — and the top-of-pool
 * group is always last and always present.
 */
export function groupByBin<T extends Pick<Asset, 'binId'>>(project: Pick<Project, 'bins'>, assets: readonly T[]): BinGroup<T>[] {
  const groups: BinGroup<T>[] = binsOf(project).map((bin) => ({ bin, assets: [] }))
  const top: BinGroup<T> = { bin: null, assets: [] }
  for (const asset of assets) {
    const group = asset.binId ? groups.find((candidate) => candidate.bin?.id === asset.binId) : undefined
    ;(group ?? top).assets.push(asset)
  }
  return [...groups, top]
}
