/**
 * Pictures and video the user attaches to a message for the in-app agent.
 *
 * The renderer never holds a path for what the user pasted or dropped, and main never takes a
 * path from the renderer for anything that is not already one of the project's assets — so an
 * attachment crosses IPC as **bytes** (pasted, dropped, picked) or as **an asset** (dragged from
 * the media bin, whose path main checks against the same allowlist `bay://` serves from). Main
 * writes what the model will see into a folder of its own (`main/agent/attachments.ts`): images as
 * PNG or JPEG, a video as one contact-sheet JPEG plus a line of text naming each frame's time.
 *
 * Everything here is checked twice on purpose: the composer refuses early so the user is told at
 * once, and main refuses again because the renderer is not what enforces a limit.
 */

/** At most this many attachments on one message. */
export const MAX_ATTACHMENTS = 6
/** Per attachment, bytes as sent. */
export const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024

export type AttachmentImageType = 'png' | 'jpeg' | 'webp' | 'gif'

/** The image types an attachment may be, by MIME type. Anything else is refused by name. */
export const IMAGE_MIME: Readonly<Record<string, AttachmentImageType>> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/webp': 'webp',
  'image/gif': 'gif'
}

/**
 * Video a user may attach, by extension, for when a drop carries no MIME type (a `.mkv` from
 * Finder often has none). The final word is main's: it probes the bytes, and a file with no
 * video stream is refused whatever it was called.
 */
export const VIDEO_EXTENSIONS: readonly string[] = ['mov', 'mp4', 'm4v', 'webm', 'mkv', 'avi', 'mts', 'm2ts', 'mpg', 'mpeg', 'ogv', '3gp']

/** The asset kinds that can be attached from the media bin. */
export const ATTACHABLE_ASSET_KINDS = ['image', 'gif', 'video'] as const
export type AttachableAssetKind = (typeof ATTACHABLE_ASSET_KINDS)[number]

/** One attachment as the renderer sends it. */
export type AgentAttachmentInput =
  /** Bytes the user pasted, dropped or picked. `mime` is a claim; main sniffs the bytes. */
  | { source: 'bytes'; kind: 'image' | 'video'; name: string; mime: string; data: Uint8Array }
  /** A project asset. `path` must be on main's media allowlist or it is refused. */
  | { source: 'asset'; kind: 'image' | 'video'; name: string; assetId: string; path: string }

/** What the transcript shows for an attachment: its name and a small picture. */
export interface AgentAttachmentView {
  kind: 'image' | 'video'
  name: string
  /** A `data:` or `bay://` URL for a thumbnail, or null when none could be made. */
  thumb: string | null
}

/** Which kind a picked or dropped file is, from its MIME type or extension — or why it is not one. */
export function classifyFile(name: string, mime: string, size: number): { ok: true; kind: 'image' | 'video' } | { ok: false; error: string } {
  if (size > MAX_ATTACHMENT_BYTES) {
    return { ok: false, error: `“${name}” is ${megabytes(size)} MB; an attachment can be at most ${megabytes(MAX_ATTACHMENT_BYTES)} MB.` }
  }
  if (size === 0) return { ok: false, error: `“${name}” is empty.` }
  if (IMAGE_MIME[mime.toLowerCase()]) return { ok: true, kind: 'image' }
  const extension = name.toLowerCase().split('.').pop() ?? ''
  if (mime.toLowerCase().startsWith('video/') || VIDEO_EXTENSIONS.includes(extension)) return { ok: true, kind: 'video' }
  if (mime.toLowerCase().startsWith('image/') || ['heic', 'tif', 'tiff', 'bmp', 'svg'].includes(extension)) {
    return { ok: false, error: `“${name}” is an image type the agent cannot take. Attach PNG, JPEG, WebP or GIF.` }
  }
  return { ok: false, error: `“${name}” is not an image or a video. Attach PNG, JPEG, WebP, GIF or a video file.` }
}

function megabytes(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)
}

/** What the bytes are, by their first bytes — never by what the sender called them. */
export function sniffImage(bytes: Uint8Array): AttachmentImageType | null {
  const at = (i: number): number => bytes[i] ?? -1
  if (at(0) === 0x89 && at(1) === 0x50 && at(2) === 0x4e && at(3) === 0x47 && at(4) === 0x0d && at(5) === 0x0a && at(6) === 0x1a && at(7) === 0x0a) return 'png'
  if (at(0) === 0xff && at(1) === 0xd8 && at(2) === 0xff) return 'jpeg'
  if (ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'webp'
  if (ascii(bytes, 0, 6) === 'GIF87a' || ascii(bytes, 0, 6) === 'GIF89a') return 'gif'
  return null
}

function ascii(bytes: Uint8Array, from: number, length: number): string {
  let out = ''
  for (let i = from; i < from + length; i += 1) out += String.fromCharCode(bytes[i] ?? 0)
  return out
}

const NAME_LIMIT = 200

/**
 * Checks what arrived over IPC before anything is written: the count, each one's shape, size and
 * type. Returns the attachments narrowed, or one sentence naming the first thing wrong — which
 * attachment, and what would be accepted instead.
 */
export function validateAttachments(value: unknown): { ok: true; attachments: AgentAttachmentInput[] } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, attachments: [] }
  if (!Array.isArray(value)) return { ok: false, error: 'Attachments must be a list.' }
  if (value.length > MAX_ATTACHMENTS) {
    return { ok: false, error: `${value.length} attachments is too many; a message can carry at most ${MAX_ATTACHMENTS}. Remove ${value.length - MAX_ATTACHMENTS}.` }
  }
  const out: AgentAttachmentInput[] = []
  for (const [index, raw] of value.entries()) {
    const which = `Attachment ${index + 1}`
    if (typeof raw !== 'object' || raw === null) return { ok: false, error: `${which} is not an attachment.` }
    const item = raw as Record<string, unknown>
    const kind = item['kind']
    if (kind !== 'image' && kind !== 'video') return { ok: false, error: `${which} must be an image or a video.` }
    const name = typeof item['name'] === 'string' && item['name'].trim() !== '' ? item['name'].slice(0, NAME_LIMIT) : `attachment ${index + 1}`
    if (item['source'] === 'bytes') {
      const data = item['data']
      if (!(data instanceof Uint8Array)) return { ok: false, error: `${which} (“${name}”) carries no bytes.` }
      if (data.byteLength === 0) return { ok: false, error: `${which} (“${name}”) is empty.` }
      if (data.byteLength > MAX_ATTACHMENT_BYTES) {
        return { ok: false, error: `${which} (“${name}”) is ${megabytes(data.byteLength)} MB; the limit is ${megabytes(MAX_ATTACHMENT_BYTES)} MB.` }
      }
      const mime = typeof item['mime'] === 'string' ? item['mime'] : ''
      if (kind === 'image' && sniffImage(data) === null) {
        return { ok: false, error: `${which} (“${name}”) is not a PNG, JPEG, WebP or GIF image${mime ? ` (it claimed ${mime})` : ''}.` }
      }
      out.push({ source: 'bytes', kind, name, mime, data })
      continue
    }
    if (item['source'] === 'asset') {
      const assetId = item['assetId']
      const path = item['path']
      if (typeof assetId !== 'string' || assetId === '') return { ok: false, error: `${which} (“${name}”) names no asset.` }
      if (typeof path !== 'string' || path === '') return { ok: false, error: `${which} (“${name}”) is an asset with no file.` }
      out.push({ source: 'asset', kind, name, assetId, path })
      continue
    }
    return { ok: false, error: `${which} (“${name}”) must be bytes or a project asset.` }
  }
  return { ok: true, attachments: out }
}
