/**
 * Which built-in styles still lack their tile media in `resources/styles/<id>/`.
 *
 * Reported, not failing, while the media is being made: a tile without it draws its neutral face,
 * so a missing file is unfinished work rather than a broken build. Once every style has both
 * files, set `PREVIEW_MEDIA_REQUIRED = true` and a style added without media fails by name.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BUILT_IN_STYLES } from '@shared/styles'
import { STYLE_PREVIEW_POSTER } from '@shared/styles/types'
import { admitStylePreview } from '../serve'

/** Flip to `true` once the media exists (resources/styles/README.md). */
const PREVIEW_MEDIA_REQUIRED = false

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'resources', 'styles')

function present(path: string): boolean {
  try {
    return statSync(path).isFile() && statSync(path).size > 0
  } catch {
    return false
  }
}

test('built-in styles missing preview media in resources/styles/<id>/', (t) => {
  assert.ok(present(join(ROOT, 'README.md')), `the styles resources folder is where this test looks: ${ROOT}`)
  const missing: string[] = []
  for (const style of BUILT_IN_STYLES) {
    for (const file of [style.preview, STYLE_PREVIEW_POSTER]) {
      if (!file) {
        missing.push(`${style.id}: names no preview`)
        continue
      }
      const path = join(ROOT, style.id, file)
      // Every file the styles name is one main would actually serve.
      assert.ok(admitStylePreview(ROOT, path), `${style.id}/${file} is not a path bay://style-preview serves`)
      if (!present(path)) missing.push(`resources/styles/${style.id}/${file}`)
    }
  }
  if (missing.length > 0) {
    const report = `${missing.length} preview file(s) missing:\n  ${missing.join('\n  ')}`
    if (PREVIEW_MEDIA_REQUIRED) assert.fail(report)
    t.diagnostic(report)
  }
})
