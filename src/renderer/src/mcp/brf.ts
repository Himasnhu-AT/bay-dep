/**
 * `write_brf` and `read_brf`: motion graphics as a `.brf` module (`@shared/brf-code`).
 *
 * The source lives in the project, on its asset, so writing one is an ordinary edit — one undo
 * step, part of an agent turn's diff and revert — unlike `write_composition`, which writes a file
 * the project cannot take back.
 *
 * Nothing changes until the module has compiled and run cleanly across its whole duration in its
 * worker: an error an agent could have caught before placing — a typo, a `.map` on undefined at
 * frame 45 — comes back as a refusal with its line and frame, not as a placeholder on the
 * timeline the first time someone scrubs there.
 */

import { brfCodeAssetFields } from '@shared/brf'
import { resolveVariables } from '@shared/composition'
import { allItems, usToFrames, type Asset } from '@shared/project'
import { brfRuntime } from '@/engine/brfCode'
import { newId } from '@/store/editor'
import { dryRun } from '@/store/dry-run'
import { fail, project, resolveAsset, store, timeline, type Handlers } from './helpers'
import { placeAsset } from './write'

function placementsOf(assetId: string): number {
  return project().timelines.reduce(
    (n, tl) => n + allItems(tl).filter((item) => item.assetId === assetId).length,
    0
  )
}

function summary(asset: Asset): Record<string, unknown> {
  return {
    assetId: asset.id,
    name: asset.name,
    durationSeconds: asset.durationUs / 1_000_000,
    durationFrames: usToFrames(asset.durationUs, timeline().fps),
    size: asset.width && asset.height ? [asset.width, asset.height] : 'the timeline canvas',
    vars: Object.fromEntries((asset.compositionVariables ?? []).map((v) => [v.id, v.default]))
  }
}

export async function writeBrf(args: Record<string, unknown>): Promise<Record<string, unknown>> {
  const code = args.code
  if (typeof code !== 'string' || code.trim().length === 0) {
    fail('`code` must be the module source: `export default ({ t }) => <scene duration={4}>…</scene>`.')
  }
  const existing = args.assetId !== undefined ? resolveAsset(String(args.assetId)) : null
  if (existing && existing.kind !== 'brf') {
    fail(
      `${existing.name} is a ${existing.kind} asset, not a .brf one, so it has no source to replace. ` +
        `Omit assetId to create a new .brf asset.`
    )
  }
  if (existing && args.atFrame !== undefined) {
    fail('atFrame places a new asset; with assetId the source is replaced where it already is. Drop one of them.')
  }

  const tl = timeline()
  // Checked with the vars a placement of the replaced asset actually uses, so a module that only
  // breaks on the words someone typed into the Inspector is caught too.
  const firstPlacement = existing ? allItems(tl).find((item) => item.assetId === existing.id) : undefined
  const overrides = existing && firstPlacement
    ? resolveVariables({ variables: existing.compositionVariables ?? [] }, firstPlacement.variables)
    : undefined
  const checked = await brfRuntime.verify(code, tl.fps, tl.width, tl.height, overrides)
  if (!checked.ok) {
    fail(`The .brf ${checked.error}\nNothing was changed. Fix it and call write_brf again.`)
  }

  if (existing) {
    store().editAsset(existing.id, {
      brfCode: { source: code, meta: checked.meta },
      ...(typeof args.name === 'string' && args.name ? { name: args.name } : {})
    })
    return { ...summary(resolveAsset(existing.id)), replaced: true, placements: placementsOf(existing.id) }
  }

  const asset: Asset = {
    id: newId('ast'),
    name: typeof args.name === 'string' && args.name ? args.name : 'Motion',
    path: null,
    posterPath: null,
    waveformPath: null,
    createdAt: Date.now(),
    ...brfCodeAssetFields(code, checked.meta)
  }

  if (args.atFrame === undefined) {
    store().addAssets([asset])
    return { ...summary(asset), placed: false, next: 'place_asset with this assetId, or call again with atFrame.' }
  }

  // Creating and placing is one thing the agent asked for, so it is one undo step — and it must
  // be all or nothing. A placement refused after the asset was added would leave an orphan asset
  // and an undo step for it; so the pair is rehearsed first, which restores everything, and only
  // run for real once it is known to succeed. A refusal surfaces from the rehearsal unchanged.
  const where = {
    assetId: asset.id,
    atFrame: args.atFrame,
    ...(args.trackId !== undefined ? { trackId: args.trackId } : {})
  }
  const both = (): Record<string, unknown> => {
    store().addAssets([asset])
    return placeAsset(where)
  }
  dryRun(both)
  let placed: Record<string, unknown> = {}
  store().transact(() => {
    placed = both()
  })
  return { ...summary(asset), placed: true, ...placed }
}

export function readBrf(args: Record<string, unknown>): Record<string, unknown> {
  const asset = resolveAsset(String(args.assetId))
  if (asset.kind !== 'brf' || asset.brfCode === undefined) {
    fail(
      `${asset.name} is ${asset.kind === 'brf' ? 'a .brf scene document with no source' : `a ${asset.kind} asset, not a .brf one`}.` +
        (asset.kind === 'html' ? ' Read an HTML composition with read_composition.' : '')
    )
  }
  return { ...summary(asset), placements: placementsOf(asset.id), code: asset.brfCode }
}

export const handlers: Handlers = {
  write_brf: (args) => writeBrf(args),
  read_brf: (args) => readBrf(args)
}
