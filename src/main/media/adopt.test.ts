/**
 * A project opened from disk admits only the paths a project may name. Before this, `adoptAssets`
 * allow-listed every asset path in the document, so a `.bay` naming `~/.ssh/id_rsa` as a clip made
 * it readable over `bay://` — `admissibleFromProject` was applied after, to a set that already held
 * it. Each refusal here is paired with the nearest path that must still be admitted.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Asset } from '@shared/project'
import { resolve } from 'node:path'
import { adoptProjectAssets } from './adopt'
import { admissibleFromProject } from '../serve'

function asset(id: string, path: string | null, kind: Asset['kind'] = 'video'): Asset {
  return {
    id,
    kind,
    name: id,
    path,
    durationUs: 0,
    width: null,
    height: null,
    fps: null,
    hasAudio: false,
    hasVideo: true,
    posterPath: null,
    waveformPath: null,
    createdAt: 0
  }
}

const FONTS = '/Users/me/.bay-profile/fonts'

function adopt(assets: Asset[]): { allowed: string[]; byPath: Map<string, Asset> } {
  const allowed: string[] = []
  const byPath = new Map<string, Asset>()
  adoptProjectAssets(assets, byPath, (p) => allowed.push(p), FONTS)
  return { allowed, byPath }
}

test('a project naming a secret as a clip does not put it on the allowlist, beside a clip that is admitted', () => {
  const { allowed, byPath } = adopt([asset('key', '/Users/me/.ssh/id_rsa'), asset('clip', '/Users/me/Movies/interview.mp4')])
  assert.deepEqual(allowed, ['/Users/me/Movies/interview.mp4'])
  // Not remembered either: a remembered asset is "reused" by the next import, which then never
  // allow-lists the path, so a user importing that file themselves would get one that cannot load.
  assert.equal(byPath.has('/Users/me/.ssh/id_rsa'), false)
  assert.equal(byPath.get('/Users/me/Movies/interview.mp4')?.id, 'clip')
})

test('a traversal spelled into the path is refused, not normalised into admission', () => {
  const sneaky = '/Users/me/Movies/../.aws/credentials'
  assert.deepEqual(adopt([asset('x', sneaky)]).allowed, [])
})

test('a relative path is refused as written, not resolved against wherever bay was started', () => {
  // Resolved first, `Movies/clip.mp4` becomes an absolute path under the process's working
  // directory and passes — a file the document never named absolutely.
  const before = process.cwd()
  process.chdir('/tmp')
  try {
    // Specimen: from here, the resolved form would pass the dot-folder rule on its own.
    assert.equal(admissibleFromProject(resolve('Movies/clip.mp4')), true)
    const { allowed } = adopt([asset('rel', 'Movies/clip.mp4'), asset('abs', '/Users/me/Movies/clip.mp4')])
    assert.deepEqual(allowed, ['/Users/me/Movies/clip.mp4'])
  } finally {
    process.chdir(before)
  }
})

test("bay's own font copies are admitted from a dot-folder profile — only fonts, only inside the folder", () => {
  const { allowed } = adopt([
    asset('font', `${FONTS}/0e094a7d.ttf`, 'font'),
    asset('notfont', `${FONTS}/0e094a7d.mp4`, 'video'),
    asset('sibling', `${FONTS}-evil/x.ttf`, 'font'),
    asset('elsewhere', '/Users/me/.fonts/x.ttf', 'font')
  ])
  assert.ok(`${FONTS}-evil/x.ttf`.startsWith(FONTS), 'specimen: defeats a prefix check without a separator')
  assert.deepEqual(allowed, [`${FONTS}/0e094a7d.ttf`])
})
