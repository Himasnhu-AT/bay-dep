/**
 * Relinking: pointing an asset whose file has gone missing at the file where it is now.
 *
 * Three decisions, kept here so they run under the test suite:
 *
 * - **Which other missing files one relink finds.** Media moves as a folder far more often than
 *   file by file, so when "interview.mov" was in `/Old/Shoot` and is located in `/New/Shoot`,
 *   every other missing asset that was in `/Old/Shoot` is looked for under the same name in
 *   `/New/Shoot`. Only the same *original folder*: a missing file from elsewhere that happens to
 *   share a name is not a sibling.
 * - **Whether a located file is plausibly the same media.** A relink that swaps a 40-minute
 *   interview for a 3-second sting would silently re-time every clip that places it, because
 *   items keep their source offsets. So a different kind of media, or a duration that differs by
 *   more than a second and 5%, is reported; the panel asks before using an explicit pick and
 *   skips such a sibling.
 * - **What the project becomes.** The relinked asset is the freshly probed one (its measured
 *   duration, size, rate and sound are facts about the *new* file), keeping only what a person
 *   chose about the old one: its name and when it was added. It takes the probe's id — the id
 *   main now knows that path by, so a later import of the same file is recognised as already in
 *   the project — and every item that placed the old id is pointed at the new one. A new id
 *   also means nothing cached against the old one (a poster that failed, a media element that
 *   errored) can be served for the new file.
 */

import { allItems, type Asset, type AssetKind, type Project } from './project'

/** Everything before the last separator, or '' for a bare name. */
export function dirnameOf(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return cut <= 0 ? (cut === 0 ? path.slice(0, 1) : '') : path.slice(0, cut)
}

export function basenameOf(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return cut === -1 ? path : path.slice(cut + 1)
}

/** The separator a path uses, so a candidate is spelled the way its folder is. */
function separatorOf(path: string): string {
  return path.lastIndexOf('\\') > path.lastIndexOf('/') ? '\\' : '/'
}

/** The kinds a file can be relinked for. A LUT, font or `.brf` lives in the project, not on disk. */
export function canRelink(asset: Asset): boolean {
  return asset.path !== null && (['video', 'audio', 'image', 'gif', 'html'] as AssetKind[]).includes(asset.kind)
}

/**
 * Where each missing sibling of a located asset would be, if its folder moved as a whole: same
 * file name, in the folder the located file was found in. Excludes the located asset itself.
 *
 * A candidate path that is already claimed is skipped: the file the person just chose (they may
 * have picked `vertical.mp4` for `clipA.mp4`, and the sibling pass would then relink the missing
 * `vertical.mp4` onto the same file), a path another asset in the project already holds, or one an
 * earlier candidate took. Two assets relinked onto one file become one asset — `applyRelinks`
 * retires the second — so a sibling guess must never do that; only an explicit pick may.
 */
export function siblingCandidates(
  missing: readonly Asset[],
  located: { assetId: string; oldPath: string; newPath: string },
  /** Paths held by assets in the project now; the located asset's new path is always claimed. */
  held: readonly (string | null)[] = []
): { assetId: string; path: string }[] {
  const oldDir = dirnameOf(located.oldPath)
  const newDir = dirnameOf(located.newPath)
  if (oldDir === newDir) return []
  const sep = separatorOf(located.newPath)
  const claimed = new Set<string>([located.newPath])
  for (const path of held) if (path) claimed.add(path)
  const out: { assetId: string; path: string }[] = []
  for (const asset of missing) {
    if (asset.id === located.assetId || !asset.path || !canRelink(asset)) continue
    if (dirnameOf(asset.path) !== oldDir) continue
    const path = `${newDir}${sep}${basenameOf(asset.path)}`
    if (claimed.has(path)) continue
    claimed.add(path)
    out.push({ assetId: asset.id, path })
  }
  return out
}

/** The noun for each kind a relink can meet, with its article. */
const KIND_PHRASE: Record<AssetKind, string> = {
  video: 'a video',
  audio: 'an audio',
  image: 'an image',
  gif: 'an image',
  text: 'a text',
  html: 'an HTML composition',
  brf: 'a motion graphic',
  lut: 'a LUT',
  font: 'a font',
  adjustment: 'an adjustment layer'
}

/**
 * Why a probed file is probably not the media an asset was, or null when it plausibly is.
 * The sentence is shown to the person deciding whether to use it anyway.
 */
export function relinkMismatch(asset: Asset, probed: Asset): string | null {
  if (probed.error) return `${basenameOf(probed.path ?? '')} could not be read: ${probed.error}`
  if (KIND_PHRASE[asset.kind] !== KIND_PHRASE[probed.kind]) {
    return `“${asset.name}” was ${KIND_PHRASE[asset.kind]} file, and this is ${KIND_PHRASE[probed.kind]} file.`
  }
  if (asset.hasVideo && !probed.hasVideo) return `“${asset.name}” had a picture, and this file has none.`
  if (asset.hasAudio && !probed.hasAudio) return `“${asset.name}” had sound, and this file has none.`
  const difference = Math.abs(asset.durationUs - probed.durationUs)
  const allowed = Math.max(1_000_000, asset.durationUs * 0.05)
  if (difference > allowed) {
    return `“${asset.name}” was ${seconds(asset.durationUs)} long, and this file is ${seconds(probed.durationUs)}.`
  }
  return null
}

function seconds(us: number): string {
  const s = us / 1_000_000
  return s >= 60 ? `${Math.floor(s / 60)} min ${Math.round(s % 60)} s` : `${Math.round(s * 10) / 10} s`
}

/** The asset a relink leaves in the project: the probe's facts, the person's name and date. */
export function relinkedAsset(old: Asset, probed: Asset): Asset {
  return { ...probed, name: old.name, createdAt: old.createdAt }
}

/**
 * Applies relinks to a project draft (the store runs this inside one `edit()`): each old asset is
 * replaced by its relinked one and every item that placed it now places the new id. When the
 * project already holds the new id — the file had also been imported on its own — the old asset
 * is simply retired and its items move to the one already there. Returns how many items moved.
 */
export function applyRelinks(project: Project, relinks: readonly { assetId: string; replacement: Asset }[]): number {
  let moved = 0
  for (const { assetId, replacement } of relinks) {
    const index = project.assets.findIndex((asset) => asset.id === assetId)
    const old = project.assets[index]
    if (!old) continue
    const next = relinkedAsset(old, replacement)
    const already = project.assets.some((asset) => asset.id === next.id && asset.id !== assetId)
    if (already) project.assets.splice(index, 1)
    else project.assets[index] = next
    if (next.id === assetId) continue
    for (const timeline of project.timelines) {
      for (const item of allItems(timeline)) {
        if (item.assetId !== assetId) continue
        item.assetId = next.id
        moved += 1
      }
    }
  }
  return moved
}
