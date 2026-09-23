/**
 * A shipped template, sized to a canvas and written to disk — the one step of placing a
 * template that needs the filesystem, so the one step that lives in main.
 *
 * Everything decidable without a disk is in `@shared/templates` and tested there: the sizing,
 * the file name. This file only joins them to the inlined bodies and a directory, which is why
 * it is short — and why it is not under test, since it cannot load outside Electron.
 */

import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { findTemplate, sizeTemplate, templateFileName, templateUri, TEMPLATES } from '@shared/templates'
import { TEMPLATE_BODIES } from '../templates'
import { generatedDir, templatesDir } from '../paths'
import { writeComposition } from './compositions'

export async function writeTemplate(
  templateId: string,
  width: number,
  height: number
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const spec = findTemplate(templateId)
  if (!spec) {
    return {
      ok: false,
      error: `There is no template "${templateId}". bay ships: ${TEMPLATES.map((t) => t.id).join(', ')}.`
    }
  }
  const body = TEMPLATE_BODIES[templateUri(spec.id)] ?? null
  if (body === null) {
    return {
      ok: false,
      error: `Template "${spec.id}" is listed but carries no document in this build. This is a fault in bay.`
    }
  }

  let sized: string
  try {
    sized = sizeTemplate(body, width, height)
  } catch (error) {
    return { ok: false, error: (error as Error).message }
  }

  // Content-addressed, so an existing file at this path already holds exactly these bytes and
  // rewriting it changes nothing. That is also why neither the import cache nor an open
  // composition window is invalidated here, unlike `composition:write`: nothing they hold is
  // stale, and forgetting the path would mint a second asset for an identical file.
  const path = join(templatesDir(), templateFileName(spec.id, width, height, sized))
  const written = await writeComposition(path, sized)
  return written.ok ? { ok: true, path } : written
}

/**
 * A composition bay generated for the user — a clip's subtitles — written where bay keeps its own.
 * Content-addressed like the templates: the same document is the same file, so regenerating
 * identical subtitles reuses one asset instead of minting another, and a changed document never
 * overwrites a file a placed clip still reads.
 */
export async function writeGenerated(
  name: string,
  html: string
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'generated'
  const hash = createHash('sha256').update(html).digest('hex').slice(0, 12)
  const path = join(generatedDir(), `${slug}-${hash}.html`)
  const written = await writeComposition(path, html)
  return written.ok ? { ok: true, path } : written
}
