/**
 * What the user attached to a message, turned into what a model can look at.
 *
 * Every file the agent's runtime reads for an attachment is one this module wrote, into
 * `<userData>/agent-attachments/<turn>/` — never a path the renderer named, except a project
 * asset's, and that only after `isAllowed` (the `bay://` allowlist) says the project holds it.
 * The folder is bay's: removed when the conversation is disposed and swept at startup, because a
 * pasted screenshot is the user's content and has no business outliving the conversation.
 *
 * Out of it come PNG and JPEG only, the two types every runtime takes:
 *
 * - An **image** is kept byte for byte when it is already a PNG or JPEG of at most
 *   `MAX_IMAGE_EDGE` on its long side and small enough to send; anything else — WebP, a GIF's
 *   first frame, a 6000px photo — is re-encoded by ffmpeg at that bound. A large image costs the
 *   model tokens in proportion to its pixels and gains it nothing past this size.
 * - A **video** becomes one contact sheet: frames sampled the way `frame_grid` samples (the
 *   middle of equal slices, `gridFrames`) and tiled in `frame_grid`'s layout (`gridLayout`),
 *   one JPEG under `MAX_GRID_EDGE`. bay's ffmpeg has no `drawtext`, so the frames carry no
 *   labels; their times are said in the text instead, in reading order.
 *
 * No `electron` here: the tools and the allowlist are passed in, so all of it runs under
 * `pnpm test` against the real ffmpeg.
 */

import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { copyFile, open, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { gridFrames, gridLayout, MAX_GRID_EDGE, type GridLayout } from '@shared/frame-grid'
import { sniffImage, type AgentAttachmentInput, type AttachmentImageType } from '@shared/agent-attachments'
import type { FfprobeOutput } from '../ffmpeg/probe'
import { run } from '../ffmpeg/ffmpeg'

/** The folder under `userData`. */
export const ATTACHMENTS_FOLDER = 'agent-attachments'
/** An image's long side past which it is scaled down. */
export const MAX_IMAGE_EDGE = 2000
/**
 * Past this an image is re-encoded as JPEG. The Messages API refuses an image over 5 MB of
 * base64, which is 3.75 MB of bytes; a 2000px screenshot as PNG can be more than that.
 */
export const MAX_SENT_IMAGE_BYTES = 3_500_000
/** Most frames on one contact sheet. */
export const MAX_SHEET_CELLS = 12

export interface MediaToolPaths {
  ffmpeg: string
  ffprobe: string
}

/** One file the runtime will attach, and the line of text that describes it. */
export interface PreparedAttachment {
  path: string
  mediaType: 'image/png' | 'image/jpeg'
  note: string
}

export interface PrepareOptions {
  /** `<userData>/agent-attachments`. */
  root: string
  /** Names this turn's folder. A fresh UUID when omitted. */
  turn?: string
  tools: MediaToolPaths
  /** The `bay://` allowlist: whether a project asset's path may be read. */
  isAllowed: (path: string) => boolean
}

/** Remove every attachment folder. For dispose and for startup; never throws. */
export function sweepAttachments(root: string): void {
  try {
    rmSync(root, { recursive: true, force: true })
  } catch {
    // A folder that cannot be removed now is removed at the next start.
  }
}

/** `width`×`height` scaled to fit `max` on its long side, or unchanged when it already does. */
export function fitWithin(width: number, height: number, max: number): { width: number; height: number } {
  const long = Math.max(width, height)
  if (long <= max) return { width, height }
  const scale = max / long
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/** `83.25` → `1:23.3`. The times in a contact sheet's note. */
export function clockTime(seconds: number): string {
  const tenths = Math.round(Math.max(0, seconds) * 10)
  const minutes = Math.floor(tenths / 600)
  const rest = (tenths - minutes * 600) / 10
  return `${minutes}:${rest.toFixed(1).padStart(4, '0')}`
}

export interface SheetPlan {
  /** Seconds into the source, one per cell, ascending. */
  times: number[]
  layout: GridLayout
}

/**
 * Which moments a video's contact sheet shows and how they tile. Two frames a second at most —
 * a four-second clip gets eight, not twelve near-identical ones — and `frame_grid`'s sampling
 * and layout, on milliseconds rather than timeline frames.
 */
export function contactSheetPlan(durationSeconds: number, width: number, height: number): SheetPlan {
  const ms = Math.max(1, Math.floor(durationSeconds * 1000))
  const cells = Math.max(1, Math.min(MAX_SHEET_CELLS, Math.ceil(durationSeconds * 2)))
  const times = gridFrames(0, ms - 1, cells).map((m) => m / 1000)
  const layout = gridLayout(times.length, width > 0 && height > 0 ? width / height : 16 / 9, MAX_GRID_EDGE)
  return { times, layout }
}

/**
 * ffmpeg's arguments for a contact sheet: one input per moment, each seeked on the input side
 * (fast on a long file — no decoding from the start), its first frame scaled into the cell and
 * letterboxed, then concatenated and tiled.
 */
export function contactSheetArgs(source: string, plan: SheetPlan, output: string): string[] {
  const { columns, rows, cellWidth, cellHeight } = plan.layout
  const inputs = plan.times.flatMap((t) => ['-ss', t.toFixed(3), '-i', source])
  const cells = plan.times.map(
    (_t, i) =>
      `[${i}:v:0]trim=end_frame=1,setpts=PTS-STARTPTS,scale=${cellWidth}:${cellHeight}:force_original_aspect_ratio=decrease,` +
      `pad=${cellWidth}:${cellHeight}:(ow-iw)/2:(oh-ih)/2:black,setsar=1,format=yuv420p[c${i}]`
  )
  const joined = `${plan.times.map((_t, i) => `[c${i}]`).join('')}concat=n=${plan.times.length}:v=1:a=0,tile=${columns}x${rows}[sheet]`
  return [
    '-v', 'error', '-nostdin', '-y',
    ...inputs,
    '-filter_complex', [...cells, joined].join(';'),
    '-map', '[sheet]',
    '-frames:v', '1',
    '-q:v', '3',
    output
  ]
}

/** The filter graph an image is re-encoded through. */
export function imageScaleFilter(width: number, height: number): string {
  return `scale=${width}:${height}`
}

async function probeFile(tools: MediaToolPaths, path: string): Promise<FfprobeOutput> {
  const { stdout } = await run(tools.ffprobe, ['-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', path])
  return JSON.parse(stdout) as FfprobeOutput
}

function hash(data: Uint8Array | string): string {
  return createHash('sha256').update(data).digest('hex').slice(0, 32)
}

async function headBytes(path: string, length = 16): Promise<Uint8Array> {
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

/**
 * One image, from a file bay wrote or a project asset, to a PNG or JPEG in `dir` named by its
 * content. Returns the prepared file and its note.
 */
async function prepareImage(
  source: string,
  type: AttachmentImageType | null,
  key: string,
  name: string,
  index: number,
  dir: string,
  tools: MediaToolPaths,
  assetNote: string
): Promise<PreparedAttachment> {
  const probed = await probeFile(tools, source).catch(() => null)
  const video = probed?.streams?.find((s) => s.codec_type === 'video')
  if (!video?.width || !video.height) throw new Error(`“${name}” could not be read as an image.`)
  const size = (await stat(source)).size
  const fit = fitWithin(video.width, video.height, MAX_IMAGE_EDGE)
  const scaled = fit.width !== video.width || fit.height !== video.height
  const describe = (w: number, h: number): string =>
    `Image ${index}: “${name}” (${video.width}×${video.height}${scaled ? `, sent scaled to ${w}×${h}` : ''})${assetNote}.`

  if ((type === 'png' || type === 'jpeg') && !scaled && size <= MAX_SENT_IMAGE_BYTES) {
    const out = join(dir, `${key}.${type === 'png' ? 'png' : 'jpg'}`)
    if (!existsSync(out)) await copyFile(source, out)
    return { path: out, mediaType: type === 'png' ? 'image/png' : 'image/jpeg', note: describe(fit.width, fit.height) }
  }

  // A JPEG stays a JPEG; anything that may carry transparency becomes a PNG — unless that PNG is
  // too large to send, when it becomes a JPEG after all.
  const encode = async (as: 'png' | 'jpg'): Promise<string> => {
    const out = join(dir, `${key}-${fit.width}x${fit.height}.${as}`)
    if (!existsSync(out)) {
      await run(tools.ffmpeg, [
        '-v', 'error', '-nostdin', '-y',
        '-i', source,
        '-frames:v', '1',
        '-vf', imageScaleFilter(fit.width, fit.height),
        ...(as === 'jpg' ? ['-q:v', '3'] : []),
        out
      ])
    }
    return out
  }
  let out = await encode(type === 'jpeg' ? 'jpg' : 'png')
  if (out.endsWith('.png') && (await stat(out)).size > MAX_SENT_IMAGE_BYTES) out = await encode('jpg')
  return { path: out, mediaType: out.endsWith('.png') ? 'image/png' : 'image/jpeg', note: describe(fit.width, fit.height) }
}

async function prepareVideo(
  source: string,
  key: string,
  name: string,
  index: number,
  dir: string,
  tools: MediaToolPaths,
  assetNote: string
): Promise<PreparedAttachment> {
  const probed = await probeFile(tools, source).catch(() => null)
  const video = probed?.streams?.find((s) => s.codec_type === 'video' && s.disposition?.attached_pic !== 1)
  if (!probed || !video?.width || !video.height) throw new Error(`“${name}” has no video in it that ffmpeg can read.`)
  const duration = Number(probed.format?.duration ?? video.duration ?? 0)
  const seconds = Number.isFinite(duration) && duration > 0 ? duration : 0
  const hasAudio = (probed.streams ?? []).some((s) => s.codec_type === 'audio')
  const plan = contactSheetPlan(seconds, video.width, video.height)
  const out = join(dir, `sheet-${key}.jpg`)
  if (!existsSync(out)) await run(tools.ffmpeg, contactSheetArgs(source, plan, out))
  const { columns, rows } = plan.layout
  const frames = plan.times.length
  const note =
    `Video ${index}: “${name}” (${clockTime(seconds)} long, ${video.width}×${video.height}${hasAudio ? ', with sound you cannot hear' : ''})${assetNote}. ` +
    `It is attached as one contact sheet of ${frames} frame${frames === 1 ? '' : 's'}` +
    (frames > 1 ? ` in a ${columns}×${rows} grid, read left to right then top to bottom, at ${plan.times.map(clockTime).join(', ')}.` : ` at ${clockTime(plan.times[0] ?? 0)}.`)
  return { path: out, mediaType: 'image/jpeg', note }
}

/**
 * Write every attachment of one message into its turn's folder. All or nothing: the first one
 * that cannot be prepared refuses the message, naming it, and the folder is removed — a message
 * the user meant to carry three pictures must not reach the model with two.
 */
export async function prepareAttachments(
  inputs: readonly AgentAttachmentInput[],
  options: PrepareOptions
): Promise<{ ok: true; attachments: PreparedAttachment[]; dir: string | null } | { ok: false; error: string }> {
  if (inputs.length === 0) return { ok: true, attachments: [], dir: null }
  const dir = join(options.root, options.turn ?? randomUUID())
  mkdirSync(dir, { recursive: true })
  const prepared: PreparedAttachment[] = []
  let images = 0
  let videos = 0
  try {
    for (const input of inputs) {
      const index = input.kind === 'image' ? ++images : ++videos
      if (input.source === 'asset') {
        // The one renderer-supplied path this accepts, and only one the project already serves.
        if (!options.isAllowed(input.path)) {
          throw new Error(`“${input.name}” is not a file this project holds, so it cannot be attached. Drag it from the media bin, or attach the file itself.`)
        }
        let info: ReturnType<typeof statSync>
        try {
          info = statSync(input.path)
        } catch {
          throw new Error(`“${input.name}” is missing from disk (${input.path}). Relink it, or attach another file.`)
        }
        const assetNote = `, the project asset ${input.assetId}`
        // Keyed by the file's identity rather than its bytes: an asset can be gigabytes.
        const key = hash(`${input.path}\0${info.size}\0${info.mtimeMs}`)
        prepared.push(
          input.kind === 'image'
            ? await prepareImage(input.path, sniffImage(await headBytes(input.path)), key, input.name, index, dir, options.tools, assetNote)
            : await prepareVideo(input.path, key, input.name, index, dir, options.tools, assetNote)
        )
        continue
      }
      const key = hash(input.data)
      // The source bytes under a name nothing reads but this function, removed once converted.
      const staged = join(dir, `${key}.source`)
      await writeFile(staged, input.data)
      try {
        prepared.push(
          input.kind === 'image'
            ? await prepareImage(staged, sniffImage(input.data), key, input.name, index, dir, options.tools, '')
            : await prepareVideo(staged, key, input.name, index, dir, options.tools, '')
        )
      } finally {
        await rm(staged, { force: true })
      }
    }
  } catch (error) {
    await rm(dir, { recursive: true, force: true })
    return { ok: false, error: `The attachments could not be prepared: ${(error as Error).message}` }
  }
  return { ok: true, attachments: prepared, dir }
}

/**
 * The text the model receives: what the user typed, then one line per attachment in the order
 * the pictures arrive. Unchanged when there are none.
 */
export function withAttachmentNotes(text: string, attachments: readonly PreparedAttachment[]): string {
  if (attachments.length === 0) return text
  const lines = attachments.map((a) => `- ${a.note}`)
  return `${text}\n\nAttached by the user (the attached pictures, in this order):\n${lines.join('\n')}`
}
