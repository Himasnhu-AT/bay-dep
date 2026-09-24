/**
 * The project's imported fonts as a stylesheet a composition window can use.
 *
 * A composition's session cancels every request but `data:`, `blob:`, `about:` and its own folder
 * (`sandbox.ts`), so a face over `bay://` would never load there. The renderer sends the paths of
 * bay's copies; this reads them and writes each as an `@font-face` with a `data:` source — the same
 * bytes and descriptors the editor registers, so a composition naming "Archivo" draws the face the
 * text items do, in preview and export alike.
 *
 * Only files inside bay's fonts folder are read, whatever the request names. The request comes from
 * the renderer, which may be running a project someone sent; a path is a way to a file, and this
 * one may only reach files bay itself wrote.
 *
 * Pure but for the injected `read`, so it runs under `pnpm test`.
 */

import { realpath } from 'node:fs/promises'
import { resolve, sep } from 'node:path'
import type { CompositionFrameRequest } from '@shared/ipc'
import { fontFaceRule, isFontPath, wellFormedFace } from '@shared/fonts'

type Requested = NonNullable<CompositionFrameRequest['fonts']>[number]

const MIME: Record<Requested['format'], string> = {
  truetype: 'font/ttf',
  opentype: 'font/otf',
  woff: 'font/woff',
  woff2: 'font/woff2'
}

export interface FontCss {
  css: string
  families: string[]
  /** Paths refused, and why — never read. */
  refused: { path: string; reason: string }[]
}

async function inside(dir: string, path: string): Promise<boolean> {
  try {
    const [root, file] = await Promise.all([realpath(dir), realpath(resolve(path))])
    return file.startsWith(root + sep)
  } catch {
    return false
  }
}

export async function compositionFontCss(
  fonts: readonly Requested[],
  fontsDir: string,
  read: (path: string) => Promise<Uint8Array>
): Promise<FontCss> {
  const out: FontCss = { css: '', families: [], refused: [] }
  const rules: string[] = []
  for (const font of fonts) {
    if (!wellFormedFace(font)) {
      out.refused.push({ path: font.path, reason: 'its descriptors are not ones bay writes' })
      continue
    }
    if (!isFontPath(font.path) || !(await inside(fontsDir, font.path))) {
      out.refused.push({ path: font.path, reason: "it is not in bay's fonts folder" })
      continue
    }
    let bytes: Uint8Array
    try {
      bytes = await read(font.path)
    } catch {
      out.refused.push({ path: font.path, reason: 'it could not be read' })
      continue
    }
    const url = `data:${MIME[font.format]};base64,${Buffer.from(bytes).toString('base64')}`
    rules.push(fontFaceRule(font, url))
    if (!out.families.includes(font.family)) out.families.push(font.family)
  }
  out.css = rules.join('\n')
  return out
}
