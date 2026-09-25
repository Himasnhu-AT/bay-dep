/**
 * The composer's side of attachments: what the user added, before it is sent.
 *
 * A pasted or dropped file stays a `Blob` until send, when its bytes go to main
 * (`@shared/agent-attachments` says why bytes and not a path). A media-bin asset stays an id and
 * the path the project already holds, which main checks against its allowlist. Thumbnails are
 * made here, small, for the chips and for the message in the transcript.
 */

import {
  ATTACHABLE_ASSET_KINDS,
  classifyFile,
  MAX_ATTACHMENTS,
  type AgentAttachmentInput,
  type AgentAttachmentView
} from '@shared/agent-attachments'
import type { Asset } from '@shared/project'
import { bay } from './bridge'

export interface PendingAttachment {
  id: string
  kind: 'image' | 'video'
  name: string
  /** A `data:` or `bay://` URL; null until made, or when none could be. */
  thumb: string | null
  source: { type: 'file'; blob: Blob; mime: string } | { type: 'asset'; assetId: string; path: string }
}

let counter = 0
const nextId = (): string => `att-${Date.now().toString(36)}-${(counter += 1)}`

/** A picked, pasted or dropped file as an attachment, or the sentence saying why it cannot be one. */
export function pendingFromFile(file: File, fallbackName = 'Pasted image'): { ok: true; pending: PendingAttachment } | { ok: false; error: string } {
  const name = file.name && file.name !== 'image.png' ? file.name : `${fallbackName}.${(file.type.split('/')[1] ?? 'png').replace('jpeg', 'jpg')}`
  const kind = classifyFile(name, file.type, file.size)
  if (!kind.ok) return kind
  return { ok: true, pending: { id: nextId(), kind: kind.kind, name, thumb: null, source: { type: 'file', blob: file, mime: file.type } } }
}

/** A media-bin asset as an attachment — pictures and video only. */
export function pendingFromAsset(asset: Asset): { ok: true; pending: PendingAttachment } | { ok: false; error: string } {
  if (!(ATTACHABLE_ASSET_KINDS as readonly string[]).includes(asset.kind)) {
    return { ok: false, error: `“${asset.name}” is ${asset.kind === 'audio' ? 'audio' : `a ${asset.kind} asset`}; only pictures and video can be attached.` }
  }
  if (!asset.path) return { ok: false, error: `“${asset.name}” has no file to attach.` }
  return {
    ok: true,
    pending: {
      id: nextId(),
      kind: asset.kind === 'video' ? 'video' : 'image',
      name: asset.name,
      thumb: null,
      source: { type: 'asset', assetId: asset.id, path: asset.path }
    }
  }
}

/** How many of `incoming` fit beside `current`, and the sentence for the rest. */
export function roomFor(current: number, incoming: number): { take: number; error: string | null } {
  const take = Math.max(0, Math.min(incoming, MAX_ATTACHMENTS - current))
  return {
    take,
    error: take < incoming ? `A message can carry at most ${MAX_ATTACHMENTS} attachments; ${incoming - take} ${incoming - take === 1 ? 'was' : 'were'} left out.` : null
  }
}

const THUMB_EDGE = 160

function drawThumb(source: CanvasImageSource, width: number, height: number): string | null {
  if (!width || !height) return null
  const scale = Math.min(1, THUMB_EDGE / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const context = canvas.getContext('2d')
  if (!context) return null
  context.drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL('image/jpeg', 0.8)
}

async function videoThumb(blob: Blob): Promise<string | null> {
  const url = URL.createObjectURL(blob)
  const video = document.createElement('video')
  video.muted = true
  video.preload = 'auto'
  try {
    const ready = (event: string): Promise<void> =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timeout')), 5000)
        video.addEventListener(event, () => (clearTimeout(timer), resolve()), { once: true })
        video.addEventListener('error', () => (clearTimeout(timer), reject(new Error('error'))), { once: true })
      })
    video.src = url
    await ready('loadeddata')
    // A moment in, because frame zero of a lot of footage is black.
    video.currentTime = Math.min(1, (video.duration || 0) / 2)
    await ready('seeked')
    return drawThumb(video, video.videoWidth, video.videoHeight)
  } catch {
    return null
  } finally {
    video.removeAttribute('src')
    video.load()
    URL.revokeObjectURL(url)
  }
}

/** A small picture for the chip and the transcript. Never throws; null when none could be made. */
export async function makeThumb(pending: PendingAttachment): Promise<string | null> {
  try {
    if (pending.source.type === 'asset') {
      return (
        (await bay()?.media.thumbnail({ assetId: pending.source.assetId, path: pending.source.path, atUs: pending.kind === 'video' ? 1_000_000 : 0, size: THUMB_EDGE })) ??
        null
      )
    }
    if (pending.kind === 'video') return await videoThumb(pending.source.blob)
    const bitmap = await createImageBitmap(pending.source.blob)
    try {
      return drawThumb(bitmap, bitmap.width, bitmap.height)
    } finally {
      bitmap.close()
    }
  } catch {
    return null
  }
}

/** What crosses IPC for one attachment. */
export async function toInput(pending: PendingAttachment): Promise<AgentAttachmentInput> {
  if (pending.source.type === 'asset') {
    return { source: 'asset', kind: pending.kind, name: pending.name, assetId: pending.source.assetId, path: pending.source.path }
  }
  return {
    source: 'bytes',
    kind: pending.kind,
    name: pending.name,
    mime: pending.source.mime,
    data: new Uint8Array(await pending.source.blob.arrayBuffer())
  }
}

export function toView(pending: PendingAttachment): AgentAttachmentView {
  return { kind: pending.kind, name: pending.name, thumb: pending.thumb }
}
