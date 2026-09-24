/**
 * What the Media panel does to the project, apart from drawing it.
 *
 * Every action here that mirrors an agent tool calls the tool's own function — `detectBeats`,
 * `addCaptions`, `transcribeSource` — rather than a second copy of it, so the panel and an agent
 * cannot disagree about what "detect beats" or "import captions" means. They are called directly,
 * not through `executeToolCall`: a person's click is not an agent's call, so it neither waits on
 * the agent's approval gate nor shows up on a turn's change card as the agent's edit.
 */

import type { Asset } from '@shared/project'
import { usToFrames, timelineDuration } from '@shared/project'
import { captionsToSrt } from '@shared/caption-export'
import { canRelink, relinkMismatch, siblingCandidates } from '@shared/relink'
import { detectBeats } from '@/mcp/beats'
import { addCaptions } from '@/mcp/captions'
import { selectTimeline, useEditor } from '@/store/editor'
import { bay, call } from './bay'

const state = (): ReturnType<typeof useEditor.getState> => useEditor.getState()

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * Places an asset — or the part of it between `inUs` and `outUs` — at `atFrame` (the playhead
 * when omitted), as one undo step, selects the new clip and returns its id.
 */
export function placeAssetRange(asset: Asset, options: { atFrame?: number; inUs?: number; outUs?: number } = {}): string | null {
  const s = state()
  const timeline = selectTimeline(s)
  if (!timeline) return null
  const inUs = Math.max(0, options.inUs ?? 0)
  const outUs = options.outUs ?? asset.durationUs
  const trimmed = asset.durationUs > 0 && (inUs > 0 || outUs < asset.durationUs) && outUs > inUs
  let placed: string | null = null
  s.transact(() => {
    placed = s.placeAsset(asset.id, options.atFrame)
    if (placed && trimmed) {
      s.patchItem(placed, { sourceStartUs: inUs, durationInFrames: Math.max(1, usToFrames(outUs - inUs, timeline.fps)) })
    }
  })
  if (placed) s.select([placed])
  return placed
}

/** The frame after everything on the active timeline — where "Append" puts a clip. */
export function endOfTimeline(): number {
  const timeline = selectTimeline(state())
  return timeline ? timelineDuration(timeline) : 0
}

/** Runs `detect_beats` on an asset and says what it found. */
export async function detectBeatsFor(asset: Asset): Promise<void> {
  try {
    const result = (await detectBeats({ assetId: asset.id })) as { bpm: number; beats: unknown[]; confidence: number }
    const count = result.beats.length
    state().notify(
      result.confidence < 0.3 || count === 0
        ? `No steady beat found in “${asset.name}”.`
        : `Found ${count} beats in “${asset.name}” at ${Math.round(result.bpm)} BPM. Clips now snap to them.`
    )
  } catch (error) {
    state().notify(messageOf(error), 'error')
  }
}

/** Parses caption text through `add_captions` and says where it went. */
export function placeCaptions(file: { name: string; text: string }): void {
  try {
    const result = addCaptions({ srt: file.text }) as { captions: number; trackName: string; droppedEmptyCues?: number }
    const dropped = result.droppedEmptyCues ? ` ${result.droppedEmptyCues} empty cue(s) were skipped.` : ''
    state().notify(`Added ${result.captions} captions from ${file.name} on ${result.trackName}.${dropped} ⌘Z to undo.`)
  } catch (error) {
    state().notify(`${file.name}: ${messageOf(error)}`, 'error')
  }
}

export async function importCaptionsDialog(): Promise<void> {
  const file = await call('Import captions', (api) => api.media.openCaptions())
  if (file) placeCaptions(file)
}

/** Whether the active timeline has captions to export. */
export function hasCaptions(): boolean {
  const s = state()
  const timeline = selectTimeline(s)
  return Boolean(timeline && captionsToSrt(s.project, timeline))
}

export async function exportCaptions(): Promise<void> {
  const s = state()
  const timeline = selectTimeline(s)
  const srt = timeline ? captionsToSrt(s.project, timeline) : null
  if (!srt) {
    s.notify('This timeline has no captions to export. Import an .srt or .vtt first.', 'error')
    return
  }
  const written = await call('Export captions', (api) => api.media.saveCaptions(s.project.name, srt))
  if (written) s.notify(`Captions saved to ${written}.`)
}

/**
 * Locate one missing file, then look for its missing siblings in the folder it was found in.
 *
 * `confirm` is asked only when the chosen file looks like different media (`relinkMismatch`);
 * a sibling that looks different is skipped rather than asked about, because a question per file
 * for a whole folder is a dialog nobody reads. Everything relinked is one undo step.
 */
export async function locateAndRelink(
  asset: Asset,
  missing: readonly Asset[],
  confirm: (message: string) => Promise<boolean>
): Promise<void> {
  const api = bay()
  if (!api || !asset.path || !canRelink(asset)) return
  const chosen = await call('Locate', (client) => client.media.locate(asset.name, asset.path))
  if (!chosen) return
  const [probed] = (await call('Locate', (client) => client.media.importPaths([chosen]))) ?? []
  if (!probed) return
  const problem = relinkMismatch(asset, probed.asset)
  if (probed.asset.error) {
    state().notify(problem ?? `${chosen} could not be read.`, 'error')
    return
  }
  if (problem && !(await confirm(`${problem} Use it anyway?`))) return

  const relinks = [{ assetId: asset.id, replacement: probed.asset }]
  const candidates = siblingCandidates(missing, { assetId: asset.id, oldPath: asset.path, newPath: chosen })
  let skipped = 0
  if (candidates.length > 0) {
    const sizes = (await call('Relink', (client) => client.media.stat(candidates.map((c) => c.path)))) ?? []
    const present = candidates.filter((_, index) => typeof sizes[index] === 'number')
    const found = present.length > 0 ? ((await call('Relink', (client) => client.media.importPaths(present.map((c) => c.path)))) ?? []) : []
    present.forEach((candidate, index) => {
      const sibling = missing.find((a) => a.id === candidate.assetId)
      const replacement = found[index]?.asset
      if (!sibling || !replacement) return
      if (relinkMismatch(sibling, replacement)) skipped += 1
      else relinks.push({ assetId: sibling.id, replacement })
    })
  }
  state().relinkAssets(relinks)
  const others = relinks.length - 1
  state().notify(
    `Relinked “${asset.name}”` +
      (others > 0 ? ` and ${others} other file${others === 1 ? '' : 's'} from the same folder` : '') +
      '.' +
      (skipped > 0 ? ` ${skipped} file${skipped === 1 ? '' : 's'} with the same name looked different and ${skipped === 1 ? 'was' : 'were'} left for you to locate.` : '') +
      ' ⌘Z to undo.'
  )
}
