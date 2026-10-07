/**
 * `organize_assets`: bins in the media pool, for the agent.
 *
 * One operation per call, so a call is one undo step that reads as one thing in the history.
 * Every operation is the store's own action (`@shared/bins` underneath) — the Media Pool's
 * buttons and this tool cannot disagree about what a bin is.
 */

import { binOf, binsOf, findBin } from '@shared/bins'
import type { Bin } from '@shared/project'
import { fail, project, resolveAsset, store, type Handlers } from './helpers'

/** The pool's bins with what is in each — what the next call would need to read. */
function poolBins(): { id: string; name: string; assetIds: string[] }[] {
  const p = project()
  return binsOf(p).map((bin) => ({
    id: bin.id,
    name: bin.name,
    assetIds: p.assets.filter((asset) => binOf(p, asset)?.id === bin.id).map((asset) => asset.id)
  }))
}

function knownBin(idOrName: string): Bin {
  const bin = findBin(project(), idOrName)
  if (bin) return bin
  const bins = binsOf(project())
  fail(
    bins.length === 0
      ? `No bin is called or has the id "${idOrName}": this project has no bins yet. Make one with bin: "<name>".`
      : `No bin is called or has the id "${idOrName}". The bins are: ${bins.map((b) => `“${b.name}” (${b.id})`).join(', ')}.`
  )
}

/** Run one store action as one undo step and unwrap its refusal. */
function act<T>(run: () => T | { error: string }): T {
  let outcome: T | { error: string } | null = null
  store().transact(() => {
    outcome = run()
  })
  const result = outcome as T | { error: string } | null
  if (result === null) fail('Nothing was changed.')
  if (typeof result === 'object' && result !== null && 'error' in result) fail((result as { error: string }).error)
  return result as T
}

export function organizeAssets(args: Record<string, unknown>): Record<string, unknown> {
  const operations = [
    args.assetIds !== undefined || args.bin !== undefined || args.toTopOfPool !== undefined,
    args.renameBin !== undefined,
    args.removeBin !== undefined
  ].filter(Boolean).length
  if (operations === 0) {
    fail('Nothing to do: pass assetIds with bin to file assets (or with toTopOfPool: true to unfile them), bin alone to make a bin, renameBin, or removeBin.')
  }
  if (operations > 1) {
    fail('One thing per call: filing assets (assetIds with bin or toTopOfPool), renameBin and removeBin are separate calls, so each is its own undo step.')
  }

  if (args.renameBin !== undefined) {
    const request = args.renameBin as { bin?: unknown; name?: unknown }
    const bin = knownBin(String(request.bin ?? ''))
    const renamed = act(() => store().renameBin(bin.id, String(request.name ?? '')))
    return { renamed: { id: renamed.bin.id, was: renamed.was, name: renamed.bin.name }, bins: poolBins() }
  }

  if (args.removeBin !== undefined) {
    const bin = knownBin(String(args.removeBin))
    const removed = act(() => store().removeBin(bin.id))
    return {
      removed: { id: removed.removed.id, name: removed.removed.name },
      backAtTopOfPool: removed.released,
      note: 'The media that was in the bin is still in the project.',
      bins: poolBins()
    }
  }

  const ids = Array.isArray(args.assetIds) ? [...new Set(args.assetIds.map((id) => resolveAsset(String(id)).id))] : []
  if (args.assetIds !== undefined && ids.length === 0) fail('assetIds is empty. Name the assets to file, from browse_assets.')

  const out = args.toTopOfPool === true
  if (out && args.bin !== undefined) fail('bin and toTopOfPool are two different places. Pass one: bin to file the assets there, toTopOfPool: true to take them out of any bin.')

  if (ids.length === 0) {
    // `bin` alone: an empty bin of that name.
    if (out || args.bin === undefined) fail('toTopOfPool needs assetIds to say which assets leave their bin.')
    const name = String(args.bin)
    const existing = findBin(project(), name)
    if (existing) fail(`There is already a bin called “${existing.name}” (${existing.id}). Pass assetIds with it to file assets there.`)
    const made = act(() => store().createBin(name))
    return { created: { id: made.bin.id, name: made.bin.name }, bins: poolBins() }
  }

  if (!out && args.bin === undefined) fail('Say where the assets go: bin with a bin’s id or name (a new name makes the bin), or toTopOfPool: true to take them out of any bin.')

  // The bin is made, if it has to be, in the same undo step as the move into it.
  let created: Bin | null = null
  const moved = act(() => {
    if (out) return store().moveAssetsToBin(ids, null)
    const name = String(args.bin)
    let target = findBin(project(), name)
    if (!target) {
      const made = store().createBin(name)
      if ('error' in made) return made
      target = created = made.bin
    }
    return store().moveAssetsToBin(ids, target.id)
  })
  if (moved.moved.length === 0 && !created) {
    fail(
      moved.bin
        ? `${ids.length === 1 ? 'That asset is' : 'Those assets are'} already in “${moved.bin.name}”. Nothing was moved.`
        : `${ids.length === 1 ? 'That asset is' : 'Those assets are'} not in any bin. Nothing was moved.`
    )
  }
  return {
    moved: moved.moved,
    ...(moved.alreadyThere.length > 0 ? { alreadyThere: moved.alreadyThere } : {}),
    bin: moved.bin ? { id: moved.bin.id, name: moved.bin.name } : null,
    ...(created ? { createdBin: true } : {}),
    bins: poolBins()
  }
}

export const handlers: Handlers = {
  organize_assets: (args) => organizeAssets(args)
}
